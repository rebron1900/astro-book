#!/usr/bin/env node
/**
 * 数据同步脚本：从各外部源拉取数据，落地为 src/data/*.json
 * 供 Astro 构建时离线读取（零运行时网络依赖）。
 *
 * 用法:
 *   node scripts/sync-data.mjs            # 全量同步所有源
 *   node scripts/sync-data.mjs ghost      # 只同步指定源(逗号分隔)
 *   node scripts/sync-data.mjs --dry-run  # 预览将要写入的文件(不写盘)
 *
 * 需要环境变量(或 .env 文件): GHOST_API_URL, GHOST_API_KEY,
 *   NEODB_URL, FLUX_URL, FLUX_KEY
 * 非密钥配置从 src/config/site.ts 读取。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
        if (k.startsWith('GHOST_') || k.startsWith('NEODB_') || k.startsWith('FLUX_') || k.startsWith('MAP_') || k.startsWith('CDN_')) {
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
            memos: { url: 'https://m2m.996288.xyz/api/v1/memo', siteURL: 'https://m2m.996288.xyz' },
            strava: { activitiesUrl: '' }
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

// 写入 JSON（带增量比较，不变则不写；空数组不覆盖已有非空数据）
async function writeJson(filename, data) {
    const filepath = path.join(DATA_DIR, filename);
    const json = JSON.stringify(data, null, 2) + '\n';

    // 空数组保护：若新数据为空且已有非空数据，保留旧数据避免覆盖
    const isEmpty = Array.isArray(data) ? data.length === 0 : data === null || (data && typeof data === 'object' && Object.keys(data).length === 0);
    if (isEmpty && existsSync(filepath)) {
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
const NEODB_ITEM_FIELDS = ['id', 'title', 'category', 'cover_image_url', 'url', 'uuid'];
const NEODB_MARK_FIELDS = ['shelf', 'type', 'title', 'comment_text', 'rating_grade', 'item', 'created_time', 'visibility'];

function trimNeodb(data) {
    if (!Array.isArray(data)) return data;
    return data.map((m) => {
        const out = pick(m, NEODB_MARK_FIELDS);
        if (out.item) out.item = pick(out.item, NEODB_ITEM_FIELDS);
        return out;
    });
}

// Flux 条目消费字段（links 页）
const FLUX_ENTRY_FIELDS = ['title', 'url', 'link', 'published_at', 'created_at', 'date', 'feed', 'feed_id', 'update_timestamp'];
const FLUX_FEED_FIELDS = ['id', 'site_url', 'title'];

function trimFlux(entries) {
    return entries.map((e) => {
        const out = pick(e, FLUX_ENTRY_FIELDS);
        if (out.feed) out.feed = pick(out.feed, FLUX_FEED_FIELDS);
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

async function syncNeodb(env) {
    const data = await fetchJson(env.NEODB_URL);
    if (data && Array.isArray(data.data)) {
        return { ...data, data: trimNeodb(data.data) };
    }
    return data;
}

async function syncFlux(env) {
    // 获取 feeds
    const feedsData = await fetchJson(`${env.FLUX_URL}/categories/4/feeds`, {
        headers: { 'X-Auth-Token': env.FLUX_KEY }
    });
    const feeds = feedsData.feeds || feedsData;

    // 并发获取每个 feed 的最新文章（限制并发避免过载）
    const CONCURRENCY = 10;
    const entries = [];
    for (let i = 0; i < feeds.length; i += CONCURRENCY) {
        const batch = feeds.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
            batch.map(async (feed) => {
                try {
                    const ed = await fetchJson(
                        `${env.FLUX_URL}/feeds/${feed.id}/entries?limit=1&order=published_at&direction=desc`,
                        { headers: { 'X-Auth-Token': env.FLUX_KEY } },
                        15000
                    );
                    const list = ed.entries || ed;
                    if (list.length > 0) {
                        const latest = list[0];
                        const domain = new URL(feed.site_url).origin;
                        return {
                            ...latest,
                            feed_id: feed.id,
                            feed: { ...feed, site_url: domain },
                            update_timestamp: new Date(latest.published_at || latest.created_at || latest.date).getTime()
                        };
                    }
                } catch (e) {
                    console.warn(`[flux] feed ${feed.id} 失败: ${e.message}`);
                }
                return null;
            })
        );
        entries.push(...results.filter(Boolean));
    }

    entries.sort((a, b) => (b.update_timestamp || 0) - (a.update_timestamp || 0));
    return trimFlux(entries);
}

async function syncMemos(siteConfig) {
    // 全量拉取（分页）
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

async function syncStrava(siteConfig) {
    if (!siteConfig.strava?.activitiesUrl) return [];
    return await fetchJson(siteConfig.strava.activitiesUrl);
}

async function syncRank() {
    try {
        return await fetchJson('https://divine-cell-831a.me-d1b.workers.dev/', {}, 10000);
    } catch (e) {
        console.warn('[rank] 获取失败:', e.message);
        return null;
    }
}

// ---------- 主流程 ----------
const SOURCES = {
    ghost: { run: (env, site) => syncGhost(env), file: 'ghost.json' },
    neodb: { run: (env) => syncNeodb(env), file: 'neodb.json' },
    flux: { run: (env) => syncFlux(env), file: 'flux.json' },
    memos: { run: (env, site) => syncMemos(site), file: 'memos.json' },
    strava: { run: (env, site) => syncStrava(site), file: 'strava.json' },
    rank: { run: () => syncRank(), file: 'rank.json' }
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.filter((a) => !a.startsWith('--'));

async function main() {
    const env = loadEnv();
    const site = await loadSiteConfig();

    const sources = only.length ? only.filter((s) => SOURCES[s]) : Object.keys(SOURCES);
    if (only.length && sources.length !== only.length) {
        console.warn('未知源:', only.filter((s) => !SOURCES[s]).join(', '), '（可用:', Object.keys(SOURCES).join(','), '）');
    }

    console.log(`开始同步 [${sources.join(', ')}]${dryRun ? ' (dry-run)' : ''}`);

    let changed = 0;
    let failed = 0;
    for (const name of sources) {
        const src = SOURCES[name];
        try {
            const data = await src.run(env, site);
            if (dryRun) {
                console.log(`[dry-run] ${src.file} 将写入 ${Array.isArray(data) ? data.length : Object.keys(data).length} 项`);
            } else {
                if (await writeJson(src.file, data)) changed++;
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
