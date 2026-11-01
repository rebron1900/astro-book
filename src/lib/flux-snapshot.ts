import type { FluxEntry, FluxLostFeed } from '../api/types';

/**
 * Miniflux feed 对象中与「失联」判定相关的字段。
 * 完整字段远多于这里，保持宽松以兼容不同 Miniflux 版本。
 */
export interface MinifluxFeed {
    id: number | string;
    title?: string;
    site_url?: string;
    feed_url?: string;
    disabled?: boolean;
    parsing_error_count?: number;
    parsing_error_message?: string;
    [key: string]: unknown;
}

/** 单个订阅最新文章的抓取结果。error 表示 Miniflux API 或直连订阅源请求失败（不等于订阅本身一定失效）。 */
export interface LatestEntryResult {
    feedId: number | string;
    entry: Record<string, unknown> | null;
    error?: string;
}

export interface FluxSnapshot {
    entries: FluxEntry[];
    lost: FluxLostFeed[];
}

/** Miniflux 默认 POLLING_PARSING_ERROR_LIMIT 为 3，达到后停止轮询该订阅。 */
export const PARSING_ERROR_LIMIT = 3;

const ENTRY_FIELDS = ['title', 'url', 'link', 'published_at', 'created_at', 'date'] as const;

function normalizeSiteUrl(siteUrl: unknown): string {
    if (typeof siteUrl !== 'string' || !siteUrl) return '';
    try {
        return new URL(siteUrl).origin;
    } catch {
        return siteUrl;
    }
}

function entryTime(entry: Record<string, unknown> | null | undefined): number {
    if (!entry) return 0;
    const raw = entry.published_at || entry.created_at || entry.date;
    if (typeof raw !== 'string' && typeof raw !== 'number') return 0;
    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : 0;
}

function toIsoDate(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function trimEntry(entry: Record<string, unknown>, feed: MinifluxFeed): FluxEntry {
    const out: Record<string, unknown> = {};
    for (const field of ENTRY_FIELDS) {
        if (field in entry) out[field] = entry[field];
    }
    out.feed = {
        id: feed.id,
        site_url: normalizeSiteUrl(feed.site_url),
        ...(feed.title ? { title: feed.title } : {})
    };
    out.feed_id = feed.id;
    out.update_timestamp = entryTime(entry);
    return out as unknown as FluxEntry;
}

function buildLostFeed(
    feed: MinifluxFeed,
    reason: FluxLostFeed['reason'],
    previous: FluxLostFeed | undefined,
    lastEntry: Record<string, unknown> | null | undefined,
    now: string,
    error?: string
): FluxLostFeed {
    const out: FluxLostFeed = {
        id: Number(feed.id),
        title: feed.title || normalizeSiteUrl(feed.site_url) || `Feed ${feed.id}`,
        site_url: normalizeSiteUrl(feed.site_url),
        reason,
        first_seen_at: previous?.first_seen_at || now
    };

    if (feed.feed_url) out.feed_url = feed.feed_url;

    const message = feed.parsing_error_message || error;
    if (message) out.error = message;

    const lastEntryAt = toIsoDate(lastEntry && (lastEntry.published_at || lastEntry.created_at || lastEntry.date)) || previous?.last_entry_at;
    if (lastEntryAt) out.last_entry_at = lastEntryAt;

    return out;
}

/**
 * 把 Miniflux 的订阅列表 + 每个订阅的最新文章结果，转换成页面需要的两份数据：
 * - entries：仍在正常更新的订阅的最新文章（按时间倒序）
 * - lost：没有最新文章 / 抓取异常 / 被停用的订阅
 *
 * 缓存策略：
 * - 单次请求失败不会立刻判定订阅失联：优先沿用上一份 flux.json 里的旧文章；
 * - first_seen_at 从上一份 flux-lost.json 继承，避免每次同步都刷新「失联时间」；
 * - 订阅恢复后会自动从 lost 中移除。
 */
export function buildFluxSnapshot(options: {
    feeds: MinifluxFeed[];
    latestResults: LatestEntryResult[];
    previousEntries?: FluxEntry[];
    previousLost?: FluxLostFeed[];
    now?: string;
}): FluxSnapshot {
    const { feeds, latestResults, previousEntries = [], previousLost = [] } = options;
    const now = options.now || new Date().toISOString();

    const resultByFeed = new Map<string, LatestEntryResult>();
    for (const result of latestResults) resultByFeed.set(String(result.feedId), result);

    const previousEntryByFeed = new Map<string, FluxEntry>();
    for (const entry of Array.isArray(previousEntries) ? previousEntries : []) {
        if (entry && entry.feed_id != null) previousEntryByFeed.set(String(entry.feed_id), entry);
    }

    const previousLostByFeed = new Map<string, FluxLostFeed>();
    for (const feed of Array.isArray(previousLost) ? previousLost : []) {
        if (feed && feed.id != null) previousLostByFeed.set(String(feed.id), feed);
    }

    const entries: FluxEntry[] = [];
    const lost: FluxLostFeed[] = [];
    const seen = new Set<string>();

    for (const feed of feeds) {
        if (!feed || feed.id == null) continue;
        const key = String(feed.id);
        if (seen.has(key)) continue;
        seen.add(key);

        const result = resultByFeed.get(key);
        const latestEntry = result?.entry || null;
        const previousEntry = previousEntryByFeed.get(key);
        const previousLostFeed = previousLostByFeed.get(key);
        const parsingErrorCount = Number(feed.parsing_error_count || 0);

        // Miniflux 已明确停用或达到解析错误上限：即使还留有旧文章，也归入失联。
        if (feed.disabled || parsingErrorCount >= PARSING_ERROR_LIMIT) {
            lost.push(buildLostFeed(feed, feed.disabled ? 'disabled' : 'error', previousLostFeed, latestEntry || previousEntry, now));
            continue;
        }

        if (latestEntry) {
            entries.push(trimEntry(latestEntry, feed));
            continue;
        }

        // 单个订阅的 entries 接口失败：这是 Miniflux API 的临时问题，不是订阅本身失效。
        // 有旧文章就继续展示，避免一次抖动让页面上的友邻凭空消失。
        if (result?.error) {
            if (previousEntry) {
                entries.push(previousEntry);
            } else {
                lost.push(buildLostFeed(feed, 'error', previousLostFeed, null, now, result.error));
            }
            continue;
        }

        // 有解析错误但还没达到 Miniflux 的停止轮询阈值：同样无法取到最新文章，按抓取失败展示。
        if (parsingErrorCount > 0) {
            lost.push(buildLostFeed(feed, 'error', previousLostFeed, previousEntry, now));
            continue;
        }

        // 接口成功但没有任何文章：订阅可能已失效、已停更，或文章已被 Miniflux 历史清理。
        lost.push(buildLostFeed(feed, 'empty', previousLostFeed, previousEntry, now));
    }

    entries.sort((a, b) => (b.update_timestamp || 0) - (a.update_timestamp || 0));
    lost.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));

    return { entries, lost };
}
