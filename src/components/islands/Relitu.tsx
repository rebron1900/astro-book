// src/components/islands/Relitu.tsx
import { timeline } from '../../api/store';
import type { TimelineEntry } from '../../api/store';
import { normalizeSlug } from '../../lib/utils/help';

type Kind = TimelineEntry['kind'];

const KIND_META: Record<Kind, { color: string; icon: string }> = {
    // 与时间线左侧 rail-marker 使用同一套 Lucide 图标和颜色。
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
    strava: {
        color: 'color-mix(in srgb, #18794e 55%, var(--gray-500))',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/></svg>'
    }
};

const KIND_ORDER: Kind[] = ['post', 'memo', 'neodb', 'strava'];

function getThisSunday(date: Date) {
    const dayOfWeek = date.getDay();
    const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const thisSunday = new Date(date);
    thisSunday.setDate(thisSunday.getDate() + daysToSunday);
    return thisSunday;
}

function pad(value: number) {
    return String(value).padStart(2, '0');
}

function localDateKey(date: Date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function stripHtml(value: unknown) {
    return String(value ?? '')
        .replace(/<[^>]*>/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHtml(value: string) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function entryTitle(entry: TimelineEntry) {
    if (entry.kind === 'post') return entry.data.title;
    if (entry.kind === 'memo') return stripHtml(entry.data.content).slice(0, 38) || '一条随记';
    if (entry.kind === 'neodb') return entry.data.item.title_cn || entry.data.item.title || entry.data.title || '一条书影音记录';
    return entry.data.name || '一次运动';
}

function goLink(value: unknown) {
    const href = String(value ?? '#');
    if (!/^https?:\/\//i.test(href)) return href;
    return `/golink?target=${btoa(encodeURIComponent(href))}`;
}

function entryHref(entry: TimelineEntry) {
    if (entry.kind === 'post') return normalizeSlug(entry.data.slug);
    if (entry.kind === 'memo') return '/now/';
    if (entry.kind === 'neodb') return goLink(entry.data.item.id);
    const stravaHref = entry.data.url || (entry.data.run_id ? `https://www.strava.com/activities/${entry.data.run_id}` : '#');
    return goLink(stravaHref);
}

type DayHeat = {
    date: string;
    entries: TimelineEntry[];
    counts: Record<Kind, number>;
};

function dateBuild(today: Date): DayHeat[] {
    const sunday = getThisSunday(today);
    const start = new Date(sunday);
    start.setDate(start.getDate() - 62);

    const byDate = new Map<string, TimelineEntry[]>();
    timeline.forEach((entry) => {
        const key = localDateKey(new Date(entry.time));
        const list = byDate.get(key) ?? [];
        list.push(entry);
        byDate.set(key, list);
    });

    const days: DayHeat[] = [];
    for (let cursor = new Date(start); cursor <= sunday; cursor.setDate(cursor.getDate() + 1)) {
        const date = localDateKey(cursor);
        const entries = byDate.get(date) ?? [];
        const counts: Record<Kind, number> = { post: 0, memo: 0, neodb: 0, strava: 0 };
        entries.forEach((entry) => { counts[entry.kind] += 1; });
        days.push({ date, entries, counts });
    }
    return days;
}

function heatStyle(counts: Record<Kind, number>) {
    const total = KIND_ORDER.reduce((sum, kind) => sum + counts[kind], 0);
    if (!total) return undefined;
    const alpha = 0.18 + Math.min(1, total / 4) * 0.62;
    return `background-color: rgba(77, 208, 90, ${alpha});`;
}

function tooltipContent(day: DayHeat) {
    const items = day.entries.slice(0, 8).map((entry) => {
        const meta = KIND_META[entry.kind];
        const title = escapeHtml(entryTitle(entry));
        const href = escapeHtml(entryHref(entry));
        return `<li><span class="relitu-tooltip-icon" style="color:${meta.color}" aria-hidden="true">${meta.icon}</span><a href="${href}">${title}</a></li>`;
    }).join('');
    const date = new Date(`${day.date}T00:00:00`);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    const calendarIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>';
    return `<div class="relitu-tooltip-date"><span class="relitu-tooltip-calendar" aria-hidden="true">${calendarIcon}</span><strong>${day.date}</strong><span class="relitu-tooltip-weekday">${weekday}</span></div><ul class="relitu-tooltip-list">${items}</ul>`;
}

const DateGrid = () => {
    const builtData = dateBuild(new Date());
    const columns = Array.from({ length: 9 }, (_, index) => builtData.slice(index * 7, (index + 1) * 7));

    return (
        <div class="toc-relitu">
            <strong>内容热力图</strong>
            <div id="relitu-container" class="relitu-container">
                {columns.map((column) => (
                    <div class="grid-column">
                        {column.map((day) => {
                            const total = day.entries.length;
                            return (
                                <div class="grid-item">
                                    <div
                                        role="link"
                                        title={total ? `${day.date}，共 ${total} 条` : day.date}
                                        style={heatStyle(day.counts)}
                                        class={`item-info ${day.date === localDateKey(new Date()) ? 'current-item' : ''} ${total > 0 ? 'item-tippy' : ''}`}
                                        data-tippy-content={tooltipContent(day)}
                                        data-date={day.date}
                                    />
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div class="relitu-count">
                这里已经留下 <strong>{timeline.length}</strong> 条内容!
            </div>
        </div>
    );
};

export default DateGrid;
