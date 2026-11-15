#!/usr/bin/env node
/**
 * 花园同步产物的 fail-closed 断言。任何一条不满足就退出 1，不允许发布。
 *
 *   node --experimental-strip-types scripts/check-garden.mjs
 *
 * 输出只有计数，不打印笔记路径或标题（CI 日志是公开的）。
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gardenConfig } from '../src/config/garden.ts';
import { gardenConfigProblems, sha1, stableJson, tagPageKeysOf } from '../src/lib/garden/core.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, gardenConfig.outputDir);
const CONTENT_DIR = path.join(OUT_DIR, 'content');
const ASSET_DIR = path.join(ROOT, gardenConfig.publicAssetDir);
const PUBLISHED_FILE = path.join(ROOT, gardenConfig.publishedManifest);

const failures = [];
const notes = [];
const fail = (message) => failures.push(message);
const info = (message) => console.log(`[garden:check] ${message}`);

for (const problem of gardenConfigProblems(gardenConfig)) {
    fail(`配置：${problem}`);
}

function git(args) {
    try {
        return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch (error) {
        return error && error.stdout ? String(error.stdout).trim() : '';
    }
}

/* 1) 隐私红线：两个目录都必须被 ignore，且没有已跟踪文件 */
for (const dir of [gardenConfig.outputDir, gardenConfig.publicAssetDir]) {
    const ignored =
        git(['check-ignore', '-q', `${dir}/`]) === '' &&
        (() => {
            try {
                execFileSync('git', ['check-ignore', '-q', `${dir}/`], { cwd: ROOT });
                return true;
            } catch {
                return false;
            }
        })();
    if (!ignored) fail(`${dir} 没有被 .gitignore 忽略`);
    const tracked = git(['ls-files', '--', dir]);
    if (tracked) fail(`${dir} 里有被 git 跟踪的文件`);
}

/* 2) 产物存在且非空（失败即中止，不允许静默发布空花园） */
if (!existsSync(CONTENT_DIR)) {
    fail('缺少 .garden/content，请先运行 yarn sync:garden');
} else {
    const manifestRaw = await readFile(path.join(OUT_DIR, 'manifest.json'), 'utf8').catch(() => null);
    if (!manifestRaw) {
        fail('缺少 .garden/manifest.json');
    } else {
        const manifest = JSON.parse(manifestRaw);
        const files = (await walk(CONTENT_DIR)).filter((file) => file.endsWith('.md'));
        if (manifest.noteCount === 0 || files.length === 0) fail('同步产物为空（0 篇）');
        if (files.length !== manifest.noteCount) fail(`content 文件数 ${files.length} 与 manifest 的 ${manifest.noteCount} 不一致`);

        // 文件内容 hash 与 manifest 对齐
        let mismatch = 0;
        for (const relative of files) {
            const body = await readFile(path.join(CONTENT_DIR, relative), 'utf8');
            const id = relative.replace(/\.md$/i, '');
            const expected = manifest.files.find((item) => item.id === id);
            if (!expected || expected.sha256 !== sha1(body)) mismatch += 1;
            notes.push(id);
        }
        if (mismatch > 0) fail(`${mismatch} 个文件内容与 manifest 不一致（请重新同步）`);

        // 坏链上限：真坏链与「指向未发布笔记」分开卡
        const missing = manifest.unresolved?.missing ?? null;
        const toUnpublished = manifest.unresolved?.toUnpublished ?? null;
        if (missing !== null && missing > gardenConfig.maxBrokenMissing) {
            fail(`真坏链 ${missing} 条，超过上限 ${gardenConfig.maxBrokenMissing}`);
        }
        if (toUnpublished !== null && toUnpublished > gardenConfig.maxBrokenUnpublished) {
            fail(`指向未发布笔记的链接 ${toUnpublished} 条，超过上限 ${gardenConfig.maxBrokenUnpublished}`);
        }
        info(
            `笔记 ${manifest.noteCount} 篇 / 附件 ${manifest.assetCount} 个 / 坏链 ${manifest.unresolvedLinks} 条（真坏链 ${missing ?? '?'} + 指向未发布 ${toUnpublished ?? '?'}）/ 孤立点 ${manifest.orphanCount ?? '?'}`
        );

        // 3) 输出路径必须全是小写：大小写不敏感文件系统上不会互相覆盖
        const cased = notes.filter((id) => id !== id.toLowerCase());
        if (cased.length > 0) fail(`${cased.length} 个输出路径含大写字母（大小写不敏感 FS 上会撞车）`);

        // 附件保留旧站大小写（Netlify 大小写不敏感、不做 301），但必须已 slug 化：
        // 含空格 / ? / # / & / % 的路径在旧站是 404，说明我们没按 Quartz 规则改写。
        const badAssets = (manifest.assets ?? []).filter((asset) => /[\s?#&%]/.test(asset));
        if (badAssets.length > 0) fail(`${badAssets.length} 个附件路径未 slug 化（含空格或保留字符）`);

        // 3c) 公开 JSON 端点只许含已发布集合：dist 里有就必须和清单的 notes 对齐
        const metaJsonPath = path.join(ROOT, 'dist', 'garden-meta.json');
        if (existsSync(metaJsonPath)) {
            const metaJson = JSON.parse(await readFile(metaJsonPath, 'utf8'));
            const keys = Object.keys(metaJson);
            if (keys.length !== manifest.noteCount) {
                fail(`dist/garden-meta.json 有 ${keys.length} 条，与 manifest 的 ${manifest.noteCount} 篇不一致`);
            }
            const publishedNotes = new Set(JSON.parse(await readFile(PUBLISHED_FILE, 'utf8')).notes ?? []);
            const outside = keys.filter((id) => !publishedNotes.has(id === 'index' ? `${gardenConfig.route}/` : `${gardenConfig.route}/${id}/`));
            if (outside.length > 0) {
                fail(`dist/garden-meta.json 有 ${outside.length} 条不在发布清单里：${outside.slice(0, 5).join(', ')}`);
            }
        }

        // 3d) 全站图端点同样只能含已发布节点
        const graphJsonPath = path.join(ROOT, 'dist', 'garden-graph.json');
        if (existsSync(graphJsonPath)) {
            const graphJson = JSON.parse(await readFile(graphJsonPath, 'utf8'));
            const publishedNotes = new Set(JSON.parse(await readFile(PUBLISHED_FILE, 'utf8')).notes ?? []);
            const outside = (graphJson.nodes ?? []).filter(
                (node) => !publishedNotes.has(node.id === 'index' ? `${gardenConfig.route}/` : `${gardenConfig.route}/${node.id}/`)
            );
            if (outside.length > 0) {
                fail(`dist/garden-graph.json 有 ${outside.length} 个节点不在发布清单里`);
            }
        }

        // 4) 发布清单 diff：清单外的新路径一律拒绝
        const current = {
            schemaVersion: 1,
            notes: notes.map((id) => (id === 'index' ? `${gardenConfig.route}/` : `${gardenConfig.route}/${id}/`)).sort(),
            folders: [],
            tags: [],
            assets: (manifest.assets ?? []).map((asset) => `${gardenConfig.route}/${asset}`).sort(),
            pages: [],
            endpoints: ['/garden-meta.json', '/garden-graph.json', '/garden-search-data.json']
        };
        const linkMapRaw = await readFile(path.join(OUT_DIR, 'link-map.json'), 'utf8').catch(() => null);
        if (linkMapRaw) {
            const linkMap = JSON.parse(linkMapRaw);
            const noteIdSet = new Set(notes);
            current.folders = (linkMap.folders ?? [])
                .filter((folder) => !noteIdSet.has(folder))
                .map((folder) => `${gardenConfig.route}/${folder}/`)
                .sort();
            current.tags = [
                `${gardenConfig.route}/tags/`,
                ...tagPageKeysOf((linkMap.tags ?? []).map((tag) => tag.key)).map((key) => `${gardenConfig.route}/tags/${key}/`)
            ];
        }

        // 3b) 笔记页与文件夹页不得抢占同一 URL：冲突时构建会静默覆盖，页面 200 但内容换了
        if (linkMapRaw) {
            const linkMapFolders = JSON.parse(linkMapRaw).folders ?? [];
            const noteIdSet = new Set(notes);
            const shadowed = linkMapFolders.filter((folder) => noteIdSet.has(folder));
            if (shadowed.length > 0) {
                // 笔记优先是既定规则（旧站也是笔记页）；这里只确认它们没有同时出现在输出清单里
                info(`${shadowed.length} 个文件夹页让位给同名笔记（笔记优先）：${shadowed.slice(0, 5).join(', ')}`);
                const emittedFolders = (current.folders ?? []).filter((url) => shadowed.some((folder) => url === `${gardenConfig.route}/${folder}/`));
                if (emittedFolders.length > 0) {
                    fail(`${emittedFolders.length} 个被笔记占位的文件夹页仍然登记进了输出清单（同一 URL 会重复）`);
                }
            }

            // 标题/标签/日期都从 link-map 读，digest 不一致说明 sync 没跑完或跑了一半
            const linkMapDigest = JSON.parse(linkMapRaw).contentDigest ?? '';
            const manifestDigest = manifest.contentDigest ?? '';
            if (!linkMapDigest || linkMapDigest !== manifestDigest) {
                fail(
                    `link-map 与 manifest 的 contentDigest 不一致（${String(linkMapDigest).slice(0, 12)} vs ${String(manifestDigest).slice(0, 12)}）：请重新同步，否则页面标题会静默错`
                );
            }
        }

        if (!existsSync(PUBLISHED_FILE)) {
            fail(`缺少发布清单 ${gardenConfig.publishedManifest}，请用 --write-published 首次生成并提交`);
        } else {
            const published = JSON.parse(await readFile(PUBLISHED_FILE, 'utf8'));
            const flatten = (snapshot) =>
                new Set([
                    ...(snapshot.notes ?? []),
                    ...(snapshot.folders ?? []),
                    ...(snapshot.tags ?? []),
                    ...(snapshot.assets ?? []),
                    ...(snapshot.pages ?? []),
                    ...(snapshot.endpoints ?? [])
                ]);
            const before = flatten(published);
            const after = flatten(current);
            const added = [...after].filter((item) => !before.has(item));
            const removed = [...before].filter((item) => !after.has(item));
            if (added.length > 0) {
                fail(`出现 ${added.length} 个清单外的新发布路径：把它加进 ${gardenConfig.publishedManifest} 再提交（含笔记/文件夹/标签/附件）`);
            }
            if (removed.length > 0) {
                fail(`有 ${removed.length} 条清单内路径本次未产出：禁止部署，防止误删线上页面；确认撤回或改名并处理旧 URL 后，再人工更新发布清单`);
            }
            const digest = JSON.parse(linkMapRaw ?? '{}').contentDigest ?? '';
            info(`发布清单比对：新增 ${added.length} / 消失 ${removed.length}；contentDigest ${String(digest).slice(0, 12)}`);
        }
    }
}

/* 5) 渲染后的站内链接必须命中产物文件
 *
 * wiki 坏链只能拦住「渲染前解析不到」的链接；反链/局部图/左栏是把 id 拼成 URL，
 * 拼错（`/garden/index/`）在产物里就是一个 404 的 <a>，靠这条兜住。
 */
const DIST_DIR = path.join(ROOT, 'dist');
const GARDEN_DIST = path.join(DIST_DIR, 'garden');
if (existsSync(GARDEN_DIST)) {
    const htmlFiles = (await walk(GARDEN_DIST)).filter((file) => file.endsWith('.html'));
    const hrefs = new Set();
    for (const file of htmlFiles) {
        const html = await readFile(path.join(GARDEN_DIST, file), 'utf8');
        for (const match of html.matchAll(/href="(\/garden(?:\/[^"#?]*)?)"/g)) hrefs.add(match[1]);
    }
    const resolves = (href) => {
        let clean = href.replace(/&amp;/g, '&').split('#')[0].split('?')[0];
        try {
            clean = decodeURIComponent(clean);
        } catch {
            // 编码坏了就按原样找，找不到会进缺失列表
        }
        if (clean === '/garden' || clean === '/garden/') return existsSync(path.join(GARDEN_DIST, 'index.html'));
        const rel = clean.replace(/^\/garden\//, '');
        if (!rel) return existsSync(path.join(GARDEN_DIST, 'index.html'));
        const target = path.join(GARDEN_DIST, rel);
        if (clean.endsWith('/')) return existsSync(path.join(target, 'index.html'));
        // 附件这类静态文件直接命中；页面则看 <dir>/index.html
        return existsSync(target) || existsSync(path.join(target, 'index.html'));
    };
    const missing = [...hrefs].filter((href) => !resolves(href)).sort();
    if (missing.length > 0) {
        fail(`${missing.length} 个站内链接在产物里没有对应文件（示例：${missing.slice(0, 5).join('、')}）`);
    }
    info(`站内链接扫描：${htmlFiles.length} 个花园页 / ${hrefs.size} 个唯一 href / 缺失 ${missing.length}`);
}

if (failures.length > 0) {
    console.error('[garden:check] 失败：');
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(1);
}
console.log('[garden:check] 通过');

async function walk(dir, base = dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full, base)));
        else out.push(path.relative(base, full).split(path.sep).join('/'));
    }
    return out;
}
