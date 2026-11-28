/**
 * 内容热力图（右侧栏 9 周日历）的共享数据层，只在构建期使用。
 *
 * 以前每一格都把整段工具提示 HTML 塞进 `data-tippy-content`：
 * 一页 127 个属性、共 346KB，占整页 HTML 的八成，手机上解析和内存都要为它付钱。
 * 现在构建期把条目压成「日期 → [类型, 链接, 标题]」的紧凑结构，
 * 由 /relitu.json 一次性下发（全站共用、浏览器缓存），
 * 悬浮时再在浏览器里拼出提示 HTML（见 lib/client/relitu.ts）。
 */
import { normalizeSlug } from './utils/help';

export type RelituKind = 'post' | 'memo' | 'neodb' | 'reading' | 'strava' | 'media';

export const RELITU_KINDS: RelituKind[] = ['post', 'memo', 'neodb', 'strava', 'reading', 'media'];

/** 与时间线左侧 rail-marker 使用同一套 Lucide 图标和颜色。 */
export const RELITU_KIND_META: Record<RelituKind, { color: string; icon: string }> = {
    post: {
        color: 'var(--color-link)',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M6 12h2"/><path d="M6 8h2"/></svg>'
    },
    memo: {
        color: 'var(--gray-500)',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>'
    },
    neodb: {
        color: 'color-mix(in srgb, #b37a00 68%, var(--gray-500))',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>'
    },
    reading: {
        color: 'color-mix(in srgb, #6b4fbb 55%, var(--gray-500))',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>'
    },
    strava: {
        color: 'color-mix(in srgb, #18794e 55%, var(--gray-500))',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/></svg>'
    },
    media: {
        color: 'color-mix(in srgb, #b3541e 55%, var(--gray-500))',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M2 8h20"/><path d="m7 4 2 4"/><path d="m12 4 2 4"/><path d="m17 4 2 4"/></svg>'
    }
};

/** 一行时间线条目需要的最小字段（够算日期、类型、标题和链接即可）。 */
export interface RelituEntryLike {
    kind: string;
    time: string | number;
    data: Record<string, any>;
}

/** 压进 JSON 的一条：类型、链接、标题。 */
export type RelituTuple = [RelituKind, string, string];

export interface RelituDay {
    date: string;
    weekday: string;
    items: RelituTuple[];
}

/** /relitu.json 的结构：图标颜色只出现一次，日期表只放有内容的格子。 */
export interface RelituPayload {
    kinds: Record<string, { color: string; icon: string }>;
    days: Record<string, { w: string; i: RelituTuple[] }>;
}

/** 9 列 × 7 行 */
export const RELITU_DAYS = 63;
/** 每格最多列 8 条 */
export const RELITU_MAX_ITEMS = 8;

function pad(value: number) {
    return String(value).padStart(2, '0');
}

export function localDateKey(date: Date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayOf(dateKey: string) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return WEEKDAYS[new Date(year, (month ?? 1) - 1, day ?? 1).getDay()] ?? '';
}

function getThisSunday(date: Date) {
    const dayOfWeek = date.getDay();
    const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const thisSunday = new Date(date);
    thisSunday.setDate(thisSunday.getDate() + daysToSunday);
    return thisSunday;
}

function stripHtml(value: unknown) {
    return String(value ?? '')
        .replace(/<[^>]*>/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function entryTitle(entry: RelituEntryLike) {
    const data = entry.data ?? {};
    if (entry.kind === 'post') return String(data.title ?? '');
    if (entry.kind === 'memo') return stripHtml(data.content).slice(0, 38) || '一条随记';
    if (entry.kind === 'neodb') return data.item?.title_cn || data.item?.title || data.title || '一条书影音记录';
    if (entry.kind === 'reading') return `阅读 ${(data.books ?? []).map((b: any) => b.title).join('、')}`;
    if (entry.kind === 'media') return `${data.title ?? ''}${data.episodeCode ? ` ${data.episodeCode}` : ''}`;
    return data.name || '一次运动';
}

function goLink(value: unknown) {
    const href = String(value ?? '#');
    if (!/^https?:\/\//i.test(href)) return href;
    return `/golink?target=${btoa(encodeURIComponent(href))}`;
}

function entryHref(entry: RelituEntryLike) {
    const data = entry.data ?? {};
    if (entry.kind === 'post') return normalizeSlug(data.slug);
    if (entry.kind === 'memo') return '/now/';
    if (entry.kind === 'neodb') return goLink(data.item?.id);
    if (entry.kind === 'reading') return '/timeline/reading/';
    if (entry.kind === 'media') return '/timeline/reading/';
    // 运动条目跳到 intervals.icu 的活动页；同步结果里已带 url，缺省时退回时间线页
    return goLink(data.url ?? '/activity/');
}

function kindOf(kind: string): RelituKind {
    return (RELITU_KINDS as string[]).includes(kind) ? (kind as RelituKind) : 'memo';
}

/** 把条目压成「日期 → 3 元组」，只保留最近 9 周。 */
export function buildRelituDays(entries: RelituEntryLike[], today = new Date()): RelituDay[] {
    const sunday = getThisSunday(today);
    const start = new Date(sunday);
    start.setDate(start.getDate() - (RELITU_DAYS - 1));

    const byDate = new Map<string, RelituTuple[]>();
    const inWindow = new Set<string>();
    for (let cursor = new Date(start); cursor <= sunday; cursor.setDate(cursor.getDate() + 1)) {
        inWindow.add(localDateKey(cursor));
    }

    entries.forEach((entry) => {
        const time = new Date(entry.time);
        if (Number.isNaN(time.getTime())) return;
        const key = localDateKey(time);
        if (!inWindow.has(key)) return;
        const list = byDate.get(key) ?? [];
        if (list.length >= RELITU_MAX_ITEMS) return;
        list.push([kindOf(entry.kind), entryHref(entry), entryTitle(entry)]);
        byDate.set(key, list);
    });

    const days: RelituDay[] = [];
    for (let cursor = new Date(start); cursor <= sunday; cursor.setDate(cursor.getDate() + 1)) {
        const date = localDateKey(cursor);
        days.push({ date, weekday: weekdayOf(date), items: byDate.get(date) ?? [] });
    }
    return days;
}

export function buildRelituPayload(entries: RelituEntryLike[], today = new Date()): RelituPayload {
    const kinds: Record<string, { color: string; icon: string }> = {};
    for (const kind of RELITU_KINDS) kinds[kind] = RELITU_KIND_META[kind];

    const days: Record<string, { w: string; i: RelituTuple[] }> = {};
    for (const day of buildRelituDays(entries, today)) {
        if (!day.items.length) continue;
        days[day.date] = { w: day.weekday, i: day.items };
    }
    return { kinds, days };
}