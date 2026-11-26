#!/usr/bin/env node
/**
 * 公开数据兜底检查：扫描 src/data 与 dist，确认非公开 Memos 没有落地。
 *
 * 定位：来源侧（sync-data.mjs）和消费者侧（store.ts）已经各过滤一次，这个脚本
 * 只做「发布前最后一道体检」，防止有人手改 JSON、换回旧数据文件或构建缓存残留。
 *
 * 规则：
 * - src/data/memos.json 里出现任何非公开记录 → 失败（说明来源侧过滤被绕过）；
 * - dist/ 里出现非公开记录的去标签文本特征 → 失败（说明构建产物泄露）；
 * - dist 不存在时只提示并跳过（本地还没 build 不算错）。
 *
 * 隐私：**绝不打印正文**，只打印条数、文件数与文件名。文件名本身来自路由，不含正文。
 *
 * 用法：
 *   node scripts/check-public-data.mjs
 *   MEMOS_PUBLISH_VISIBILITIES=public,unlisted node scripts/check-public-data.mjs
 *   node scripts/check-public-data.mjs --features-from /path/to/memos-backup.json
 *
 * --features-from：用仓库外的历史备份生成「非公开样本特征」，专门用来复测「旧实现曾经泄露、
 * 新构建产物已不再命中」。备份不进仓库（含正文），所以只能显式传路径。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MEMO_VISIBILITIES, isPublishableMemo, parseMemoVisibilities, memoPlainText, memoTextFeature } from '../src/lib/privacy.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'src', 'data', 'memos.json');
const DIST_DIR = path.join(ROOT, 'dist');
const TEXT_EXTENSIONS = new Set(['.html', '.json', '.xml', '.txt', '.js']);

/** 递归列出目录下的文本文件（跳过图片等二进制）。 */
export function listTextFiles(dir, files = []) {
    if (!existsSync(dir)) return files;
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            listTextFiles(full, files);
        } else if (TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) {
            files.push(full);
        }
    }
    return files;
}

/**
 * 统计可见性分布（只数条数，不碰正文）。
 * @returns {Record<string, number>}
 */
export function countVisibilities(memos) {
    const counts = {};
    for (const memo of Array.isArray(memos) ? memos : []) {
        const key = typeof memo?.visibility === 'string' && memo.visibility.trim() ? memo.visibility.trim().toUpperCase() : '(缺失)';
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

/**
 * 在文件内容里查找特征，返回命中的特征数（同一个特征只计一次）。
 * 特征取非公开记录的正文前缀，不输出原文。
 */
export function countFeatureHits(content, features) {
    let hits = 0;
    for (const feature of features) {
        if (feature && content.includes(feature)) hits += 1;
    }
    return hits;
}

/** 一条非公开记录能生成的特征（正文前缀）。 */
export function featuresOf(memos, length = 40) {
    const features = new Set();
    for (const memo of memos) {
        const feature = memoTextFeature(memo?.content, length);
        if (feature) features.add(feature);
    }
    return [...features];
}

/** 从仓库外备份（JSON 数组）里，取出「按当前白名单不可发布」的记录特征。
 * corpusText：当前可公开内容的纯文本（公开 memo + 文章正文）。正文相同的记录无法作为泄露信号
 * （转发/重发会造成同文，另外文章里也会引用随手记），必须排除，否则产生假阳性。
 */
export function referenceFeatures(file, allowed, corpusText = '') {
    const all = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(all)) throw new Error(`${file} 不是数组`);
    const nonPublic = all.filter((memo) => !isPublishableMemo(memo, allowed));
    const allFeatures = featuresOf(nonPublic);
    const features = corpusText ? allFeatures.filter((feature) => !corpusText.includes(feature)) : allFeatures;
    return { total: all.length, nonPublic: nonPublic.length, features, excluded: allFeatures.length - features.length };
}

/** 当前 src/data 里可公开内容的纯文本（公开 memos + Ghost 文章/页面 html）。 */
export function publicCorpusText(dataDir = path.join(ROOT, 'src', 'data'), allowed = DEFAULT_MEMO_VISIBILITIES) {
    const parts = [];
    const memosFile = path.join(dataDir, 'memos.json');
    if (existsSync(memosFile)) {
        const memos = JSON.parse(readFileSync(memosFile, 'utf8'));
        for (const memo of Array.isArray(memos) ? memos : []) {
            if (isPublishableMemo(memo, allowed)) parts.push(memoPlainText(memo.content));
        }
    }
    const ghostFile = path.join(dataDir, 'ghost.json');
    if (existsSync(ghostFile)) {
        const ghost = JSON.parse(readFileSync(ghostFile, 'utf8'));
        for (const entry of [...(ghost.posts || []), ...(ghost.pages || [])]) {
            parts.push(memoPlainText(entry.html));
            parts.push(String(entry.excerpt || ''));
        }
    }
    return parts.join('\n');
}

function readArgValue(args, name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function main() {
    const allowed = parseMemoVisibilities(process.env.MEMOS_PUBLISH_VISIBILITIES);
    console.log(`[check-public-data] 发布白名单：${allowed.join('/')}（默认 ${DEFAULT_MEMO_VISIBILITIES.join('/')}）`);

    if (!existsSync(DATA_FILE)) {
        console.error('[check-public-data] 找不到 src/data/memos.json，无法核验');
        process.exit(1);
    }

    let memos;
    try {
        memos = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
        console.error(`[check-public-data] src/data/memos.json 解析失败：${error.message}`);
        process.exit(1);
    }
    if (!Array.isArray(memos)) {
        console.error('[check-public-data] src/data/memos.json 不是数组');
        process.exit(1);
    }

    const counts = countVisibilities(memos);
    const distribution = Object.entries(counts)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
    console.log(`[src/data] memos ${memos.length} 条（${distribution}）`);

    const leakedInSource = memos.filter((memo) => !isPublishableMemo(memo, allowed));
    let features = featuresOf(leakedInSource);
    console.log(`[src/data] 非公开记录 ${leakedInSource.length} 条（可用于检测的特征 ${features.length} 条）`);

    let failed = false;
    if (leakedInSource.length > 0) {
        failed = true;
        console.error('[src/data] 失败：data 文件里仍有非公开记录，来源侧过滤被绕过');
    }

    // 可选：用仓库外的历史备份生成参考特征，复测「旧实现泄露过的内容是否已从 dist 消失」。
    const featuresFrom = readArgValue(process.argv.slice(2), '--features-from');
    if (featuresFrom) {
        try {
            const reference = referenceFeatures(featuresFrom, allowed, publicCorpusText(undefined, allowed));
            console.log(
                `[reference] ${featuresFrom} 共 ${reference.total} 条，非公开 ${reference.nonPublic} 条，生成特征 ${reference.features.length} 条（同文已在公开内容里的 ${reference.excluded} 条已排除）`
            );
            features = [...new Set([...features, ...reference.features])];
        } catch (error) {
            console.error(`[check-public-data] 读取参考特征失败：${error.message}`);
            process.exit(1);
        }
    }

    if (!existsSync(DIST_DIR)) {
        console.log('[dist] 目录不存在，跳过（还没构建；先 yarn build 再跑本脚本）');
    } else if (features.length === 0) {
        console.log('[dist] 没有非公开记录可检测，跳过');
    } else {
        const files = listTextFiles(DIST_DIR);
        const hits = { html: 0, json: 0, xml: 0, js: 0, txt: 0 };
        const hitFiles = [];
        let matchedFeatures = 0;
        const seenFeatures = new Set();
        for (const file of files) {
            const content = readFileSync(file, 'utf8');
            let fileHit = false;
            for (const feature of features) {
                if (content.includes(feature)) {
                    fileHit = true;
                    seenFeatures.add(feature);
                }
            }
            if (!fileHit) continue;
            const ext = path.extname(file).slice(1);
            hits[ext] = (hits[ext] || 0) + 1;
            hitFiles.push(path.relative(DIST_DIR, file));
        }
        matchedFeatures = seenFeatures.size;
        const summary = Object.entries(hits)
            .filter(([, value]) => value > 0)
            .map(([key, value]) => `${key} ${value} 个`)
            .join(' + ');
        console.log(`[dist] 扫描 ${files.length} 个文本文件，命中 ${hitFiles.length} 个${summary ? `（${summary}）` : ''}，涉及 ${matchedFeatures} 条非公开样本`);
        if (hitFiles.length > 0) {
            failed = true;
            // 只列文件名，不打印正文
            for (const file of hitFiles.slice(0, 20)) console.error(`  - ${file}`);
            if (hitFiles.length > 20) console.error(`  …其余 ${hitFiles.length - 20} 个文件省略`);
            console.error('[dist] 失败：构建产物里检测到非公开记录特征');
        }
    }

    if (failed) {
        console.error('[check-public-data] 未通过');
        process.exit(1);
    }
    console.log('[check-public-data] 通过：src/data 与 dist 均未检出非公开记录');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
