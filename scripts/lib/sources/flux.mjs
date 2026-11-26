/**
 * RSS 订阅快照 → src/data/flux.json（flux.feed）+ src/data/flux-lost.json（flux.lost）。
 *
 * 迁移自 scripts/sync-data.mjs 的 syncFlux / fetchLatestEntryDirect / fetchFeedXml / fetchHtml /
 * fetchViaReader，行为逐行保留：一个源两个产物（任一不过整源不写）、>50% feed 失败放弃本轮、
 * 单订阅失败沿用上一版文章与失联时间、Miniflux 无文章时直连订阅源兜底、PARSING_ERROR_LIMIT、
 * FLUX_READER_PROXY 可选。失联/排序/裁剪逻辑仍在 src/lib/flux-snapshot.ts（纯函数）。
 *
 * 传输：Miniflux REST 走 ctx.fetchJson（X-Auth-Token，声明在 sensitiveHeaders）；
 * 直连订阅源要读 XML/HTML 文本，走 ctx.fetchBinary 再按 UTF-8 解码 —— 这样仍然由执行器
 * 负责超时、跨源剥头与脱敏，模块不直接碰 fetch。
 */
import { discoverFeedUrl, parseFeedXml } from '../../../src/lib/feed-xml.ts';
import { buildFluxSnapshot, PARSING_ERROR_LIMIT } from '../../../src/lib/flux-snapshot.ts';

export const meta = {
    id: 'flux',
    optional: false,
    credentials: ['FLUX_URL', 'FLUX_KEY'],
    optionalCredentials: ['FLUX_READER_PROXY'],
    sensitiveHeaders: ['x-auth-token'],
    datasets: ['flux.feed', 'flux.lost'],
    datasetVersions: { 'flux.feed': 1, 'flux.lost': 1 },
    description: 'RSS 订阅最新文章 + 失联订阅（Miniflux 为主，直连订阅源兜底）'
};

// 直连订阅源时使用的 UA（部分站点会拦截默认的 Node UA）。
const FEED_FETCH_USER_AGENT = [
    'Mozilla', '5.0', '(Windows NT 10.0; Win64; x64)', 'AppleWebKit/537.36', '(KHTML, like Gecko)', 'Chrome/131.0.0.0', 'Safari/537.36',
    'AstroBookFeedFetcher/1.0'
].join(' ');
const DEFAULT_FEED_READER_PROXY = 'https://r.jina.ai/';
const CONCURRENCY = 10;

/** 取文本（XML/HTML）：ctx.fetchBinary 拿字节，按 UTF-8 解码；非 2xx 抛出带分类的错误。 */
async function fetchText(ctx, url, accept, timeoutMs = 15000) {
    const result = await ctx.fetchBinary(url, { headers: { 'User-Agent': FEED_FETCH_USER_AGENT, Accept: accept } }, timeoutMs);
    if (!result.ok || !result.bytes) {
        const error = new Error(`HTTP ${result.status} ${result.statusText || ''}`);
        error.code = result.status === 401 || result.status === 403 ? 'auth' : 'upstream';
        throw error;
    }
    return Buffer.from(result.bytes).toString('utf8');
}

async function fetchFeedXml(ctx, url) {
    const text = await fetchText(ctx, url, 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', 15000);
    if (!text) throw new Error('订阅源返回空响应');
    return { text, finalUrl: url };
}

async function fetchHtml(ctx, url) {
    const text = await fetchText(ctx, url, 'text/html,application/xhtml+xml', 15000);
    return { text, finalUrl: url };
}

/** 直连被 Cloudflare 等拦截时的最后兜底：通过 Jina Reader 以 XML 原文形式取回订阅源。 */
async function fetchViaReader(ctx, url, readerProxy) {
    const text = await fetchText(ctx, `${readerProxy}${url}`, 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain, */*', 30000);
    if (!text) throw new Error('Reader 返回空响应');
    return { text, finalUrl: url };
}

/** 直连订阅源读取最新文章；订阅地址失效时，再尝试从站点 HTML 发现新的 RSS/Atom 地址。 */
async function fetchLatestEntryDirect(ctx, feed, readerProxy) {
    let lastError;
    if (feed.feed_url) {
        try {
            const { text, finalUrl } = await fetchFeedXml(ctx, feed.feed_url);
            const entry = parseFeedXml(text, finalUrl);
            if (entry) return entry;
            lastError = new Error('订阅源中没有可识别的文章');
        } catch (e) {
            lastError = e;
        }
    }

    if (feed.site_url) {
        try {
            const { text, finalUrl } = await fetchHtml(ctx, feed.site_url);
            const discovered = discoverFeedUrl(text, finalUrl);
            if (discovered) {
                const feedData = await fetchFeedXml(ctx, discovered);
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
            const { text, finalUrl } = await fetchViaReader(ctx, feed.feed_url, readerProxy);
            const entry = parseFeedXml(text, finalUrl);
            if (entry) return entry;
        } catch (e) {
            lastError = e;
        }
    }

    throw lastError || new Error('缺少订阅源地址');
}

export async function collect(ctx) {
    const env = ctx.env;
    const readerProxy = env.FLUX_READER_PROXY === '0' || env.FLUX_READER_PROXY === 'false' ? '' : env.FLUX_READER_PROXY || DEFAULT_FEED_READER_PROXY;

    // 获取 feeds。这里是「订阅目录」的唯一来源，失败或为空时必须保留已有数据。
    const feedsData = await ctx.fetchJson(`${env.FLUX_URL}/categories/4/feeds`, {
        headers: { 'X-Auth-Token': env.FLUX_KEY }
    });
    const feeds = Array.isArray(feedsData) ? feedsData : feedsData.feeds;
    if (!Array.isArray(feeds) || feeds.length === 0) {
        throw new Error('[flux] 分类 4 没有返回任何订阅（疑似 Miniflux API 异常），保留已有数据');
    }

    // 并发获取每个 feed 的最新文章（限制并发避免过载）。
    // 单条失败不抛全局错误，交给 buildFluxSnapshot 用上一份缓存兜底。
    const latestResults = [];
    let failed = 0;
    for (let i = 0; i < feeds.length; i += CONCURRENCY) {
        const batch = feeds.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
            batch.map(async (feed) => {
                try {
                    const ed = await ctx.fetchJson(`${env.FLUX_URL}/feeds/${feed.id}/entries?limit=1&order=published_at&direction=desc`, { headers: { 'X-Auth-Token': env.FLUX_KEY } }, 15000);
                    const list = Array.isArray(ed) ? ed : Array.isArray(ed.entries) ? ed.entries : [];
                    return { feedId: feed.id, entry: list.length > 0 ? list[0] : null };
                } catch (e) {
                    ctx.log.warn(`[flux] feed ${feed.id} 最新文章获取失败: ${e.message}`);
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
        ctx.log(`[flux] ${fallbackFeeds.length} 个订阅在 Miniflux 中没有文章，尝试直连订阅源`);
    }

    let directFailed = 0;
    for (let i = 0; i < fallbackFeeds.length; i += CONCURRENCY) {
        const batch = fallbackFeeds.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
            batch.map(async (feed) => {
                try {
                    return { feedId: feed.id, entry: await fetchLatestEntryDirect(ctx, feed, readerProxy) };
                } catch (e) {
                    directFailed++;
                    ctx.log.warn(`[flux] feed ${feed.id} 直连订阅源失败: ${e.message}`);
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
        ctx.log.warn(`[flux] ${directFailed}/${fallbackFeeds.length} 个订阅直连抓取失败`);
    }

    // 用上一份数据作为缓存：失败时沿用旧文章，失联时间也保持稳定。
    const snapshot = buildFluxSnapshot({
        feeds,
        latestResults,
        previousEntries: ctx.previous('flux.feed') || [],
        previousLost: ctx.previous('flux.lost') || []
    });

    return {
        outputs: [
            { dataset: 'flux.feed', data: snapshot.entries, complete: true },
            { dataset: 'flux.lost', data: snapshot.lost, complete: true }
        ]
    };
}
