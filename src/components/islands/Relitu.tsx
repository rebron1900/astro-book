// src/components/islands/Relitu.tsx
import { timeline } from '../../api/store';
import type { TimelineEntry } from '../../api/store';
import { normalizeSlug } from '../../lib/utils/help';

type Kind = TimelineEntry['kind'];

const KIND_META: Record<Kind, { label: string; rgb: string }> = {
    post: { label: '文章', rgb: '77, 208, 90' },
    memo: { label: '随记', rgb: '79, 156, 249' },
    neodb: { label: '书影音', rgb: '167, 139, 250' },
    strava: { label: '运动', rgb: '249, 115, 22' }
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
    let cursor = 0;
    const stops = KIND_ORDER.filter((kind) => counts[kind] > 0).map((kind) => {
        const share = (counts[kind] / total) * 100;
        const start = cursor;
        cursor += share;
        const alpha = 0.25 + Math.min(1, total / 3) * 0.65;
        return `rgba(${KIND_META[kind].rgb}, ${alpha}) ${start}% ${cursor}%`;
    });
    return `background: linear-gradient(90deg, ${stops.join(', ')});`;
}

function tooltipContent(day: DayHeat) {
    const total = day.entries.length;
    const summary = KIND_ORDER
        .filter((kind) => day.counts[kind] > 0)
        .map((kind) => `${KIND_META[kind].label} ${day.counts[kind]}`)
        .join('、');
    const items = day.entries.slice(0, 8).map((entry) => {
        const label = KIND_META[entry.kind].label;
        const title = escapeHtml(entryTitle(entry));
        const href = escapeHtml(entryHref(entry));
        return `<li><span class="relitu-tooltip-kind">${label}</span><a href="${href}">${title}</a></li>`;
    }).join('');
    const more = total > 8 ? `<li class="relitu-tooltip-more">还有 ${total - 8} 条</li>` : '';
    return `${day.date}，共 ${total} 条${summary ? `（${summary}）` : ''}<ul class="relitu-tooltip-list">${items}${more}</ul>`;
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
            <div class="relitu-legend" aria-label="内容类型">
                {KIND_ORDER.map((kind) => (
                    <span><i style={`background: rgba(${KIND_META[kind].rgb}, 0.8)`} />{KIND_META[kind].label}</span>
                ))}
            </div>
            <div class="relitu-count">
                这里已经留下 <strong>{timeline.length}</strong> 条内容!
            </div>
        </div>
    );
};

export default DateGrid;
