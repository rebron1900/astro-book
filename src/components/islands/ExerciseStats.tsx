import { For, Show, createEffect, onCleanup, onMount } from 'solid-js';
import { delegate } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/light.css';
import type { ExerciseRecord, ExerciseScope, MonthCell } from '../../lib/exercise';
import {
    SPORT_META,
    dateLabel,
    formatDuration,
    formatRecordDistance,
    monthBuckets,
    monthGrid,
    monthLabel,
    scopeAnchor,
    totalsOf,
    weekBuckets,
    weekdayLabel
} from '../../lib/exercise';
import type { SportSlice } from '../../lib/exercise-stats';
import { averageParts, distanceParts, elevationParts, formatElevation, hoursParts, shiftMonth, spanLabel, sportSlices } from '../../lib/exercise-stats';

/**
 * 运动页面右侧统计：
 * 1. 日历卡（只保留日历）——每天一个小环形图，按运动类型占比着色；
 *    悬浮日期 / 月份 / 年份会用 tippy 显示对应粒度的统计数据（原先被移除的日、月、年卡片结构）。
 * 2. 全部运动总览卡——总次数 / 总里程 / 总时长 / 总爬升 / 出勤 / 平均，运动类型与纪录用两列网格。
 *
 * 组件只负责「给定 scope 时怎么呈现」——选中范围的唯一状态源在 `ExerciseSidebar`。
 * 样式在 `src/components/pages/ExerciseStatsStyles.astro`。
 */
export interface ExerciseStatsProps {
    records: ExerciseRecord[];
    scope: ExerciseScope;
    /** 点日历格子 / 纪录行时改变选中范围 */
    onSelect: (scope: ExerciseScope) => void;
    /** 悬停在记录上时高亮地图路线 */
    onHover?: (id: string | null) => void;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/* ------------------------------------------------------------------ */
/* 通用小零件                                                          */
/* ------------------------------------------------------------------ */

/** lucide 风格的箭头，内联 SVG，避免为一个小图标引入依赖 */
function Chevron(props: { dir: 'left' | 'right' }) {
    return (
        <svg
            class="ex-stats-chev"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d={props.dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
        </svg>
    );
}

type MarkKind = 'distance' | 'duration' | 'elevation' | 'pace';

/** 「纪录」行的图标：路线 / 计时 / 爬升 / 配速仪表，线条风格与时间线的运动图标保持一致 */
function RecordIcon(props: { kind: MarkKind }) {
    const paths = () => {
        switch (props.kind) {
            case 'duration':
                return (
                    <>
                        <line x1="10" x2="14" y1="2" y2="2" />
                        <line x1="12" x2="15" y1="14" y2="11" />
                        <circle cx="12" cy="14" r="8" />
                    </>
                );
            case 'elevation':
                return <path d="m8 3 4 8 5-5 5 15H2L8 3z" />;
            case 'pace':
                return (
                    <>
                        <path d="m12 14 4-4" />
                        <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                    </>
                );
            case 'distance':
            default:
                return (
                    <>
                        <circle cx="6" cy="19" r="3" />
                        <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                        <circle cx="18" cy="5" r="3" />
                    </>
                );
        }
    };

    return (
        <svg
            class="ex-ov-record-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            {paths()}
        </svg>
    );
}

/* ------------------------------------------------------------------ */
/* 日历格子 + tooltip 内容                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

/** 把一天的运动类型占比画成 conic-gradient 圆环 */
function donutGradient(slices: SportSlice[]): string {
    if (!slices.length) return '';
    let acc = 0;
    const stops = slices.map((slice) => {
        const from = acc;
        acc = Math.min(100, acc + slice.share * 100);
        return `${slice.color} ${from.toFixed(2)}% ${acc.toFixed(2)}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
}

/* ---- tooltip 内部使用的 HTML 片段（对应之前被移除的日/月/年卡片结构） ---- */

function tipGrid(items: Array<[string, string]>): string {
    return `<div class="ex-cal-tip-grid">${items
        .map(([label, value]) => `<span><em>${escapeHtml(label)}</em><b>${escapeHtml(value)}</b></span>`)
        .join('')}</div>`;
}

function tipSports(slices: SportSlice[]): string {
    if (!slices.length) return '';
    return `<p class="ex-cal-tip-section">运动类型</p><ul class="ex-cal-tip-list">${slices
        .map(
            (slice) =>
                `<li><i style="--c:${slice.color}"></i><span>${escapeHtml(slice.label)}</span><em>${slice.count} 次</em><b>${formatRecordDistance(slice.distance)}</b></li>`
        )
        .join('')}</ul>`;
}

function tipShell(title: string, sub: string, body: string): string {
    return `<div class="ex-cal-tip"><div class="ex-cal-tip-head"><span class="ex-cal-tip-title">${escapeHtml(title)}</span>${
        sub ? `<span class="ex-cal-tip-sub">${escapeHtml(sub)}</span>` : ''
    }</div>${body ? `<div class="ex-cal-tip-body">${body}</div>` : ''}</div>`;
}

function CalendarDay(props: { cell: MonthCell; slices: SportSlice[]; tip: string; selected: boolean; onSelect: (scope: ExerciseScope) => void }) {
    const gradient = () => donutGradient(props.slices);
    const spoken = () => {
        const date = dateLabel(props.cell.date);
        if (!props.cell.count) return `${date}，无运动`;
        const sports = props.slices.map((slice) => `${slice.label}${slice.percent}%`).join('、');
        return `${date}，${props.cell.count} 次，${formatRecordDistance(props.cell.distance)}，${sports}`;
    };
    return (
        <button
            type="button"
            class="ex-stats-cal-day"
            classList={{
                'is-data': props.cell.count > 0,
                'has-donut': props.cell.count > 0,
                'is-out': !props.cell.inMonth,
                'is-today': props.cell.isToday === true,
                'is-selected': props.selected
            }}
            data-cal-tip={props.tip}
            aria-label={spoken()}
            onClick={() => props.onSelect({ kind: 'day', date: props.cell.date })}
        >
            <span class="ex-stats-cal-ring" style={gradient() ? `--ex-donut:${gradient()}` : undefined}>
                <span class="ex-stats-cal-num">{props.cell.day}</span>
            </span>
        </button>
    );
}

/* ------------------------------------------------------------------ */
/* 面板                                                                */
/* ------------------------------------------------------------------ */

export default function ExerciseStats(props: ExerciseStatsProps) {
    /** 当前 scope 的锚点（最新一天所在的年月日，空 scope 也能定位） */
    const anchor = () => scopeAnchor(props.scope, props.records);

    const monthAnchor = () => {
        const current = anchor();
        return current ? { year: current.year, month: current.month } : null;
    };

    const selectedDay = () => (props.scope.kind === 'day' ? props.scope.date : '');

    const monthKey = () => {
        const current = monthAnchor();
        return current ? `${current.year}-${String(current.month).padStart(2, '0')}` : '';
    };

    const goMonth = (delta: number) => {
        const current = monthAnchor();
        if (!current) return;
        const next = shiftMonth(current.year, current.month, delta);
        props.onSelect({ kind: 'month', year: next.year, month: next.month });
    };

    /* ---------------- tooltip：日 ---------------- */
    const dayTip = (date: string, records: ExerciseRecord[]) => {
        const total = totalsOf(records);
        if (!total.count) return tipShell(dateLabel(date), `${weekdayLabel(date)} · 无运动`, '');
        const list = `<p class="ex-cal-tip-section">当日记录</p><ul class="ex-cal-tip-list">${records
            .map(
                (record) =>
                    `<li class="is-clickable" data-record-id="${record.id}"><i style="--c:${SPORT_META[record.sport].color}"></i><span>${escapeHtml(record.name)}</span><b>${formatRecordDistance(record.distance)}</b></li>`
            )
            .join('')}</ul>`;
        return tipShell(
            dateLabel(date),
            `${weekdayLabel(date)} · 当天运动`,
            tipGrid([
                ['次数', `${total.count}`],
                ['距离', formatRecordDistance(total.distance)],
                ['时长', formatDuration(total.seconds)],
                ['爬升', formatElevation(total.elevation)]
            ]) + list
        );
    };

    /* ---------------- tooltip：月 ---------------- */
    const monthTip = (year: number, month: number) => {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        const records = props.records.filter((record) => record.date.slice(0, 7) === key);
        const total = totalsOf(records);
        if (!total.count) return tipShell(monthLabel(year, month), '本月还没有运动记录', '');
        const weeks = weekBuckets(props.records, year, month).filter((bucket) => bucket.count > 0);
        const weekList = weeks.length
            ? `<p class="ex-cal-tip-section">每周</p><ul class="ex-cal-tip-list">${weeks
                  .map(
                      (bucket) => `<li><span>${escapeHtml(bucket.label)}</span><em>${bucket.count} 次</em><b>${formatRecordDistance(bucket.distance)}</b></li>`
                  )
                  .join('')}</ul>`
            : '';
        const farthest =
            total.longest && total.longest.distance > 0
                ? `<p class="ex-cal-tip-section">当月最远</p><div class="ex-cal-tip-record is-clickable" data-record-id="${total.longest.id}"><span>${escapeHtml(total.longest.name)}</span><b>${formatRecordDistance(total.longest.distance)}</b></div>`
                : '';
        return tipShell(
            monthLabel(year, month),
            `出勤 ${total.activeDays} 天`,
            tipGrid([
                ['距离', formatRecordDistance(total.distance)],
                ['时长', formatDuration(total.seconds)],
                ['次数', `${total.count}`],
                ['出勤天数', `${total.activeDays}`]
            ]) +
                tipSports(sportSlices(total.sports)) +
                weekList +
                farthest
        );
    };

    /* ---------------- tooltip：年 ---------------- */
    const yearTip = (year: number) => {
        const records = props.records.filter((record) => record.date.slice(0, 4) === String(year));
        const total = totalsOf(records);
        if (!total.count) return tipShell(`${year} 年`, '这一年还没有运动记录', '');
        const months = monthBuckets(props.records, year).filter((bucket) => bucket.count > 0);
        const monthList = `<p class="ex-cal-tip-section">月度距离</p><ul class="ex-cal-tip-months">${months
            .map((bucket) => `<li><em>${bucket.month}月</em><b>${formatRecordDistance(bucket.distance)}</b></li>`)
            .join('')}</ul>`;
        return tipShell(
            `${year} 年`,
            `出勤 ${total.activeDays} 天 · 覆盖 ${months.length} 个月`,
            tipGrid([
                ['总距离', formatRecordDistance(total.distance)],
                ['总时长', formatDuration(total.seconds)],
                ['次数', `${total.count}`],
                ['出勤天数', `${total.activeDays}`]
            ]) +
                monthList +
                tipSports(sportSlices(total.sports))
        );
    };

    const calendarDays = () => {
        const current = monthAnchor();
        if (!current) return [];
        // 不保留「整行都不属于本月」的尾行：10 月日历不该多出一整行 11 月日期
        return monthGrid(current.year, current.month, props.records)
            .flat()
            .map((cell) => {
                const dayRecords = props.records.filter((record) => record.date === cell.date);
                const slices = sportSlices(totalsOf(dayRecords).sports);
                return { cell, slices, tip: dayTip(cell.date, dayRecords) };
            });
    };

    const monthSummary = () => {
        const current = monthAnchor();
        if (!current) return '';
        const key = `${current.year}-${String(current.month).padStart(2, '0')}`;
        const totals = totalsOf(props.records.filter((record) => record.date.slice(0, 7) === key));
        return totals.count ? `本月 ${totals.count} 次 · ${formatRecordDistance(totals.distance)} · ${formatDuration(totals.seconds)}` : '本月还没有运动记录';
    };

    /* ---------------- 全部运动 ---------------- */
    function overviewBody() {
        const totals = totalsOf(props.records);
        if (!totals.count) return <p class="ex-stats-empty">还没有运动记录</p>;
        const slices = sportSlices(totals.sports);
        const marks: Array<{ kind: MarkKind; label: string; value: string; record: ExerciseRecord }> = [];
        if (totals.longest && totals.longest.distance > 0)
            marks.push({ kind: 'distance', label: '最远一次', value: formatRecordDistance(totals.longest.distance), record: totals.longest });
        if (totals.longestDuration && totals.longestDuration.seconds > 0)
            marks.push({ kind: 'duration', label: '最久一次', value: formatDuration(totals.longestDuration.seconds), record: totals.longestDuration });
        if (totals.mostElevation && totals.mostElevation.elevation > 0)
            marks.push({ kind: 'elevation', label: '爬升最多', value: formatElevation(totals.mostElevation.elevation), record: totals.mostElevation });
        if (totals.bestPace) marks.push({ kind: 'pace', label: '最快配速', value: totals.bestPace.pace, record: totals.bestPace.record });

        const distance = distanceParts(totals.distance);
        const hours = hoursParts(totals.seconds);
        const elevation = elevationParts(totals.elevation);
        const average = averageParts(totals.distance, totals.count);
        const metrics = [
            { label: '总次数', value: `${totals.count}`, unit: '次' },
            { label: '总里程', value: distance.value, unit: distance.unit },
            { label: '总时长', value: hours.value, unit: hours.unit },
            { label: '总爬升', value: elevation.value, unit: elevation.unit },
            { label: '出勤天数', value: `${totals.activeDays}`, unit: '天' },
            { label: '平均每次', value: average.value, unit: average.unit }
        ];

        return (
            <div class="ex-ov" data-ex-stats-panel="all">
                <header class="ex-ov-head">
                    <h2 class="ex-ov-title">全部运动</h2>
                    <span class="ex-ov-range">{spanLabel(props.records)}</span>
                </header>

                <dl class="ex-ov-metrics">
                    <For each={metrics}>
                        {(item) => (
                            <div class="ex-ov-metric">
                                <dt>{item.label}</dt>
                                <dd>
                                    {item.value}
                                    {item.unit ? <small>{item.unit}</small> : null}
                                </dd>
                            </div>
                        )}
                    </For>
                </dl>

                <p class="ex-ov-section">运动类型</p>
                <div class="ex-ov-share" aria-hidden="true">
                    <For each={slices}>{(slice) => <span style={`flex:${Math.max(slice.share, 0.01)};background:${slice.color}`} />}</For>
                </div>
                <ul class="ex-ov-legend">
                    <For each={slices}>
                        {(slice) => (
                            <li>
                                <i style={`--c:${slice.color}`} aria-hidden="true" />
                                <span>{slice.label}</span>
                                <b>{slice.count} 次</b>
                                <em>{slice.percent > 0 ? `${slice.percent}%` : '<1%'}</em>
                            </li>
                        )}
                    </For>
                </ul>

                {marks.length > 0 ? (
                    <>
                        <p class="ex-ov-section">纪录</p>
                        <div class="ex-ov-records">
                            <For each={marks}>
                                {(mark) => (
                                    <button
                                        type="button"
                                        class="ex-ov-record"
                                        classList={{ 'is-active': props.scope.kind === 'record' && props.scope.id === mark.record.id }}
                                        title={`${mark.label} · ${mark.record.name}`}
                                        onMouseEnter={() => props.onHover?.(mark.record.id)}
                                        onMouseLeave={() => props.onHover?.(null)}
                                        onFocus={() => props.onHover?.(mark.record.id)}
                                        onBlur={() => props.onHover?.(null)}
                                        onClick={() => props.onSelect({ kind: 'record', id: mark.record.id })}
                                    >
                                        <RecordIcon kind={mark.kind} />
                                        <span class="ex-ov-record-label">{mark.label}</span>
                                        <span class="ex-ov-record-value">{mark.value}</span>
                                        <span class="ex-ov-record-date">{mark.record.date.slice(5)}</span>
                                    </button>
                                )}
                            </For>
                        </div>
                    </>
                ) : null}
            </div>
        );
    }

    let calendarCard: HTMLElement | undefined;
    let lastCardHeight = 0;
    let heightTimer: ReturnType<typeof setTimeout> | null = null;

    // 切换月份时，让卡片高度从旧值平滑过渡到新值（5 行 / 6 行月历高度不同）
    createEffect(() => {
        monthKey();
        if (!calendarCard) return;
        queueMicrotask(() => {
            const el = calendarCard;
            if (!el) return;
            const next = el.offsetHeight;
            if (lastCardHeight && Math.abs(next - lastCardHeight) > 2) {
                el.style.transition = 'height 260ms ease';
                el.style.overflow = 'hidden';
                el.style.height = `${lastCardHeight}px`;
                // 强制一次布局，让起始高度生效，后面的高度变化才会触发 transition
                void el.offsetHeight;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        el.style.height = `${next}px`;
                        if (heightTimer) clearTimeout(heightTimer);
                        heightTimer = setTimeout(() => {
                            el.style.height = '';
                            el.style.overflow = '';
                            el.style.transition = '';
                        }, 320);
                    });
                });
            }
            lastCardHeight = next;
        });
    });

    onCleanup(() => {
        if (heightTimer) clearTimeout(heightTimer);
    });

    onMount(() => {
        if (!calendarCard) return;
        // tippy.delegate 用事件委托：切月份后新生成的格子也能直接有 tooltip
        const instance = delegate(calendarCard, {
            target: '[data-cal-tip]',
            allowHTML: true,
            interactive: true,
            interactiveBorder: 8,
            hideOnClick: false,
            theme: 'auto',
            maxWidth: 320,
            offset: [0, 10],
            delay: [80, 120],
            appendTo: () => document.body,
            content: (reference) => reference.getAttribute('data-cal-tip') || '',
            onCreate(instance: any) {
                // 只给日历 tooltip 的 .tippy-box 加独立类名，避免影响站内其它 tippy；
                // instance.popper 是定位用的 data-tippy-root 外壳，真正的卡片是它的第一个子元素
                const box = instance.popper.firstElementChild as HTMLElement | null;
                box?.classList.add('ex-cal-tip-box');
                instance.popper.addEventListener('click', (event: MouseEvent) => {
                    const target = (event.target as HTMLElement | null)?.closest('[data-record-id]') as HTMLElement | null;
                    const id = target?.getAttribute('data-record-id');
                    if (!id) return;
                    props.onSelect({ kind: 'record', id });
                    instance.hide();
                });
            }
        });
        onCleanup(() => {
            instance.destroy();
        });
    });

    return (
        <div class="ex-stats-stack" data-exercise-stats>
            <section class="ex-stats-card ex-stats-card--calendar" ref={calendarCard} aria-label="运动日历">
                <Show when={monthKey()} keyed>
                    <div class="ex-cal-body">
                        <div class="ex-stats-head">
                            <button type="button" class="ex-stats-nav ex-cal-nav" aria-label="上一个月" title="上一个月" onClick={() => goMonth(-1)}>
                                <Chevron dir="left" />
                            </button>
                            <p class="ex-stats-head-title ex-cal-head">
                                {(() => {
                                    const current = monthAnchor();
                                    if (!current) return '运动日历';
                                    return (
                                        <>
                                            <button
                                                type="button"
                                                class="ex-cal-head-part"
                                                data-cal-tip={yearTip(current.year)}
                                                onClick={() => props.onSelect({ kind: 'year', year: current.year })}
                                            >
                                                {current.year} 年
                                            </button>
                                            <button
                                                type="button"
                                                class="ex-cal-head-part"
                                                data-cal-tip={monthTip(current.year, current.month)}
                                                onClick={() => props.onSelect({ kind: 'month', year: current.year, month: current.month })}
                                            >
                                                {current.month} 月
                                            </button>
                                        </>
                                    );
                                })()}
                            </p>
                            <button type="button" class="ex-stats-nav ex-cal-nav" aria-label="下一个月" title="下一个月" onClick={() => goMonth(1)}>
                                <Chevron dir="right" />
                            </button>
                        </div>
                        <div class="ex-stats-cal">
                            <For each={WEEKDAYS}>{(label) => <span class="ex-stats-cal-weekday">{label}</span>}</For>
                            <For each={calendarDays()}>
                                {(item) => (
                                    <CalendarDay
                                        cell={item.cell}
                                        slices={item.slices}
                                        tip={item.tip}
                                        selected={selectedDay() === item.cell.date}
                                        onSelect={props.onSelect}
                                    />
                                )}
                            </For>
                        </div>
                        <p class="ex-stats-summary">{monthSummary()}</p>
                    </div>
                </Show>
            </section>

            <hr class="ex-stats-divider" />

            <section class="ex-stats-card ex-stats-card--overview" aria-label="运动总览">
                <div class="ex-stats-body">{overviewBody()}</div>
            </section>
        </div>
    );
}
