import type { TimelineEntry } from '../api/store';
import { cnDateKey } from './utils/help';

/**
 * 时间线纯函数层（见 docs/specs/2026-11-26-timeline-spec.md）。
 *
 * 为什么单独一层：排序、去重、分页、计数以前散在 store / 页面 / 组件里，各自
 * `sort((a,b) => b.time - a.time)`，同时间条目的顺序取决于数据源顺序；一旦两处
 * 算法不同，「页头总数」和「实际条数」就会对不上。这里只允许页面与组件消费这
 * 一套函数，不再各写一遍。
 *
 * 时间语义（按规范）：
 * - 精确时间一律 epoch 毫秒；日期型（reading）保留 `YYYY-MM-DD`，其排序用
 *   **北京时间 00:00** 的 epoch，不反推成时刻；
 * - 「天」统一用 cnDateKey（北京时间），CI 跑 UTC 也不会错位。
 */

/** kind 的固定次序：time 相同时用它保证全序（不依赖数组原始顺序）。 */
export const KIND_ORDER: Record<TimelineEntry['kind'], number> = {
    post: 0,
    memo: 1,
    neodb: 2,
    strava: 3,
    reading: 4,
    media: 5
};

/** kind → 数据来源；去重键用「来源 + 稳定 id」，不用 kind 单独当来源。 */
export const KIND_SOURCE: Record<TimelineEntry['kind'], string> = {
    post: 'ghost.posts',
    memo: 'memos',
    neodb: 'neodb.marks',
    strava: 'intervals.activities',
    reading: 'reading',
    media: 'emby.viewing'
};

/** 稳定的条目 id：缺 id 时退到该来源天然唯一的字段，绝不用下标/时间戳。 */
export function timelineEntryId(entry: TimelineEntry): string {
    switch (entry.kind) {
        case 'post':
            return String(entry.data.id ?? entry.data.slug ?? '');
        case 'memo':
            return String(entry.data.id ?? '');
        case 'neodb': {
            const data = entry.data as { post_id?: string | number; item?: { uuid?: string }; created_time?: string };
            return String(data.post_id ?? `${data.item?.uuid ?? ''}|${data.created_time ?? ''}`);
        }
        case 'strava':
            return String(entry.data.id ?? '');
        case 'reading':
            return String(entry.data.date ?? '');
        case 'media':
            return String(entry.data.id ?? '');
    }
}

/** 去重键：source + id。 */
export function timelineKey(entry: TimelineEntry): string {
    return `${KIND_SOURCE[entry.kind]}:${timelineEntryId(entry)}`;
}

/** 全序比较器：time 降序 → kind 固定序 → id 字典序升序。 */
export function compareTimelineEntries(a: TimelineEntry, b: TimelineEntry): number {
    if (b.time !== a.time) return b.time - a.time;
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kindDiff !== 0) return kindDiff;
    const aId = timelineEntryId(a);
    const bId = timelineEntryId(b);
    if (aId === bId) return 0;
    return aId < bId ? -1 : 1;
}

/**
 * 同一记录在多处出现时（如 Emby 的 Items 与 Resume）保留信息更全的一条：
 * 影视取较新的 lastPlayedAt、进度取较大值；其余类型保留已排序后的第一条（= 最新）。
 */
export function mergeDuplicateEntry(first: TimelineEntry, second: TimelineEntry): TimelineEntry {
    if (first.kind !== 'media' || second.kind !== 'media') return first;
    const newer = (second.data.lastPlayedAt ?? 0) > (first.data.lastPlayedAt ?? 0) ? second : first;
    const older = newer === first ? second : first;
    return {
        ...newer,
        time: newer.time,
        data: {
            ...older.data,
            ...newer.data,
            playedPercent: Math.max(first.data.playedPercent ?? 0, second.data.playedPercent ?? 0)
        }
    };
}

/** 按 source+id 去重（保留第一条，发生重复时按类型合并字段）。 */
export function dedupeTimeline(entries: TimelineEntry[]): TimelineEntry[] {
    const byKey = new Map<string, TimelineEntry>();
    for (const entry of entries) {
        const key = timelineKey(entry);
        const existing = byKey.get(key);
        byKey.set(key, existing ? mergeDuplicateEntry(existing, entry) : entry);
    }
    return [...byKey.values()];
}

/** 未来时间超过 5 分钟视为脏数据（时区算错会把内容顶到最前）。 */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export interface BuildTimelineOptions {
    /** 注入当前时间，便于测试；默认 Date.now()。 */
    now?: number;
}

/** 排序 → 去重 → 丢弃未来脏数据。这是时间线的唯一构造入口。 */
export function buildTimeline(entries: TimelineEntry[], options: BuildTimelineOptions = {}): TimelineEntry[] {
    const now = options.now ?? Date.now();
    const sorted = [...entries].sort(compareTimelineEntries);
    const deduped = dedupeTimeline(sorted);
    return deduped.filter((entry) => entry.time <= now + FUTURE_TOLERANCE_MS);
}

/** 栏目 → 事件集合；/timeline/reading/ 是 reading + media 两个 kind。 */
export function timelineForKind(entries: TimelineEntry[], kind: string): TimelineEntry[] {
    if (kind === 'reading') return entries.filter((entry) => entry.kind === 'reading' || entry.kind === 'media');
    return entries.filter((entry) => entry.kind === kind);
}

export interface TimelineCounts {
    all: number;
    post: number;
    memo: number;
    neodb: number;
    strava: number;
    reading: number;
    media: number;
    readingAndMedia: number;
}

/** 计数口径：事件数（不是原始记录数、不是卡片数）。页头与分页 total 都读这里。 */
export function countTimeline(entries: TimelineEntry[]): TimelineCounts {
    const counts: TimelineCounts = { all: 0, post: 0, memo: 0, neodb: 0, strava: 0, reading: 0, media: 0, readingAndMedia: 0 };
    for (const entry of entries) {
        counts.all += 1;
        if (entry.kind in counts) counts[entry.kind] += 1;
    }
    counts.readingAndMedia = counts.reading + counts.media;
    return counts;
}

/**
 * 按「天」切页：页内累计到 pageSize 且下一条换了天，才开新页。
 * 这样同一天的多条记录（含多集合成的聚合卡）永远不会被拆到两页。
 */
export function paginateTimeline(entries: TimelineEntry[], pageSize: number): TimelineEntry[][] {
    if (pageSize <= 0) throw new Error('pageSize 必须为正数');
    const pages: TimelineEntry[][] = [];
    let current: TimelineEntry[] = [];
    let lastDay: string | null = null;
    for (const entry of entries) {
        const day = cnDateKey(entry.time);
        if (current.length >= pageSize && day !== lastDay) {
            pages.push(current);
            current = [];
        }
        current.push(entry);
        lastDay = day;
    }
    if (current.length) pages.push(current);
    return pages;
}

/** 阅读的日期型时间：北京时间当天 00:00 的 epoch（只用于排序/分页，不展示成时刻）。 */
export function readingDayTime(date: string): number {
    return new Date(`${date}T00:00:00+08:00`).getTime();
}
