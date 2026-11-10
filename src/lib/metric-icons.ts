/**
 * 运动页指标图标：距离 / 用时 / 爬升 / 配速 / 均速 / 心率 / 消耗 / 次数 / 出勤 / 平均。
 *
 * 这些路径被三处同时使用：
 * 1. Astro 构建期渲染的时间线卡片（`MetricIcon.astro`）；
 * 2. Solid 岛里的地图信息卡与统计面板（`MetricIcon.tsx`）；
 * 3. 日历 tooltip 这种字符串模板（`metricIconHtml()`）。
 *
 * 因此只在这里存一份 `<path>` 等片段，统一 24×24 网格、2px 描边、圆角连接，
 * 与站内其它 lucide 图标（时间线运动图标、纪录行图标）保持同一套线条语言。
 * 所有片段都是本文件里的静态常量，不含任何用户输入。
 */
export type MetricIconKind = 'distance' | 'duration' | 'elevation' | 'pace' | 'speed' | 'heartrate' | 'calories' | 'count' | 'days' | 'average';

export const METRIC_ICONS: Record<MetricIconKind, string> = {
    /* 距离：路线（两个端点 + 曲线），与「纪录 · 最远一次」同一枚图标 */
    distance: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    /* 用时：秒表 */
    duration: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
    /* 爬升：山 */
    elevation: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    /* 配速：仪表盘 */
    pace: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    /* 均速：风 */
    speed: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
    /* 心率：心形 */
    heartrate:
        '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    /* 消耗：火苗 */
    calories:
        '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    /* 次数：# */
    count: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
    /* 出勤天数：日历 + 勾 */
    days: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    /* 平均每次：等号 */
    average: '<line x1="5" x2="19" y1="9" y2="9"/><line x1="5" x2="19" y1="15" y2="15"/>'
};

/** 写在 HTML 字符串里（tippy tooltip）的内联图标，只拼接上面的静态常量 */
export function metricIconHtml(kind: MetricIconKind, className = 'metric-icon'): string {
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${METRIC_ICONS[kind]}</svg>`;
}
