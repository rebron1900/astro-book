#!/usr/bin/env node
/**
 * 书籍简介：按 reading.json 里的书名去 NeoDB 查，取回简介写进 src/data/book-descriptions.json。
 *
 * 为什么要这一步：modureader 的 book 记录只有 title / author / cover_path，没有简介；
 * 阅读卡片想显示简介，只能从别处拿。选择 NeoDB（本站已经在用的书目站）而不是直接读 epub：
 * epub 原件在 WebDAV 上，抽元数据要么先下载整本书（公开仓库的同步流程不适合搬原件），
 * 要么书本身就没写 description。NeoDB 的 Edition 虽然有出版社信息，但搜索结果经常是
 * 条目（Work）而不是某个版本，没法靠 ISBN 精准匹配，所以这里按「书名 + 作者」打分。
 *
 * 只用 GET；不需要 token。结果落盘进公开仓库，所以：
 * - 直接丢掉的：以「内容简介 / 简介 / 本书」开头的模板前缀（出版社文案）；
 * - 走 sanitize：宣传语行、购买/试读链接、联系方式、<script> 等；
 * - 仍然可能残留的出版商营销句子，写进文件时带 from / matchedTitle，便于人工删改。
 *
 * 用法：
 *   node scripts/sync-book-descriptions.mjs              # 只补没有简介的书
 *   node scripts/sync-book-descriptions.mjs --force      # 全部重取
 *   node scripts/sync-book-descriptions.mjs --dry-run    # 只打印，不写文件
 * 人工定稿写在 src/data/book-meta.json，优先级高于本文件（同名字段以 book-meta 为准）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const OUT_FILE = path.join(DATA_DIR, 'book-descriptions.json');
const API_BASE = (process.env.NEODB_API_URL || 'https://neodb.social/api').replace(/\/$/, '');
const CONCURRENCY = 3;
const TIMEOUT_MS = 15000;
const MAX_DESC = 260;
/** 分册 / 续作：书名相同但结果明显是另一本时宁可不填，卡片上没简介好过写错一本的简介。 */
const VOLUME_HINT = /(第[一二三四五六七八九十]+部|[一二三四五六七八九十]+续|[0-9]+\s*[)）]$|[^0-9][0-9]{1,2}$|vol\\.?\s*[0-9]\\.?[0-9]*\s*$|续集|前传|外传|第[0-9]+[册卷部])/i;
// 「（1-3 册）」这种是套书合集，本身不是分册标记
const VOLUME_NOT_MARK = /[(（]\s*[0-9]+\s*[-–~]\s*[0-9]+\s*[册卷部]\s*[)）]/g;

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DRY_RUN = args.has('--dry-run');

/** 出版社模板前缀：「内容简介：」「简介：」「本书由…」 */
// 模板前缀可能出现在开头，也可能包在书名号里：「内容简介：」「《西藏生死书》内容简介：」，
// 还可能出现在中间（「【内容简介】」接在宣传语后面），所以是全局替换、不是 ^ 锚定
const TEMPLATE_PREFIX = /\s*(?:《[^》]{1,40}》)?\s*[（(【\[]?\s*(?:内容简介|图书简介|书籍简介|作品简介|简介|本书简介|书籍描述|内容摘要)\s*[）)】\]]?\s*[:：]\s*/g;
// 没有冒号的方括号标题也是模板（「【内容简介】正文」），无冒号时要求带括号，避免吃掉「简介写作」这种正常词
const TEMPLATE_HEADING = /\s*[（(【\[]\s*(?:内容简介|图书简介|书籍简介|作品简介|简介|本书简介|书籍描述|内容摘要)\s*[）)】\]]\s*/g;
const BOILERPLATE_LINE = /(购买|订书|下单|立即抢购|抢购|优惠|折扣|满减|包邮|点击|链接|淘宝|京东|当当|亚马逊|天猫|拼多多|公众号|扫码|二维码|关注我们|版权所有|转载|投稿|https?:\/\/|www\.|@)/i;
const SENTENCE_END = /[。！？!?…]/;

/** 去掉营销行、超链接、控制字符；截到 MAX_DESC。 */
export function sanitizeDescription(raw) {
    if (!raw) return '';
    let text = String(raw)
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\r/g, '');
    text = text.replace(TEMPLATE_PREFIX, '');
    text = text.replace(TEMPLATE_HEADING, '');
    const kept = text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line && !BOILERPLATE_LINE.test(line));
    // 宣传符号（◆ ● ★ ■）开头的行只留正文
    let out = kept.map((line) => line.replace(/^[◆●★■▪·•\-—]+\s*/, '')).filter(Boolean).join('').replace(/\s+/g, ' ').trim();
    if (!out) return '';
    if (out.length > MAX_DESC) {
        // 尽量在句子边界截断
        const cut = out.slice(0, MAX_DESC);
        const lastStop = Math.max(...[...cut.matchAll(new RegExp(SENTENCE_END, 'g'))].map((m) => m.index));
        out = lastStop > 60 ? cut.slice(0, lastStop + 1) : `${cut.replace(/[…。！？!?]?$/, '')}…`;
    }
    return out;
}

/** 书名归一：去书名号/空白/版本括注，用来比对「同一个书名」。 */
export function normalizeTitle(title) {
    return String(title || '')
        .replace(/[《》「」『』\s]/g, '')
        .replace(/[（(][^）)]*[）)]/g, '')
        .toLowerCase();
}

function firstAuthorName(author) {
    return String(author || '')
        .replace(/[\[\]（）()]/g, ' ')
        .split(/[·,，、\s]/)
        .filter(Boolean)
        .pop() || '';
}

async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
}

/** 同名条目按「书名完全相等 > 作者命中 > 有简介」排序，取第一条有用的。 */
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

async function describeBook(book) {
    const q = encodeURIComponent(book.title);
    const search = await fetchJson(`${API_BASE}/catalog/search?query=${q}&category=book`);
    const candidate = pickCandidate(search.data, book.title, book.author);
    if (!candidate) return null;
    // catalog/search 的 api_url 已经带 /api 前缀（/api/book/xxx），不能再拼 API_BASE
    const detailUrl = /^https?:/i.test(candidate.api_url) ? candidate.api_url : `${new URL(API_BASE).origin}${candidate.api_url}`;
    const detail = await fetchJson(detailUrl);
    const description = sanitizeDescription(detail.description || detail.brief || '');
    if (!description) return null;
    const matchedTitle = detail.display_title || candidate.display_title;
    // 去掉版本括注后同名，但结果名字里多出「第二部 / 3 / 续」这类分册标记 → 不是同一本
    if (VOLUME_HINT.test(matchedTitle.replace(VOLUME_NOT_MARK, '')) && !VOLUME_HINT.test(book.title)) return null;
    return { description, from: 'neodb', url: detail.id || candidate.id, matchedTitle };
}

async function main() {
    const reading = JSON.parse(readFileSync(path.join(DATA_DIR, 'reading.json'), 'utf8'));
    const existing = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, 'utf8')) : { books: {} };
    const books = {};
    const targets = (reading.books || []).filter((b) => FORCE || !existing.books?.[b.title]?.description);
    console.log(`[desc] 待查 ${targets.length} 本（共 ${(reading.books || []).length} 本）`);

    const found = [];
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
            batch.map(async (book) => {
                try {
                    return { book, hit: await describeBook(book) };
                } catch (error) {
                    console.log(`[desc] ${book.title}：${String(error.message).split('\n')[0]}`);
                    return { book, hit: null };
                }
            })
        );
        for (const { book, hit } of results) {
            if (!hit) {
                console.log(`[desc] 未取到：${book.title}`);
                continue;
            }
            books[book.title] = hit;
            found.push(book.title);
            console.log(`[desc] ✓ ${book.title}（匹配：${hit.matchedTitle}）`);
        }
    }

    // 已有结果里没被重查的保留
    for (const [title, value] of Object.entries(existing.books || {})) {
        if (!books[title]) books[title] = value;
    }
    const payload = { generatedAt: new Date().toISOString(), source: 'neodb', books };
    if (DRY_RUN) {
        console.log(JSON.stringify(payload, null, 2).slice(0, 4000));
        return;
    }
    writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`[desc] 写入 ${path.relative(ROOT, OUT_FILE)}：命中 ${found.length} 本，文件内共 ${Object.keys(books).length} 本`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sync-book-descriptions.mjs')) {
    await main();
}
