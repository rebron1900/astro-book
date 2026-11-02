// src/components/islands/Relitu.tsx
import { timeline } from '../../api/store';
import type { TimelineEntry } from '../../api/store';
import { normalizeSlug } from '../../lib/utils/help';

type Kind = TimelineEntry['kind'];

const KIND_META: Record<Kind, { color: string; icon: string }> = {
    post: {
        color: '#4f9d62',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>'
    },
    memo: {
        color: '#5b8dd9',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    },
    neodb: {
        color: '#8b73c9',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
    },
    strava: {
        color: '#d98247',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>'
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

function entryHref(entry: TimelineEntry) {
    if (entry.kind === 'post') return normalizeSlug(entry.data.slug);
    if (entry.kind === 'memo') return '/now/';
    if (entry.kind === 'neodb') return entry.data.item.id || '#';
    return entry.data.url || (entry.data.run_id ? `https://www.strava.com/activities/${entry.data.run_id}` : '#');
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
    return `${day.date}<ul class="relitu-tooltip-list">${items}</ul>`;
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
