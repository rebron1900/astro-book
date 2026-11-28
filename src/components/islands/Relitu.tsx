// src/components/islands/Relitu.tsx
import { timelineVisible } from '../../api/store';
import { RELITU_KINDS, buildRelituDays, localDateKey } from '../../lib/relitu';

/**
 * 右侧栏「内容热力图」。
 *
 * 这里只输出 63 个空格子：颜色、日期、条数，外加一格 `data-relitu-day`。
 * 悬浮提示的 HTML 不再随页面下发（以前 127 个 data-tippy-content 共 346KB，
 * 占一页 HTML 的八成），改成 hover 时由 lib/client/relitu.ts 按 /relitu.json 现拼。
 */
function heatStyle(counts: Record<string, number>) {
    const total = RELITU_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0);
    if (!total) return undefined;
    const alpha = 0.18 + Math.min(1, total / 4) * 0.62;
    return `background-color: rgba(77, 208, 90, ${alpha});`;
}

const DateGrid = () => {
    const today = new Date();
    const days = buildRelituDays(timelineVisible as any, today);
    const columns = Array.from({ length: 9 }, (_, index) => days.slice(index * 7, (index + 1) * 7));
    const todayKey = localDateKey(today);

    return (
        <div class="toc-relitu">
            <strong>内容热力图</strong>
            <div id="relitu-container" class="relitu-container">
                {columns.map((column) => (
                    <div class="grid-column">
                        {column.map((day) => {
                            const total = day.items.length;
                            const counts: Record<string, number> = {};
                            day.items.forEach(([kind]) => {
                                counts[kind] = (counts[kind] ?? 0) + 1;
                            });
                            return (
                                <div class="grid-item">
                                    <div
                                        role="link"
                                        title={total ? `${day.date}，共 ${total} 条` : day.date}
                                        style={heatStyle(counts)}
                                        class={`item-info ${day.date === todayKey ? 'current-item' : ''} ${total > 0 ? 'item-tippy' : ''}`}
                                        data-relitu-day={total > 0 ? day.date : undefined}
                                    />
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div class="relitu-count">
                这里已经留下 <strong>{timelineVisible.length}</strong> 条内容!
            </div>
        </div>
    );
};

export default DateGrid;