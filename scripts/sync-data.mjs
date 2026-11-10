#!/usr/bin/env node
/**
 * 数据同步脚本：从各外部源拉取数据，落地为 src/data/*.json
 * 供 Astro 构建时离线读取（零运行时网络依赖）。
 *
 * 用法:
 *   node scripts/sync-data.mjs            # 全量同步所有源
 *   node scripts/sync-data.mjs ghost      # 只同步指定源(逗号分隔)
 *   node scripts/sync-data.mjs --dry-run  # 预览将要写入的文件(不写盘)
 *   node scripts/sync-data.mjs --full      # 忽略增量缓存，全量同步
 *
 * 需要环境变量(或 .env 文件): GHOST_API_URL, GHOST_API_KEY,
 *   NEODB_TOKEN, FLUX_URL, FLUX_KEY, MAP_KMZ_URL,
 *   GOTOSOCIAL_URL, GOTOSOCIAL_TOKEN,
 *   INTERVALS_ICU_API_KEY, INTERVALS_ICU_ATHLETE_ID
 * 非密钥配置从 src/config/site.ts 读取。
 *
 * intervals 源：每次同步都从 intervals.icu 全量拉取活动（数据量小，按自然年分段请求），
 * 只有轨迹（地图折线）走增量缓存——复用上一版 activities.json 里已有的 polyline，
 * 缺失时才请求 /activity/{id}/map。`--full` 会让轨迹也全部重拉。
 */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFluxSnapshot, PARSING_ERROR_LIMIT } from '../src/lib/flux-snapshot.ts';
import { discoverFeedUrl, parseFeedXml } from '../src/lib/feed-xml.ts';
import { applyRouteCache, pendingRouteIds, polylineFromMap, sortActivities, toActivity, yearWindows } from '../src/lib/intervals.ts';

// ---------- 路径 ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');

// ---------- 配置加载 ----------
function loadEnv() {
    const env = {};
    const envFile = path.join(ROOT, '.env');
    if (existsSync(envFile)) {
        const content = readFileSync(envFile, 'utf8');
        for (const line of content.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
    }
    // 进程环境变量优先
    for (const [k, v] of Object.entries(process.env)) {
        if ((k.startsWith('GHOST_') || k.startsWith('NEODB_') || k.startsWith('FLUX_') || k.startsWith('MAP_') || k.startsWith('CDN_') || k.startsWith('INTERVALS_') || k.startsWith('GOTOSOCIAL_')) && v !== undefined && v !== '') {
            env[k] = v;
        }
    }
    return env;
}

// 读取 site 配置中的非密钥项
async function loadSiteConfig() {
    try {
        const mod = await import(path.join(ROOT, 'src/config/site.ts'));
        return mod.siteConfig;
    } catch (e) {
        console.warn('[config] 无法读取 site.ts，使用默认值:', e.message);
        return {
            memos: { url: 'https://m2m.996288.xyz/api/v1/memo', siteURL: 'https://m2m.996288.xyz' }
        };
    }
}

// ---------- 工具 ----------
async function fetchJson(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// 直连订阅源时使用的 UA（部分站点会拦截默认的 Node UA）。
const FEED_FETCH_USER_AGENT = ['Mozilla', '5.0', '(Windows NT 10.0; Win64; x64)', 'AppleWebKit/537.36', '(KHTML, like Gecko)', 'Chrome/131.0.0.0', 'Safari/537.36', 'AstroBookFeedFetcher/1.0'].join(
    ' '
);

async function fetchFeedXml(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': FEED_FETCH_USER_AGENT,
                Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const text = await res.text();
        if (!text) throw new Error('订阅源返回空响应');
        return { text, finalUrl: res.url || url };
    } finally {
        clearTimeout(timer);
    }
}

// 直连被 Cloudflare 等拦截时的最后兜底：通过 Jina Reader 以 XML 原文形式取回订阅源。
// 可用 FLUX_READER_PROXY 覆盖（设为空字符串或 0 可关闭）。
const DEFAULT_FEED_READER_PROXY = 'https://r.jina.ai/';

async function fetchViaReader(url, readerProxy, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${readerProxy}${url}`, {
            signal: controller.signal,
            headers: {
                'X-Return-Format': 'html',
                Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain, */*'
            }
        });
        if (!res.ok) throw new Error(`Reader HTTP ${res.status} ${res.statusText}`);
        return { text: await res.text(), finalUrl: url };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchHtml(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': FEED_FETCH_USER_AGENT,
                Accept: 'text/html,application/xhtml+xml'
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return { text: await res.text(), finalUrl: res.url || url };
    } finally {
        clearTimeout(timer);
    }
}

// 直连订阅源读取最新文章；订阅地址失效时，再尝试从站点 HTML 发现新的 RSS/Atom 地址。
async function fetchLatestEntryDirect(feed, readerProxy = DEFAULT_FEED_READER_PROXY) {
    let lastError;
    if (feed.feed_url) {
        try {
            const { text, finalUrl } = await fetchFeedXml(feed.feed_url);
            const entry = parseFeedXml(text, finalUrl);
            if (entry) return entry;
            lastError = new Error('订阅源中没有可识别的文章');
        } catch (e) {
            lastError = e;
        }
    }

    if (feed.site_url) {
        try {
            const { text, finalUrl } = await fetchHtml(feed.site_url);
            const discovered = discoverFeedUrl(text, finalUrl);
            if (discovered) {
                const feedData = await fetchFeedXml(discovered);
                const entry = parseFeedXml(feedData.text, feedData.finalUrl);
                if (entry) return entry;
            }
        } catch (e) {
            lastError = e;
        }
    }

    // 有些站点会对服务器 IP 返回 Cloudflare 挑战页，但 Reader 仍能取到订阅源 XML。
    if (feed.feed_url && readerProxy) {
        try {
            const { text, finalUrl } = await fetchViaReader(feed.feed_url, readerProxy);
            const entry = parseFeedXml(text, finalUrl);
            if (entry) return entry;
        } catch (e) {
            lastError = e;
        }
    }

    throw lastError || new Error('缺少订阅源地址');
}

// 读取已有 JSON 作为本次同步的状态/缓存；缺失或损坏时返回 fallback。
function readJson(filename, fallback) {
    const filepath = path.join(DATA_DIR, filename);
    if (!existsSync(filepath)) return fallback;
    try {
        return JSON.parse(readFileSync(filepath, 'utf8'));
    } catch (e) {
        console.warn(`[cache] 读取 ${filename} 失败，将从空状态开始: ${e.message}`);
        return fallback;
    }
}

// 写入 JSON（带增量比较，不变则不写；默认空数组不覆盖已有非空数据）
async function writeJson(filename, data, options = {}) {
    const filepath = path.join(DATA_DIR, filename);
    const json = JSON.stringify(data, null, 2) + '\n';

    // 空数组保护：若新数据为空且已有非空数据，保留旧数据避免覆盖。
    // 派生数据（如 flux-lost.json，空数组是合法结果）可用 allowEmpty 关闭保护。
    const isEmpty = Array.isArray(data) ? data.length === 0 : data === null || (data && typeof data === 'object' && Object.keys(data).length === 0);
    if (!options.allowEmpty && isEmpty && existsSync(filepath)) {
        const existing = readFileSync(filepath, 'utf8');
        const existingTrimmed = existing.trim();
        if (existingTrimmed.length > 2) { // 非空 JSON（至少 '[]' 或 '{}' 之外有内容）
            console.log(`[keep] ${filename} 新数据为空，保留已有非空数据`);
            return false;
        }
    }

    if (existsSync(filepath)) {
        const existing = readFileSync(filepath, 'utf8');
        if (existing === json) {
            console.log(`[skip] ${filename} 无变化`);
            return false;
        }
    }
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(filepath, json, 'utf8');
    console.log(`[write] ${filename} (${(json.length / 1024).toFixed(1)} KB)`);
    return true;
}

// ---------- 字段白名单 ----------
// 只在 JSON 中保留这些字段，控制体积；上游全量拉取后裁剪。
// 启用新字段：往对应白名单加字段名，重跑同步即可（可逆）。

// tag 详情页的 posts 列表字段（不含 html，避免 60 个 tag 重复全文）
const TAG_POST_FIELDS = [
    'id', 'slug', 'title', 'excerpt', 'feature_image', 'feature_image_alt', 'feature_image_caption',
    'published_at', 'updated_at', 'created_at', 'reading_time', 'tags', 'type'
];

function trimTagPost(p) {
    const e = pick(p, TAG_POST_FIELDS);
    if (Array.isArray(e.tags)) e.tags = e.tags.map((t) => pick(t, TAG_FIELDS));
    e.type = 'post';
    return e;
}

// Ghost Post/Page 消费字段（页面渲染 + albums/rss/search/toc 等）
const GHOST_ENTRY_FIELDS = [
    'id', 'slug', 'title', 'html', 'excerpt',
    'feature_image', 'feature_image_alt', 'feature_image_caption',
    'published_at', 'updated_at', 'created_at', 'reading_time',
    'tags', 'authors', 'type'
];

// 内嵌 tag 对象消费字段（post.tags / tag 页）
const TAG_FIELDS = ['id', 'slug', 'name', 'visibility'];

// 内嵌 author 对象消费字段
const AUTHOR_FIELDS = ['id', 'slug', 'name', 'profile_image', 'cover_image', 'bio'];

function pick(obj, fields) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const f of fields) {
        if (f in obj) out[f] = obj[f];
    }
    return out;
}

// 递归裁剪 post/page：保留条目字段 + 裁剪内嵌 tags/authors
function trimEntry(entry, type) {
    const e = pick(entry, GHOST_ENTRY_FIELDS);
    if (Array.isArray(e.tags)) e.tags = e.tags.map((t) => pick(t, TAG_FIELDS));
    if (Array.isArray(e.authors)) e.authors = e.authors.map((a) => pick(a, AUTHOR_FIELDS));
    if (e.primary_author) e.primary_author = pick(e.primary_author, AUTHOR_FIELDS);
    e.type = type;
    return e;
}

// NeoDB 条目消费字段（douban 页）
const NEODB_ITEM_FIELDS = ['id', 'title', 'category', 'cover_image_url', 'url', 'uuid', 'localized_title', 'type'];
const NEODB_MARK_FIELDS = ['post_id', 'shelf', 'type', 'title', 'comment_text', 'rating_grade', 'item', 'created_time', 'visibility'];

// 提取中文标题：优先简体中文 localized_title，找不到时回退到其他中文标题和 title。
// TVSeason 常把“第 1 季”放在 zh-cn 中，不能把它当作品名；应继续找其他中文译名。
const CHINESE_TITLE_LANGS = ['zh-cn', 'zh-hans', 'zh', 'zh-sg', 'zh-hk', 'zh-tw', 'zh-hant'];
const SEASON_ONLY_TITLE = /^第\s*(?:\d+|[一二三四五六七八九十百千万]+)\s*季$/;

function pickChineseTitle(item, previousTitle) {
    if (!item) return undefined;

    const localized = Array.isArray(item.localized_title) ? item.localized_title : [];
    const chineseTitles = CHINESE_TITLE_LANGS.flatMap((lang) =>
        localized
            .filter((title) => title?.lang === lang && typeof title.text === 'string' && /[\u4e00-\u9fff]/.test(title.text))
            .map((title) => title.text.trim())
            .filter(Boolean)
    );

    // 先排除 TVSeason 常见的纯季名；若上游没有完整中文译名，保留上一次同步的中文名，避免数据回退。
    return (
        chineseTitles.find((title) => !SEASON_ONLY_TITLE.test(title)) ||
        ([item.title, previousTitle].find(
            (title) => typeof title === 'string' && /[\u4e00-\u9fff]/.test(title) && !SEASON_ONLY_TITLE.test(title.trim())
        ) ?? item.title)
    );
}

function trimNeodb(data, previousItems = new Map()) {
    if (!Array.isArray(data)) return data;
    return data.map((m) => {
        const out = pick(m, NEODB_MARK_FIELDS);
        if (out.item) {
            out.item = pick(out.item, NEODB_ITEM_FIELDS);
            const previousItem = previousItems.get(out.item.uuid);
            // 生成中文标题字段（douban 页展示用）
            out.item.title_cn = pickChineseTitle(out.item, previousItem?.title_cn || previousItem?.title);
        }
        return out;
    });
}

// Memo 消费字段（now 页）
const MEMO_FIELDS = ['id', 'content', 'createdTs', 'updatedTs', 'creatorName', 'resourceList', 'visibility', 'pinned'];
const RESOURCE_FIELDS = ['type', 'filename', 'link', 'externalLink'];

function trimMemos(memos) {
    return memos.map((m) => {
        const out = pick(m, MEMO_FIELDS);
        if (Array.isArray(out.resourceList)) out.resourceList = out.resourceList.map((r) => pick(r, RESOURCE_FIELDS));
        return { ...out, type: 'memo' };
    });
}

// ---------- 数据源 ----------
async function syncGhost(env) {
    const { TSGhostContentAPI } = await import('@ts-ghost/content-api');
    const api = new TSGhostContentAPI(env.GHOST_API_URL, env.GHOST_API_KEY, 'v5.0');
    const postLimit = parseInt(env.GHOST_API_POST_LIMIT || '9999', 10);

    const settings = await api.settings.fetch();

    // posts
    const posts = [];
    let cursor = await api.posts.browse().include({ authors: true, tags: true }).paginate();
    if (cursor.current.success) posts.push(...cursor.current.data);
    while (cursor.next && posts.length < postLimit) {
        cursor = await cursor.next.paginate();
        if (cursor.current.success) posts.push(...cursor.current.data);
    }

    // pages
    const pages = [];
    let pc = await api.pages.browse().include({ authors: true, tags: true }).paginate();
    if (pc.current.success) pages.push(...pc.current.data);
    while (pc.next) {
        pc = await pc.next.paginate();
        if (pc.current.success) pages.push(...pc.current.data);
    }

    // authors
    const authorsRes = await api.authors.browse().include({ 'count.posts': true }).fetch();
    const authors = authorsRes.success ? authorsRes.data : [];

    // tags（复用已拉取 posts 避免重复请求）
    const trimmedPosts = posts.map((p) => trimEntry(p, 'post'));

    // P0 数据安全：ghost 是核心数据。若拉取结果为空（网络/认证失败被静默吞掉），拒绝写入，避免用空数据覆盖线上。
    if (!posts.length) {
        throw new Error('Ghost 拉取到 0 篇文章（疑似认证/网络失败），拒绝写入，保留已有数据');
    }

    const tagsRes = await api.tags.browse({ limit: 'all', order: 'count.posts desc' }).include({ 'count.posts': true }).fetch();
    const tags = tagsRes.success
        ? tagsRes.data.map((tag) => ({
              ...pick(tag, [...TAG_FIELDS, 'count']),
              posts: trimmedPosts.filter((p) => p.tags && p.tags.some((t) => t.slug === tag.slug)).map(trimTagPost)
          }))
        : [];

    return {
        settings: settings.success ? settings.data : null,
        posts: trimmedPosts,
        pages: pages.map((p) => trimEntry(p, 'page')),
        authors: authors.map((a) => pick(a, AUTHOR_FIELDS)),
        tags
    };
}

function neodbKey(mark) {
    return String(mark?.post_id ?? `${mark?.item?.uuid || ''}|${mark?.created_time || ''}`);
}

async function syncNeodb(env) {
    const token = env.NEODB_TOKEN;
    if (!token) throw new Error('缺少 NEODB_TOKEN，无法直连 NeoDB API');

    const apiBase = (env.NEODB_API_URL || 'https://neodb.social/api').replace(/\/$/, '');
    const shelves = (env.NEODB_SHELVES || 'complete').split(',').map((item) => item.trim()).filter(Boolean);
    const fullSync = env.SYNC_FULL === '1';
    const previousPath = path.join(DATA_DIR, 'neodb.json');
    let previous = { data: [] };
    if (existsSync(previousPath)) {
        try {
            previous = JSON.parse(readFileSync(previousPath, 'utf8'));
        } catch (e) {
            console.warn(`[neodb] 读取已有缓存失败，将执行全量同步: ${e.message}`);
        }
    }
    const previousMarks = Array.isArray(previous.data) ? previous.data : [];
    const previousItems = new Map(previousMarks.filter((m) => m.item?.uuid).map((m) => [m.item.uuid, m.item]));
    const known = new Set(previousMarks.map(neodbKey));
    const fetched = [];
    let stoppedEarly = false;

    for (const shelf of shelves) {
        let page = 1;
        let pages = 1;
        do {
            let data;
            let lastError;
            for (let attempt = 1; attempt <= 3; attempt += 1) {
                try {
                    data = await fetchJson(
                        `${apiBase}/me/shelf/${encodeURIComponent(shelf)}?page=${page}`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                Accept: 'application/json',
                                'User-Agent': 'astro-book-sync'
                            }
                        },
                        30000
                    );
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
                }
            }
            if (!data) throw new Error(`[neodb] ${shelf} 第 ${page} 页获取失败: ${lastError?.message || '未知错误'}`);
            if (!Array.isArray(data.data)) throw new Error(`[neodb] ${shelf} 第 ${page} 页响应缺少 data 数组`);

            const pageMarks = data.data.map((mark) => ({ ...mark, shelf: mark.shelf ?? mark.shelf_type }));
            const pageNew = pageMarks.filter((mark) => !known.has(neodbKey(mark)));
            if (!fullSync && previousMarks.length > 0 && pageNew.length === 0) {
                stoppedEarly = true;
                break;
            }
            fetched.push(...(fullSync ? pageMarks : pageNew));
            pageNew.forEach((mark) => known.add(neodbKey(mark)));
            pages = Math.max(1, Number(data.pages) || 1);
            page += 1;
            if (page <= pages) await new Promise((resolve) => setTimeout(resolve, 150));
        } while (page <= pages);
    }

    const merged = fullSync ? fetched : [...previousMarks, ...fetched];
    if (merged.length === 0) throw new Error('[neodb] API 返回 0 条记录，拒绝覆盖已有数据');
    const deduped = [...new Map(merged.map((mark) => [neodbKey(mark), mark])).values()];
    deduped.sort((a, b) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime());
    console.log(`[neodb] ${fullSync ? '全量' : '增量'}同步：拉取 ${fetched.length} 条，合并后 ${deduped.length} 条`);

    return { data: trimNeodb(deduped, previousItems) };
}

async function syncFlux(env) {
    const readerProxy = env.FLUX_READER_PROXY === '0' || env.FLUX_READER_PROXY === 'false' ? '' : env.FLUX_READER_PROXY || DEFAULT_FEED_READER_PROXY;

    // 获取 feeds。这里是「订阅目录」的唯一来源，失败或为空时必须保留已有数据。
    const feedsData = await fetchJson(`${env.FLUX_URL}/categories/4/feeds`, {
        headers: { 'X-Auth-Token': env.FLUX_KEY }
    });
    const feeds = Array.isArray(feedsData) ? feedsData : feedsData.feeds;
    if (!Array.isArray(feeds) || feeds.length === 0) {
        throw new Error('[flux] 分类 4 没有返回任何订阅（疑似 Miniflux API 异常），保留已有数据');
    }

    // 并发获取每个 feed 的最新文章（限制并发避免过载）。
    // 单条失败不抛全局错误，交给 buildFluxSnapshot 用上一份缓存兜底。
    const CONCURRENCY = 10;
    const latestResults = [];
    let failed = 0;
    for (let i = 0; i < feeds.length; i += CONCURRENCY) {
        const batch = feeds.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
            batch.map(async (feed) => {
                try {
                    const ed = await fetchJson(
                        `${env.FLUX_URL}/feeds/${feed.id}/entries?limit=1&order=published_at&direction=desc`,
                        { headers: { 'X-Auth-Token': env.FLUX_KEY } },
                        15000
                    );
                    const list = Array.isArray(ed) ? ed : Array.isArray(ed.entries) ? ed.entries : [];
                    return { feedId: feed.id, entry: list.length > 0 ? list[0] : null };
                } catch (e) {
                    console.warn(`[flux] feed ${feed.id} 最新文章获取失败: ${e.message}`);
                    return { feedId: feed.id, entry: null, error: e.message };
                }
            })
        );
        latestResults.push(...batchResults);
        failed += batchResults.filter((r) => r.error).length;
    }

    // 大面积失败通常是 Miniflux 自身异常，而不是这些订阅同时失效；直接放弃本次写入。
    if (failed > feeds.length / 2) {
        throw new Error(`[flux] ${failed}/${feeds.length} 个订阅最新文章请求失败（疑似 Miniflux API 异常），保留已有数据`);
    }

    // Miniflux 可能因为条件请求缓存或历史清理拿不到某些订阅的最新文章。
    // 对这类订阅直接读取一次订阅源，避免把仍有文章的站点误判成「失联」。
    const feedById = new Map(feeds.map((feed) => [String(feed.id), feed]));
    const resultIndexByFeed = new Map(latestResults.map((result, index) => [String(result.feedId), index]));
    const fallbackFeeds = latestResults
        .filter((result) => !result.entry && !result.error)
        .map((result) => feedById.get(String(result.feedId)))
        .filter((feed) => feed && !feed.disabled && Number(feed.parsing_error_count || 0) < PARSING_ERROR_LIMIT);

    if (fallbackFeeds.length > 0) {
        console.log(`[flux] ${fallbackFeeds.length} 个订阅在 Miniflux 中没有文章，尝试直连订阅源`);
    }

    let directFailed = 0;
    for (let i = 0; i < fallbackFeeds.length; i += CONCURRENCY) {
        const batch = fallbackFeeds.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
            batch.map(async (feed) => {
                try {
                    return { feedId: feed.id, entry: await fetchLatestEntryDirect(feed, readerProxy) };
                } catch (e) {
                    directFailed++;
                    console.warn(`[flux] feed ${feed.id} 直连订阅源失败: ${e.message}`);
                    return { feedId: feed.id, entry: null, error: `直连订阅源失败: ${e.message}` };
                }
            })
        );
        for (const result of batchResults) {
            const index = resultIndexByFeed.get(String(result.feedId));
            if (index !== undefined) latestResults[index] = result;
        }
    }
    if (directFailed > 0) {
        console.warn(`[flux] ${directFailed}/${fallbackFeeds.length} 个订阅直连抓取失败`);
    }

    // 用上一份数据作为缓存：失败时沿用旧文章，失联时间也保持稳定。
    return buildFluxSnapshot({
        feeds,
        latestResults,
        previousEntries: readJson('flux.json', []),
        previousLost: readJson('flux-lost.json', [])
    });
}

function gtsTimestamp(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
}

function gtsResourceList(status) {
    const attachments = Array.isArray(status.media_attachments) ? status.media_attachments : [];
    return attachments
        .filter((attachment) => attachment && (attachment.type === 'image' || attachment.type === 'video' || attachment.type === 'gifv' || attachment.type === 'audio'))
        .map((attachment) => ({
            type: attachment.type === 'gifv' ? 'video' : attachment.type,
            filename: attachment.url || attachment.remote_url || '',
            externalLink: attachment.remote_url || attachment.url || '',
            link: attachment.text_url || attachment.url || ''
        }));
}

function gtsStatusToMemo(status, owner) {
    const source = status.reblog || status;
    const author = status.account || owner || {};
    const sourceAuthor = source.account || author;
    const boostContent = status.reblog
        ? `${author.display_name || author.username || '我'} 转嘟 <a href="${sourceAuthor.url || '#'}" target="_blank" rel="noopener noreferrer">@${sourceAuthor.acct || sourceAuthor.username || '未知'}</a>:\n${source.content || ''}`
        : status.content || '';

    return {
        id: status.id,
        content: boostContent,
        createdTs: gtsTimestamp(status.created_at),
        updatedTs: gtsTimestamp(status.edited_at || status.created_at),
        creatorName: author.display_name || author.username || '1900',
        resourceList: gtsResourceList(source),
        visibility: String(status.visibility || 'public').toUpperCase(),
        pinned: Boolean(status.pinned),
        type: 'memo'
    };
}

async function syncGtsMemos(env) {
    const base = env.GOTOSOCIAL_URL.replace(/\/$/, '');
    const headers = {
        Authorization: `Bearer ${env.GOTOSOCIAL_TOKEN}`,
        Accept: 'application/json',
        'User-Agent': 'astro-book-sync'
    };
    let accountId = env.GOTOSOCIAL_ACCOUNT_ID;
    let owner = null;
    if (!accountId) {
        owner = await fetchJson(`${base}/api/v1/accounts/verify_credentials`, { headers }, 20000);
        accountId = owner?.id;
        if (!accountId) throw new Error('[memos] GoToSocial 未能返回当前账号 ID');
    }

    const fullSync = env.SYNC_FULL === '1';
    const previous = readJson('memos.json', []);
    const known = new Set(previous.map((memo) => String(memo.id)));
    const fetched = [];
    let maxId = '';
    let stoppedEarly = false;

    for (let page = 0; page < 200; page += 1) {
        const url = `${base}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?limit=40${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`;
        const statuses = await fetchJson(url, { headers }, 30000);
        if (!Array.isArray(statuses) || statuses.length === 0) break;

        const newStatuses = statuses.filter((status) => status.id && !known.has(String(status.id)));
        if (!fullSync && previous.length > 0 && newStatuses.length === 0) {
            stoppedEarly = true;
            break;
        }
        fetched.push(...(fullSync ? statuses : newStatuses).map((status) => gtsStatusToMemo(status, owner)));
        statuses.forEach((status) => status.id && known.add(String(status.id)));
        const lastId = statuses[statuses.length - 1]?.id;
        if (!lastId || lastId === maxId) break;
        maxId = lastId;
        if (statuses.length < 40) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const merged = fullSync ? fetched : [...previous, ...fetched];
    if (merged.length === 0) throw new Error('[memos] GoToSocial 返回 0 条动态，拒绝覆盖已有数据');
    const deduped = [...new Map(merged.map((memo) => [String(memo.id), memo])).values()];
    deduped.sort((a, b) => Number(b.createdTs) - Number(a.createdTs));
    console.log(`[memos] ${fullSync ? '全量' : '增量'}同步：拉取 ${fetched.length} 条，合并后 ${deduped.length} 条`);
    return trimMemos(deduped);
}

async function syncMemos(env, siteConfig) {
    if (env.GOTOSOCIAL_URL && env.GOTOSOCIAL_TOKEN) {
        return syncGtsMemos(env);
    }

    // 兼容旧的 Memos API；新配置应优先使用 GOTOSOCIAL_URL + GOTOSOCIAL_TOKEN。
    const all = [];
    let offset = 0;
    const PAGE = 50;
    for (;;) {
        const url = `${siteConfig.memos.url}?limit=${PAGE}&offset=${offset}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) {
            console.warn(`[memos] HTTP ${res.status}，停止拉取`);
            break;
        }
        const total = parseInt(res.headers.get('X-Total-Count') || '0', 10);
        const page = await res.json();
        all.push(...(Array.isArray(page) ? page : []));
        offset += PAGE;
        if (!total || offset >= total) break;
        if (page.length < PAGE) break;
    }
    return trimMemos(all.map((m) => ({ ...m, type: 'memo' })));
}

// ---------- intervals.icu（运动记录） ----------
const INTERVALS_BASE = 'https://intervals.icu/api/v1';
// 从这一年开始拉取活动；更早的活动即使账号里有也不会出现在页面上。
const INTERVALS_FIRST_YEAR = 2015;
const INTERVALS_ACTIVITY_FIELDS =
    'id,name,type,sub_type,start_date,start_date_local,distance,moving_time,elapsed_time,average_heartrate,average_speed,total_elevation_gain,source,external_id';
// 地图请求用小并发，避免被上游限流；单个失败只 warn，不中断整次同步。
const ROUTE_CONCURRENCY = 5;

/** 拉取单个活动的轨迹；返回 { polyline } 或 { error }，两者都没有表示上游确实没有 GPS 数据。 */
async function fetchIntervalsMap(id, authorization) {
    try {
        const data = await fetchJson(`${INTERVALS_BASE}/activity/${encodeURIComponent(id)}/map`, { headers: { Authorization: authorization } }, 20000);
        return { polyline: polylineFromMap(data) };
    } catch (error) {
        console.warn(`[intervals] 活动 ${id} 地图获取失败: ${error.message}`);
        return { error: error.message };
    }
}

/**
 * 运动记录同步：数据源只有 intervals.icu。
 * 1) 按自然年窗口全量拉取活动（每窗口 limit=500，按 id 去重）；
 * 2) 用上一版 activities.json 的轨迹做增量缓存，只有缺失轨迹（且距离 > 0）的活动才请求 /map；
 * 3) 按 start_date_local 升序输出 Activities 契约数组。
 */
async function syncIntervals(env) {
    const apiKey = env.INTERVALS_ICU_API_KEY;
    if (!apiKey) throw new Error('缺少 INTERVALS_ICU_API_KEY');
    const athleteId = env.INTERVALS_ICU_ATHLETE_ID || '0';
    const fullSync = env.SYNC_FULL === '1';
    const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;

    const rawById = new Map();
    const windowSummary = [];
    let rawTotal = 0;
    const thisYear = new Date().getUTCFullYear();
    for (const { oldest, newest } of yearWindows(INTERVALS_FIRST_YEAR, thisYear)) {
        const params = new URLSearchParams({ oldest, newest, limit: '500', fields: INTERVALS_ACTIVITY_FIELDS });
        const url = `${INTERVALS_BASE}/athlete/${encodeURIComponent(athleteId)}/activities?${params}`;
        const data = await fetchJson(url, { headers: { Authorization: authorization } }, 30000);
        if (!Array.isArray(data)) throw new Error(`[intervals] ${oldest} ~ ${newest} 返回了非数组活动数据`);
        if (data.length >= 500) console.warn(`[intervals] ${oldest} ~ ${newest} 达到单次 500 条上限，可能有活动被截断`);
        for (const activity of data) {
            if (activity?.id) rawById.set(String(activity.id), activity);
        }
        rawTotal += data.length;
        windowSummary.push(`${oldest.slice(0, 4)}:${data.length}`);
    }
    // 空结果多半是认证/上游异常：拒绝写入，避免用空数组覆盖线上数据。
    if (rawById.size === 0) throw new Error('[intervals] intervals.icu 返回 0 条活动，拒绝覆盖已有数据');
    console.log(`[intervals] 分年拉取 ${windowSummary.join(' ')} → 合计 ${rawTotal} 条，按 id 去重后 ${rawById.size} 条`);
    if (rawTotal !== rawById.size) console.warn(`[intervals] 分年窗口有 ${rawTotal - rawById.size} 条重复活动（已按 id 去重）`);

    const cachedRoutes = new Map(
        readJson('activities.json', [])
            .filter((item) => item?.id && typeof item.polyline === 'string' && item.polyline.length > 0)
            .map((item) => [String(item.id), item.polyline])
    );
    const activities = applyRouteCache(
        [...rawById.values()].map((activity) => toActivity(activity)),
        cachedRoutes,
        fullSync
    );
    const total = activities.length;
    const reused = activities.filter((activity) => activity.polyline).length;

    const pending = pendingRouteIds(activities);
    const byId = new Map(activities.map((activity) => [activity.id, activity]));
    let fetched = 0;
    let empty = 0;
    let failed = 0;
    for (let index = 0; index < pending.length; index += ROUTE_CONCURRENCY) {
        const batch = pending.slice(index, index + ROUTE_CONCURRENCY);
        const results = await Promise.all(batch.map(async (id) => ({ id, ...(await fetchIntervalsMap(id, authorization)) })));
        for (const result of results) {
            if (result.polyline) {
                byId.get(result.id).polyline = result.polyline;
                fetched += 1;
            } else if (result.error) {
                failed += 1;
            } else {
                // 上游这条活动本身没有 GPS（室内跑步/器械等），不算失败，下次同步也拉不到。
                empty += 1;
            }
        }
        if (pending.length > ROUTE_CONCURRENCY) console.log(`[intervals] 轨迹进度 ${Math.min(index + batch.length, pending.length)}/${pending.length}`);
    }

    const withRoute = activities.filter((activity) => activity.polyline).length;
    console.log(
        `[intervals] 活动 ${total} 条（${fullSync ? '全量' : '全量活动 + 增量轨迹'}），复用轨迹 ${reused} 条，新拉轨迹 ${fetched} 条，上游无轨迹 ${empty} 条，失败 ${failed} 条，有轨迹 ${withRoute} 条`
    );
    return sortActivities(activities);
}

async function syncMap(env) {
    if (!env.MAP_KMZ_URL) throw new Error('缺少 MAP_KMZ_URL，无法同步地图数据');

    const outputFile = path.join(DATA_DIR, 'geojson.json');
    const headers = { 'User-Agent': 'astro-book-map-sync' };
    if (env.SYNC_FULL !== '1' && existsSync(outputFile)) headers['If-Modified-Since'] = statSync(outputFile).mtime.toUTCString();

    const response = await fetch(env.MAP_KMZ_URL, {
        signal: AbortSignal.timeout(30000),
        headers
    });
    if (response.status === 304 && existsSync(outputFile)) {
        console.log('[map] 未修改，复用本地 geojson.json');
        return JSON.parse(readFileSync(outputFile, 'utf8'));
    }
    if (!response.ok) throw new Error(`[map] KMZ 下载失败: HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error('[map] KMZ 文件为空');

    const tempFile = path.join(tmpdir(), `astro-book-map-${Date.now()}.kmz`);
    writeFileSync(tempFile, buffer);
    try {
        execFileSync(process.env.PYTHON || 'python3', [
            path.join(__dirname, 'map', 'convert_kmz_to_geojson.py'),
            tempFile,
            outputFile
        ], { stdio: 'inherit' });
    } finally {
        try {
            if (existsSync(tempFile)) unlinkSync(tempFile);
        } catch {
            // 临时文件清理失败不影响同步结果。
        }
    }

    const geojson = JSON.parse(readFileSync(outputFile, 'utf8'));
    if (!Array.isArray(geojson.features)) throw new Error('[map] 转换结果缺少 features');
    return geojson;
}

async function syncRank() {
    try {
        return await fetchJson('https://divine-cell-831a.me-d1b.workers.dev/', {}, 10000);
    } catch (e) {
        console.warn('[rank] 获取失败:', e.message);
        return null;
    }
}

// ---------- 图片 meta 预取（方案 B：构建零网络） ----------
// 从 ghost.json 提取所有图片 URL，预取尺寸写入 src/data/image-meta.json
// 构建时 RemotePicture 直接读本地 JSON，不再 fetch cdn.1900.live!exif
async function syncImageMeta() {
    const ghostPath = path.join(DATA_DIR, 'ghost.json');
    if (!existsSync(ghostPath)) return {};
    const ghost = JSON.parse(readFileSync(ghostPath, 'utf8'));

    // 收集所有图片 URL（posts + pages 的 html 和 feature_image）
    const urls = new Set();
    const entries = [...(ghost.posts || []), ...(ghost.pages || [])];
    entries.forEach((p) => {
        if (p.feature_image) urls.add(p.feature_image);
        if (p.html) {
            const re = /<img[^>]+src=["']([^"']+)["']/g;
            let m;
            while ((m = re.exec(p.html)) !== null) urls.add(m[1]);
        }
    });

    // 读取已有缓存（避免重复请求）
    const metaPath = path.join(DATA_DIR, 'image-meta.json');
    const existing = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};

    // 只处理 cdn.1900.live 的图片（RemotePicture 只对这些 fetch）
    const cdnUrls = [...urls].filter((u) => u.startsWith('https://cdn.1900.live/'));
    const toFetch = cdnUrls.filter((u) => !existing[`size_${u}`] && !existing[`error_${u}`]);

    console.log(`[imagemeta] 共 ${cdnUrls.length} 张 cdn 图片，需新获取 ${toFetch.length} 张`);

    // 并发获取（限制并发避免过载）
    const CONCURRENCY = 10;
    let fetched = 0;
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
        const batch = toFetch.slice(i, i + CONCURRENCY);
        await Promise.all(
            batch.map(async (url) => {
                try {
                    const meta = await fetchJson(`${encodeURI(url)}!exif`, {}, 10000);
                    existing[`size_${url}`] = { width: meta.width, height: meta.height };
                } catch (e) {
                    existing[`error_${url}`] = { timestamp: Date.now(), error: e.message };
                }
                fetched++;
            })
        );
        console.log(`[imagemeta] 进度 ${fetched}/${toFetch.length}`);
    }

    return existing;
}

// ---------- 主流程 ----------
const SOURCES = {
    ghost: { run: (env, site) => syncGhost(env), file: 'ghost.json' },
    neodb: { run: (env) => syncNeodb(env), file: 'neodb.json' },
    flux: {
        run: (env) => syncFlux(env),
        // 同一个源的两次 Miniflux 拉取结果拆成两份数据：
        // flux.json 仍保持原来的「最新文章数组」结构，flux-lost.json 是派生出的失联订阅。
        files: (data) => [
            { file: 'flux.json', data: data.entries },
            { file: 'flux-lost.json', data: data.lost, allowEmpty: true }
        ]
    },
    memos: { run: (env, site) => syncMemos(env, site), file: 'memos.json' },
    intervals: { run: (env) => syncIntervals(env), file: 'activities.json' },
    map: { run: (env) => syncMap(env), file: 'geojson.json' },
    rank: { run: () => syncRank(), file: 'rank.json' },
    imagemeta: { run: () => syncImageMeta(), file: 'image-meta.json' }
};

function sourceFiles(src, data) {
    return typeof src.files === 'function' ? src.files(data) : [{ file: src.file, data }];
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fullSync = args.includes('--full') || process.env.SYNC_FULL === '1';
const only = args.filter((a) => !a.startsWith('--'));

async function main() {
    const env = loadEnv();
    env.SYNC_FULL = fullSync ? '1' : '0';
    const site = await loadSiteConfig();

    const sources = only.length ? only.filter((s) => SOURCES[s]) : Object.keys(SOURCES);
    if (only.length && sources.length !== only.length) {
        console.warn('未知源:', only.filter((s) => !SOURCES[s]).join(', '), '（可用:', Object.keys(SOURCES).join(','), '）');
    }

    console.log(`开始同步 [${sources.join(', ')}]${dryRun ? ' (dry-run)' : ''}${fullSync ? ' (full)' : ' (incremental)'}`);

    let changed = 0;
    let failed = 0;
    for (const name of sources) {
        const src = SOURCES[name];
        try {
            const data = await src.run(env, site);
            const outputs = sourceFiles(src, data);
            if (dryRun) {
                for (const output of outputs) {
                    console.log(`[dry-run] ${output.file} 将写入 ${Array.isArray(output.data) ? output.data.length : Object.keys(output.data).length} 项`);
                }
            } else {
                for (const output of outputs) {
                    if (await writeJson(output.file, output.data, { allowEmpty: output.allowEmpty })) changed++;
                }
            }
        } catch (e) {
            failed++;
            console.error(`[${name}] 同步失败: ${e.message}`);
        }
    }

    console.log(dryRun ? 'dry-run 完成（未写盘）' : `同步完成，${changed} 个文件有变化`);
    return failed;
}

main().then((failed) => {
    if (failed > 0) {
        console.error(`同步完成，${failed} 个源失败`);
        process.exit(1);
    }
}).catch((e) => {
    console.error('脚本异常:', e);
    process.exit(1);
});
