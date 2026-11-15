#!/usr/bin/env node
/**
 * 生成旧域迁移用的 nginx map 与 Search Console 移除清单。
 *
 *   node scripts/gen-garden-cutover.mjs
 *
 * 数据来源（都只读）：
 *   - `refs/garden-contentIndex.json`：旧站公开的 283 条 slug（可选，默认从环境变量读）
 *   - `.garden/link-map.json`：本次发布的 269 篇
 *   - `src/config/garden-published.json`：发布清单
 *
 * 输出写到 `.garden/cutover/`（已 gitignore）：里面含被主动撤回的 3 条旧路径标题，
 * **不要提交**，只在本机 nginx 配置与 Search Console 操作时用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { gardenConfig } from '../src/config/garden.ts';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, gardenConfig.outputDir, 'cutover');

const INDEX_CANDIDATES = [
    process.env.GARDEN_OLD_INDEX,
    '/home/rebron1900/refs/garden-contentIndex.json'
].filter(Boolean);

const findOldIndex = () => {
    for (const candidate of INDEX_CANDIDATES) if (existsSync(candidate)) return candidate;
    return null;
};

const oldIndexPath = findOldIndex();
if (!oldIndexPath) {
    console.error('[cutover] 找不到旧站 contentIndex.json，请用 GARDEN_OLD_INDEX 指定路径');
    process.exit(1);
}

const oldIndex = JSON.parse(readFileSync(oldIndexPath, 'utf8'));
const oldSlugs = Object.keys(oldIndex);

const linkMap = JSON.parse(readFileSync(path.join(ROOT, '.garden', 'link-map.json'), 'utf8'));
const published = JSON.parse(readFileSync(path.join(ROOT, gardenConfig.publishedManifest), 'utf8'));

const newIdOfOldSlug = (slug) => {
    const normalized = slug.replace(/^\/+|\/+$/g, '').toLowerCase();
    return normalized === 'index' ? '' : normalized;
};

const publishedNewUrls = new Set(published.notes ?? []);
const newUrlOf = (id) => (id ? `${gardenConfig.route}/${id}/` : `${gardenConfig.route}/`);

/** 主动撤回：旧站有、本次不发布，且不是模板/资源目录（那些是收紧排除，不算撤回） */
const RESOURCE_PREFIXES = ['99-rsources/templates', '99-rsources/assets'];
const intentionallyRetired = oldSlugs.filter((slug) => {
    const id = newIdOfOldSlug(slug);
    if (publishedNewUrls.has(newUrlOf(id))) return false;
    return !RESOURCE_PREFIXES.some((prefix) => id === prefix || id.startsWith(`${prefix}/`));
});

const mappings = [];
const retired = [];
for (const slug of oldSlugs) {
    const id = newIdOfOldSlug(slug);
    const target = newUrlOf(id);
    if (publishedNewUrls.has(target)) {
        mappings.push({ slug, target });
    } else if (intentionallyRetired.includes(slug)) {
        retired.push({ slug, target });
    }
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mapLines = mappings.map(({ slug, target }) => `    ~^/${escapeRegExp(slug)}/?$ ${target};`);

const nginxMap = [
    '# 旧域 garden.1900.live → 1900.live/garden 的逐条 301 映射（由 scripts/gen-garden-cutover.mjs 生成）',
    '# 用法：放在 http{} 里，在 server{} 里 return 301 https://1900.live$garden_target;',
    'map $uri $garden_target {',
    `    default ${gardenConfig.route}/;`,
    `    # ${mappings.length} 条迁移成功的旧 URL`,
    ...mapLines,
    '}',
    ''
].join('\n');

const retiredPattern = `^/(${retired.map(({ slug }) => escapeRegExp(slug)).join('|')})/?$`;

// 注意：nginx 的引号字符串会保留换行、正则里带上 \n 就匹配不到了，所以这里必须是单行
const retiredLocation = [
    '# 旧域 garden.1900.live 的 server 片段（由 scripts/gen-garden-cutover.mjs 生成）',
    '',
    '# 1) 主动撤回的页面：410 Gone + noindex，禁止 301',
    '#    （301 等于让新站继续承载已经决定不公开的页面，还会被搜索引擎重新收录）',
    `location ~ "${retiredPattern}" {`,
    '    add_header X-Robots-Tag "noindex, nofollow" always;',
    '    return 410;',
    '}',
    '',
    '# 2) 附件：按扩展名兜底，直接拼 /garden$request_uri',
    '#    附件路径本身就是 slug 化 + 保留大小写的，与新站镜像 1:1，这是唯一可以安全「拼路径」的场景。',
    '#    不逐条进 map：299 个附件逐条维护没有意义，扩展名规则一条覆盖，含外部引用与 RSS 里的旧图。',
    'location ~* "\\.(png|jpe?g|gif|webp|svg|pdf|mp4|mp3|zip)$" {',
    '    return 301 https://1900.live/garden$request_uri;',
    '}',
    ''
].join('\n');

const csv = [
    'old_url,new_url,status',
    ...mappings.map((m) => `https://garden.1900.live/${m.slug},https://1900.live${m.target},301`),
    ...retired.map((m) => `https://garden.1900.live/${m.slug},,410`)
].join('\n');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'garden-301.map'), `${nginxMap}\n`, 'utf8');
writeFileSync(path.join(OUT_DIR, 'garden-locations.conf'), `${retiredLocation}\n`, 'utf8');
writeFileSync(path.join(OUT_DIR, 'mapping.csv'), `${csv}\n`, 'utf8');
writeFileSync(
    path.join(OUT_DIR, 'search-console-removals.txt'),
    retired.map(({ slug }) => `https://garden.1900.live/${slug}`).join('\n') + '\n',
    'utf8'
);

console.log(`[cutover] 旧站 ${oldSlugs.length} 条：301 映射 ${mappings.length} 条、410 撤回 ${retired.length} 条`);
console.log(`[cutover] 产物在 ${path.relative(ROOT, OUT_DIR)}/（已 gitignore，不要提交）`);
