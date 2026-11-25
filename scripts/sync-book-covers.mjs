#!/usr/bin/env node
/**
 * 书籍封面：按 reading.json 里的书名 + 作者去 NeoDB 匹配，取回封面覆盖本地封面。
 *
 * 现状：阅读卡封面来自 modureader 的 data/cover（阅读器自己缓存的图，尺寸小、风格杂）。
 * 目标：优先用 NeoDB 的书封（和 /douban/ 同一来源），匹配不到再保留原封面。
 * 匹配逻辑与 sync-book-descriptions.mjs 一致（书名完全相等 4 分、包含 2 分、作者命中 3 分，
 * ≥4 分才算命中），避免封面配错书。
 *
 * 只在 GET 范围内工作，不需要 token；结果写进公开仓库，所以只下载封面、不写别的元数据。
 * 用法：
 *   node scripts/sync-book-covers.mjs            # 只补/替换已有 cover 键的书
 *   node scripts/sync-book-covers.mjs --force    # 全部重取（忽略磁盘上已有的 webp）
 *   node scripts/sync-book-covers.mjs --dry-run  # 只打印匹配结果
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const OUT_DIR = path.join(ROOT, 'src', 'assets', 'reading-cover');
const API_BASE = (process.env.NEODB_API_URL || 'https://neodb.social/api').replace(/\/$/, '');
const CONCURRENCY = 3;
const TIMEOUT_MS = 20000;
const COVER_WIDTH = 240;
const COVER_QUALITY = 78;

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DRY_RUN = args.has('--dry-run');

function normalizeTitle(title) {
    return String(title ?? '')
        .toLowerCase()
        .replace(/[（(][^)）]*[)）]/g, '')
        .replace(/[\s:：·・,，.。!！?？'"“”‘’\-—_/\\|]+/g, '')
        .trim();
}

function firstAuthorName(author) {
    return String(author ?? '')
        .split(/[、,，/&;；]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .pop() || '';
}

async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
}

async function fetchBinary(url) {
    const res = await fetch(url, {
        headers: { Accept: 'image/*', 'User-Agent': 'astro-book/1.0 (+https://1900.live)' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 1024 ? buf : null;
}

/** 同名条目按「书名完全相等 > 作者命中」打分，≥4 分才算同一本。 */
function pickCandidate(items, title, author) {
    const want = normalizeTitle(title);
    const authorName = firstAuthorName(author);
    const scored = (items || [])
        .map((item) => {
            const itemTitle = normalizeTitle(item.display_title || item.title);
            const credits = item.credits || [];
            const hitAuthor = authorName && credits.some((c) => String(c.name || '').includes(authorName));
            let score = 0;
            if (itemTitle === want) score += 4;
            else if (itemTitle.includes(want) || want.includes(itemTitle)) score += 2;
            if (hitAuthor) score += 3;
            return { item, score };
        })
        .filter((x) => x.score >= 4)
        .sort((a, b) => b.score - a.score);
    return scored[0]?.item ?? null;
}

async function neodbCover(book) {
    // 搜索用「去掉版本括注」的书名：穷查理宝典（珍藏版）（1+2册）这种带括注的名字在 NeoDB 搜不到；
    // 再不行就按 _ / ／ 切开，用其中一段试（三十岁的成人礼_搭车去柏林）。
    const baseTitle = String(book.title).replace(/[（(][^)）]*[)）]/g, '').trim() || book.title;
    const queries = [baseTitle, ...baseTitle.split(/[_／/·|]/).map((s) => s.trim()).filter((s) => s.length >= 2)];
    let candidate = null;
    for (const q of [...new Set(queries)]) {
        const search = await fetchJson(`${API_BASE}/catalog/search?query=${encodeURIComponent(q)}&category=book`);
        candidate = pickCandidate(search.data, book.title, book.author) || pickCandidate(search.data, q, book.author);
        if (candidate) break;
    }
    if (!candidate) return null;
    const detailUrl = /^https?:/i.test(candidate.api_url)
        ? candidate.api_url
        : `${new URL(API_BASE).origin}${candidate.api_url}`;
    const detail = await fetchJson(detailUrl);
    const cover = String(detail.cover_image_url || candidate.cover_image_url || '').trim();
    if (!cover) return null;
    return { cover, url: detail.id || candidate.id, matchedTitle: detail.display_title || candidate.display_title };
}

async function main() {
    const reading = JSON.parse(readFileSync(path.join(DATA_DIR, 'reading.json'), 'utf8'));
    const books = new Map();
    for (const day of reading.days ?? []) {
        for (const book of day.books ?? []) {
            if (!book?.cover || !book?.title) continue;
            const key = `${book.title}|${book.author ?? ''}`;
            if (!books.has(key)) books.set(key, { title: book.title, author: book.author ?? '', cover: book.cover });
        }
    }
    const all = [...books.values()];
    const targets = FORCE ? all : all.filter((b) => !existsSync(path.join(OUT_DIR, `${b.cover}.webp`)));
    console.log(`[cover] 待查 ${targets.length} 本（共 ${all.length} 本，已有封面 ${all.length - targets.length}）`);
    if (!targets.length) return;

    let sharp;
    try {
        sharp = (await import('sharp')).default;
    } catch {
        console.log('[cover] 未安装 sharp，跳过');
        return;
    }
    if (!DRY_RUN) mkdirSync(OUT_DIR, { recursive: true });

    let done = 0;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        await Promise.all(
            batch.map(async (book) => {
                try {
                    const hit = await neodbCover(book);
                    if (!hit) {
                        console.log(`[cover] 未匹配：${book.title}`);
                        return;
                    }
                    if (DRY_RUN) {
                        console.log(`[cover] 命中：${book.title} → ${hit.matchedTitle} ${hit.cover}`);
                        return;
                    }
                    const buf = await fetchBinary(hit.cover);
                    if (!buf) {
                        console.log(`[cover] 图取不到：${book.title}`);
                        return;
                    }
                    const webp = await sharp(buf)
                        .resize({ width: COVER_WIDTH, withoutEnlargement: true })
                        .webp({ quality: COVER_QUALITY })
                        .toBuffer();
                    writeFileSync(path.join(OUT_DIR, `${book.cover}.webp`), webp);
                    done += 1;
                    console.log(`[cover] ${book.title} → NeoDB（${(webp.length / 1024).toFixed(0)} KB）`);
                } catch (error) {
                    console.log(`[cover] ${book.title}：${String(error.message).split('\n')[0]}`);
                }
            })
        );
    }
    console.log(`[cover] 完成 ${done} 张`);
}

main().catch((error) => {
    console.error(`[cover] 失败：${String(error.message).split('\n')[0]}`);
    process.exitCode = 1;
});
