/**
 * 内容热力图的工具提示：数据来自全站共用的 /relitu.json，
 * 悬浮（或键盘聚焦）到某一格时，才在浏览器里拼这一格的 HTML。
 *
 * 页面里因此不再内嵌 127 段提示 HTML（原来占一页 HTML 的八成），
 * JSON 只有一份、浏览器缓存，换页也不会重下。
 */
import { escapeHtml } from './dom';

type RelituTuple = [string, string, string];
type RelituPayload = {
    kinds: Record<string, { color: string; icon: string }>;
    days: Record<string, { w: string; i: RelituTuple[] }>;
};

const CALENDAR_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>';

let payload: RelituPayload | null = null;
let loading: Promise<void> | null = null;
const built = new Map<string, string>();

function buildTooltip(date: string, day: { w: string; i: RelituTuple[] }): string {
    const items = day.i
        .map(([kind, href, title]) => {
            const meta = payload?.kinds?.[kind];
            const color = escapeHtml(meta?.color ?? 'var(--gray-500)');
            const icon = meta?.icon ?? '';
            return `<li><span class="relitu-tooltip-icon" style="color:${color}" aria-hidden="true">${icon}</span><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></li>`;
        })
        .join('');
    return `<div class="relitu-tooltip-date"><span class="relitu-tooltip-calendar" aria-hidden="true">${CALENDAR_ICON}</span><strong>${escapeHtml(date)}</strong><span class="relitu-tooltip-weekday">${escapeHtml(day.w)}</span></div><ul class="relitu-tooltip-list">${items}</ul>`;
}

function ensureData(): Promise<void> {
    if (payload) return Promise.resolve();
    if (loading) return loading;
    loading = fetch('/relitu.json', { credentials: 'same-origin' })
        .then((response) => (response.ok ? (response.json() as Promise<RelituPayload>) : null))
        .then((data) => {
            if (data && typeof data === 'object' && data.days) payload = data;
        })
        .catch(() => {
            // 拿不到就退回格子自带的 title，不影响点击和阅读
        })
        .finally(() => {
            loading = null;
        });
    return loading;
}

/** 页面上有热力图时提前把数据取回来（空闲时，不抢首屏）。 */
export function prefetchRelitu(): void {
    if (typeof document === 'undefined') return;
    if (!document.querySelector('[data-relitu-day]')) return;
    const start = () => {
        void ensureData();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 2500 });
    else setTimeout(start, 1200);
}

/** tippy 的 content：数据还没到就先返回空，让它用格子的 title 兜底。 */
export function relituContent(date: string | undefined): string {
    if (!date) return '';
    const ready = payload?.days?.[date];
    if (!ready) {
        void ensureData();
        return '';
    }
    const cached = built.get(date);
    if (cached) return cached;
    const html = buildTooltip(date, ready);
    built.set(date, html);
    return html;
}