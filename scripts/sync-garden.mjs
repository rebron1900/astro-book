#!/usr/bin/env node
/**
 * 把私有 Obsidian vault 同步成 Astro 能读、且已经脱敏的花园镜像。
 *
 * 只写 `.garden/` 与 `public/garden/`（两者都 gitignored），**绝不写 `src/data/`**：
 * 那条链路会被每 3 小时的 cron 自动提交回公开仓库。
 *
 * 运行前需要 Node 的 TS 支持（Node 22.6+）：
 *   node --experimental-strip-types scripts/sync-garden.mjs
 * 通过 `yarn sync:garden` 调用即可。
 *
 * 输出只打印「目录：篇数 / 各类计数」，不打印标题、路径或正文。
 */
import { readdir, readFile, writeFile, mkdir, copyFile, rm, stat, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { gardenConfig } from '../src/config/garden.ts';
import {
    assignIds,
    assetMirrorPath,
    assetUrlPath,
    contentDigestOf,
    foldersOf,
    gardenConfigProblems,
    isAssetTarget,
    linkKeysOf,
    linkifyInlineTags,
    mergeTagCases,
    normalizeKey,
    normalizeTags,
    publishModeOf,
    replaceOutsideCode,
    rewriteMarkdownImages,
    routeIdOf,
    sha1,
    shouldPublishPath,
    stableJson,
    stripObsidianComments,
    tagPageKeysOf
} from '../src/lib/garden/core.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, gardenConfig.outputDir);
const CONTENT_DIR = path.join(OUT_DIR, 'content');
const ASSET_DIR = path.join(ROOT, gardenConfig.publicAssetDir);
const PUBLISHED_FILE = path.join(ROOT, gardenConfig.publishedManifest);

const args = new Set(process.argv.slice(2));
const WRITE_PUBLISHED = args.has('--write-published');

/* ------------------------------ 工具 ------------------------------ */

const toPosix = (p) => p.split(path.sep).join('/');

/** 目录 755 / 文件 644：静态附件要能被 nginx 读，不能继承 CI 的 umask 077。 */
async function chmodTree(dir) {
    await chmod(dir, 0o755);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await chmodTree(full);
        else await chmod(full, 0o644);
    }
}

async function walk(dir, base = dir) {
    const out = [];
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await walk(full, base)));
            continue;
        }
        out.push(toPosix(path.relative(base, full)));
    }
    return out;
}

/** 读 frontmatter：只认开头 `---` 块；解析失败按空对象处理（正文照发，字段不信任） */
function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { data: {}, body: raw };
    try {
        const data = yaml.load(match[1]);
        return { data: data && typeof data === 'object' ? data : {}, body: raw.slice(match[0].length) };
    } catch {
        return { data: {}, body: raw.slice(match[0].length) };
    }
}

const asArray = (value) => {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return [String(value).trim()].filter(Boolean);
};

async function resolveVaultDir() {
    const fromEnv = process.env[gardenConfig.vaultDirEnv];
    const candidates = [fromEnv, path.join(OUT_DIR, 'vault')].filter(Boolean);
    for (const candidate of candidates) {
        if (existsSync(path.join(candidate, '.git')) || existsSync(path.join(candidate, 'index.md'))) return path.resolve(candidate);
    }
    // 方案 D：CI 直接 clone 脱敏仓库，已经产出 .garden/content
    if (existsSync(CONTENT_DIR)) return null;
    return undefined;
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
    const configProblems = gardenConfigProblems(gardenConfig);
    if (configProblems.length > 0) {
        console.error(`[garden] 配置有问题，拒绝同步：${configProblems.join('；')}`);
        process.exit(1);
    }
    const vaultDir = await resolveVaultDir();
    if (vaultDir === undefined) {
        console.error(`[garden] 找不到 vault：请设置 ${gardenConfig.vaultDirEnv} 或在 ${gardenConfig.outputDir}/vault 放一份 clone`);
        process.exit(1);
    }
    if (vaultDir === null) {
        console.error('[garden] 只找到已同步的 .garden/content，请用 scripts/check-garden.mjs 校验');
        process.exit(1);
    }

    const allFiles = await walk(vaultDir);
    const mdFiles = allFiles.filter((file) => /\.md$/i.test(file));
    const skipped = { excluded: 0, draft: 0, unpublished: 0 };

    // 1) 过滤 + frontmatter
    const candidates = [];
    for (const relPath of mdFiles) {
        if (!shouldPublishPath(relPath, gardenConfig)) {
            skipped.excluded += 1;
            continue;
        }
        const raw = await readFile(path.join(vaultDir, relPath), 'utf8');
        const { data, body } = parseFrontmatter(raw);
        if (gardenConfig.skipDraft && data.draft === true) {
            skipped.draft += 1;
            continue;
        }
        if (gardenConfig.requirePublish && data.publish !== true) {
            skipped.unpublished += 1;
            continue;
        }
        // Obsidian 注释块（含 Waypoint 生成的目录）在渲染前就剥掉
        candidates.push({ relPath, data, body: stripObsidianComments(body) });
    }

    // 2) id（小写 + 冲突处理）
    const assigned = assignIds(candidates.map(({ relPath, data }) => ({ relPath, title: data.title, aliases: asArray(data.aliases) })));
    const idByPath = new Map(assigned.map((item) => [item.relPath, item]));
    const conflictNotes = assigned.filter((item) => item.order > 1);

    // 3) 解析键表：相对路径（去扩展名）/ 文件名 / 标题 / 别名
    const keys = new Map();
    const addKey = (raw, id) => {
        const key = normalizeKey(raw);
        if (!key || keys.has(key)) return;
        keys.set(key, id);
    };
    for (const item of assigned) {
        // 完整路径 / 去扩展名 / 文件名 / 文件夹笔记的目录路径（`…/index.md` → `…`）
        for (const key of linkKeysOf(item.relPath)) addKey(key, item.id);
    }
    for (const { relPath, data } of candidates) {
        const id = idByPath.get(relPath).id;
        if (data.title) addKey(String(data.title), id);
        for (const alias of asArray(data.aliases)) addKey(alias, id);
    }

    // 3b) 全部 md（含被排除的）的键表：用来把坏链拆成「指向未发布笔记」和「真的不存在」
    const unpublishedKeys = new Set();
    for (const file of mdFiles) {
        if (idByPath.has(file)) continue;
        for (const key of linkKeysOf(file)) unpublishedKeys.add(key);
    }
    let brokenMissing = 0;
    let brokenUnpublished = 0;

    // 3c) 已知标签 key（含层级父级）：行内 `#tag` 只转已存在的标签，未知的不动
    const knownTagKeys = new Set();
    for (const { data } of candidates) {
        for (const tag of normalizeTags(data.tags)) {
            const parts = tag.toLowerCase().split('/').filter(Boolean);
            for (let i = 1; i <= parts.length; i += 1) knownTagKeys.add(parts.slice(0, i).join('/'));
        }
    }

    // 4) 附件索引：先按完整路径，再按文件名（Obsidian 两种写法都支持）
    const assetsByPath = new Map();
    const assetsByName = new Map();
    for (const file of allFiles) {
        if (!gardenConfig.assetExts.some((ext) => file.toLowerCase().endsWith(ext))) continue;
        assetsByPath.set(file.toLowerCase(), file);
        const name = path.posix.basename(file).toLowerCase();
        const list = assetsByName.get(name) ?? [];
        list.push(file);
        assetsByName.set(name, list);
    }

    const resolvedAssets = new Map(); // 小写镜像路径 -> vault 相对路径
    const assetStats = { copied: 0, skippedLarge: 0, ambiguous: 0 };

    const mirrorAssetHit = (hit) => {
        const mirror = assetMirrorPath(hit);
        resolvedAssets.set(mirror, hit);
        return { url: assetUrlPath(gardenConfig.route, mirror), label: path.posix.basename(hit) };
    };

    /** URL 里带空格/中文的附件常被写成百分号编码，解析前先解码 */
    const decodeSafe = (value) => {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    };

    const resolveAsset = (target) => {
        if (/^[a-z]+:\/\//i.test(target) || target.startsWith('/')) return null;
        if (!isAssetTarget(target, gardenConfig.assetExts)) return null;
        const normalized = target.replace(/\\/g, '/').replace(/^\.\//, '');
        let hit = assetsByPath.get(normalized.toLowerCase());
        if (!hit) {
            const name = path.posix.basename(normalized).toLowerCase();
            const list = assetsByName.get(name) ?? [];
            if (list.length === 0) return null;
            if (list.length > 1) assetStats.ambiguous += 1;
            hit = [...list].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
        }
        return mirrorAssetHit(hit);
    };

    /**
     * 标准 markdown 图片的解析器。Obsidian 两种写法都要支持：
     * 笔记目录相对（`../99-Rsources/Assets/x.png`）与 vault 根相对（`99-Rsources/Assets/x.png`），
     * 最后再用文件名兜底（裸名字、大小写不一致）。找不到就返回 null，由改写层降级成文字。
     */
    const makeMdImageResolver = (noteRelPath) => (rawTarget) => {
        const target = rawTarget.split('#')[0].split('?')[0].trim();
        const decoded = decodeSafe(target).replace(/\\/g, '/');
        if (!gardenConfig.assetExts.some((ext) => decoded.toLowerCase().endsWith(ext))) return null;
        const candidates = [
            path.posix.normalize(path.posix.join(path.posix.dirname(noteRelPath.replace(/\\/g, '/')), decoded)),
            path.posix.normalize(decoded.replace(/^\.\//, ''))
        ];
        let hit = null;
        for (const candidate of candidates) {
            hit = assetsByPath.get(candidate.toLowerCase());
            if (hit) break;
        }
        if (!hit) {
            const name = path.posix.basename(decoded).toLowerCase();
            const list = assetsByName.get(name) ?? [];
            if (list.length === 0) return null;
            if (list.length > 1) assetStats.ambiguous += 1;
            hit = [...list].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
        }
        return mirrorAssetHit(hit);
    };

    // 5) 正文：一次遍历改写链接（附件 → 镜像 URL、笔记 → 站内路由、其余记为坏链）
    const notes = [];
    let unresolvedTotal = 0;
    let inlineTagLinks = 0;
    let mdImageResolved = 0;
    let mdImageMissing = 0;
    const missingImageTargets = [];
    for (const { relPath, data, body } of candidates) {
        const item = idByPath.get(relPath);
        let unresolved = 0;
        const outboundIds = new Set();
        // 代码区（围栏/行内代码）里的链接照样解析——Obsidian 的 `image-layout-f` 围栏里放的是真图片；
        // 区别只在「解析不到时」：代码区保持原文，别把 `[[menu.main]]` 这种示例改成纯文本
        let rewritten = replaceOutsideCode(body, (segment, inCode) => segment.replace(/(!?)\[\[([^\]]+)\]\]/g, (whole, bang, inner) => {
            const [targetPart, ...rest] = inner.split('|');
            const target = targetPart.split('#')[0].trim();
            const anchor = targetPart.includes('#') ? `#${targetPart.split('#')[1]}` : '';
            const label = rest.join('|').trim();

            const asset = resolveAsset(target);
            if (asset) return bang === '!' ? `![${label || asset.label}](${asset.url})` : `[${label || asset.label}](${asset.url})`;

            const id = keys.get(normalizeKey(target));
            if (id) {
                outboundIds.add(id);
                return `[${label || target.split('/').pop()}](${gardenConfig.route}/${id}/${anchor})`;
            }

            unresolved += 1;
            if (unpublishedKeys.has(normalizeKey(target))) brokenUnpublished += 1;
            else brokenMissing += 1;
            // 解析不到就退成纯文本（别名优先），别把 `[[路径|别名]]` 原样漏到页面上。
            // 绝大多数命中是「目标笔记没发布」（66-Project、00-inBox 这类被排除的目录），
            // 读者该看到的是那句话本身，而不是一串 Markdown 源码。
            // 代码区例外：那里是示例，保持原文。
            return inCode ? whole : label || target.split('/').pop() || target;
        }));
        unresolvedTotal += unresolved;

        // 旧域硬编码链接 → 站内小写路由
        rewritten = rewritten.replace(/https?:\/\/garden\.1900\.live\/([^\s)"'<>]+)/gi, (_m, rest) => {
            const clean = rest.split('?')[0].replace(/\/$/, '').toLowerCase();
            return `${gardenConfig.route}/${clean}${clean ? '/' : ''}`;
        });

        // 标准 markdown 图片的相对路径：不改写的话 Astro 会当成内容资源去 import，构建失败
        const mdImages = rewriteMarkdownImages(rewritten, makeMdImageResolver(relPath));
        rewritten = mdImages.body;

        // 行内 `#tag` → 标签页链接（只转已存在的标签；代码区/标题/色值不动）
        const tagLinks = linkifyInlineTags(rewritten, knownTagKeys);
        rewritten = tagLinks.body;
        inlineTagLinks += tagLinks.linked;
        mdImageResolved += mdImages.resolved;
        mdImageMissing += mdImages.missing;
        if (mdImages.missing > 0) missingImageTargets.push(relPath);

        const title = data.title ? String(data.title) : path.posix.basename(relPath, '.md');
        const aliases = asArray(data.aliases);
        const tags = normalizeTags(data.tags);
        // hash 覆盖正文 + 影响派生数据的字段（标签/标题/别名），
        // 否则改标签但正文不变时，标签页与索引会以为没变化
        notes.push({
            id: item.id,
            idCased: item.idCased,
            relPath,
            title,
            aliases,
            tags,
            date: data.date ? String(data.date) : null,
            hash: sha1([rewritten, title, aliases.join('\n'), tags.join('\n')].join('\u0000')),
            body: rewritten,
            outbound: outboundIds
        });
    }

    notes.sort((a, b) => (a.id < b.id ? -1 : 1));

    // 5b) 孤立点：没有任何站内 wiki 链接进出（和旧站 contentIndex 的口径一致）
    const inbound = new Set();
    for (const note of notes) {
        for (const id of note.outbound) inbound.add(id);
    }
    const orphans = notes.filter((note) => !inbound.has(note.id) && note.outbound.size === 0).map((note) => note.id);
    const linkCount = notes.reduce((sum, note) => sum + note.outbound.size, 0);

    // 6) 写镜像
    await rm(CONTENT_DIR, { recursive: true, force: true });
    await mkdir(CONTENT_DIR, { recursive: true });
    for (const note of notes) {
        const file = path.join(CONTENT_DIR, `${note.id}.md`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, note.body, 'utf8');
    }

    // 7) 附件：只复制被引用的
    await rm(ASSET_DIR, { recursive: true, force: true });
    const assetPaths = [];
    for (const mirror of [...resolvedAssets.keys()].sort()) {
        const source = path.join(vaultDir, resolvedAssets.get(mirror));
        const info = await stat(source);
        if (info.size > gardenConfig.maxAssetBytes) {
            assetStats.skippedLarge += 1;
            continue;
        }
        const target = path.join(ASSET_DIR, mirror);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, target);
        assetPaths.push(mirror);
        assetStats.copied += 1;
    }
    // 附件要由 nginx 直接读：不跟着调用方的 umask（CI 里是 077）变成 600/700，否则线上 403。
    // 没有引用附件时目录不会创建（例如全部改用 R2 外链），此时不用 chmod。
    if (existsSync(ASSET_DIR)) await chmodTree(ASSET_DIR);

    // 8) 索引产物
    const folders = foldersOf(notes.map((note) => note.id));
    const tagGroups = mergeTagCases(notes.flatMap((note) => note.tags));
    const contentDigest = contentDigestOf(notes);
    const linkMap = {
        schemaVersion: 1,
        contentDigest,
        // links 供页面构建期算反链（Quartz 的 Backlinks 就是全量扫 links 元数据）
        notes: notes.map(({ id, idCased, relPath, title, aliases, tags, date, hash, outbound }) => ({
            id,
            idCased,
            relPath,
            title,
            aliases,
            tags,
            date,
            hash,
            links: [...outbound].sort()
        })),
        keys: Object.fromEntries([...keys.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
        folders,
        tags: tagGroups
    };
    const manifest = {
        schemaVersion: 1,
        contentDigest,
        noteCount: notes.length,
        assetCount: assetPaths.length,
        unresolvedLinks: unresolvedTotal,
        mdImages: { resolved: mdImageResolved, missing: mdImageMissing, notesWithMissing: missingImageTargets.length },
        unresolved: { toUnpublished: brokenUnpublished, missing: brokenMissing },
        orphanCount: orphans.length,
        files: notes.map((note) => ({ id: note.id, sha256: sha1(note.body) })),
        linkCount,
        assets: assetPaths
    };
    await writeFile(path.join(OUT_DIR, 'link-map.json'), stableJson(linkMap), 'utf8');
    await writeFile(path.join(OUT_DIR, 'manifest.json'), stableJson(manifest), 'utf8');

    // 9) 发布清单 diff
    // 层级 tag（`a/b`）会额外生成父级页 `/tags/a/`，清单必须一起算，否则「清单外新路径」漏放行
    const tagPageKeys = tagPageKeysOf(tagGroups.map((tag) => tag.key));
    // 同名笔记优先：这些文件夹页被笔记占位，清单里不重复登记（否则唯一 URL 数会少 1）
    const noteIdSet = new Set(notes.map((note) => note.id));
    const folderPages = folders.filter((folder) => !noteIdSet.has(folder));
    const publishedNow = {
        schemaVersion: 1,
        // 根笔记 index.md 的页面 URL 是 `/garden/`，不是 `/garden/index/`
        notes: notes.map((note) => (note.id === 'index' ? `${gardenConfig.route}/` : `${gardenConfig.route}/${note.id}/`)),
        folders: folderPages.map((folder) => `${gardenConfig.route}/${folder}/`),
        // 聚合页 `/garden/tags/` 也要登记，否则它成了清单外未把关的公开路径
        tags: [`${gardenConfig.route}/tags/`, ...tagPageKeys.map((key) => `${gardenConfig.route}/tags/${key}/`)],
        assets: assetPaths.map((asset) => `${gardenConfig.route}/${asset}`),
        // 全站图改成了右栏弹窗，不再有独立页面；公开 JSON 端点仍要登记
        pages: [],
        endpoints: ['/garden-meta.json', '/garden-graph.json', '/garden-search-data.json']
    };
    if (WRITE_PUBLISHED) {
        if (process.env.CI) {
            console.error('[garden] 拒绝在 CI 里执行 --write-published：发布面只能由人工在本地扩大');
            process.exit(1);
        }
        await writeFile(PUBLISHED_FILE, stableJson(publishedNow), 'utf8');
        console.log(`[garden] 已写入发布清单 ${gardenConfig.publishedManifest}`);
    }

    // 10) 摘要（只有计数）
    const byTop = new Map();
    for (const note of notes) {
        const top = note.id.includes('/') ? note.id.split('/')[0] : '(root)';
        byTop.set(top, (byTop.get(top) ?? 0) + 1);
    }
    console.log(`[garden] 发布口径：${publishModeOf(gardenConfig) === 'include' ? `白名单 ${gardenConfig.include.length} 条` : '黑名单'}`);
    console.log(`[garden] 发布 ${notes.length} 篇 / 文件夹 ${folders.length} 个 / 标签 ${tagGroups.length} 个（原始写法 ${new Set(tagGroups.flatMap((t) => t.variants)).size} 种）`);
    console.log(`[garden] 跳过：排除 ${skipped.excluded} 篇、draft ${skipped.draft} 篇、未 publish ${skipped.unpublished} 篇`);
    console.log(`[garden] 附件：复制 ${assetStats.copied} 个、超限跳过 ${assetStats.skippedLarge} 个、同名多份 ${assetStats.ambiguous} 次`);
    console.log(`[garden] 正文图片：改写 ${mdImageResolved} 处、解析不到降级为文字 ${mdImageMissing} 处（${missingImageTargets.length} 篇）`);
    console.log(`[garden] 行内 #tag 转链接 ${inlineTagLinks} 处`);
    console.log(`[garden] 站内链接 ${linkCount} 条；坏链 ${unresolvedTotal} 条 = 指向未发布笔记 ${brokenUnpublished} + 真的解析不到 ${brokenMissing}；孤立点 ${orphans.length} 篇；大小写冲突 ${conflictNotes.length} 篇（${conflictNotes.map((item) => item.id).join(', ')}）`);
    console.log(`[garden] 大小写合并标签 ${tagGroups.filter((tag) => tag.variants.length > 1).length} 组：${tagGroups.filter((tag) => tag.variants.length > 1).map((tag) => tag.key).join(', ')}`);
    console.log(`[garden] contentDigest ${contentDigest.slice(0, 12)}`);
    console.log(`[garden] 目录：${[...byTop.entries()].sort((a, b) => b[1] - a[1]).map(([dir, count]) => `${dir} ${count}`).join(' · ')}`);
}

main().catch((error) => {
    // 只打印错误类型与计数，不打印正文或路径内容
    console.error(`[garden] 同步失败：${error && error.message ? error.message.split('\n')[0] : 'unknown'}`);
    process.exit(1);
});
