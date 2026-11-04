/**
 * 运动统计面板专用的纯计算与格式化。
 *
 * 只服务 `src/components/islands/ExerciseStats.tsx`：共享数据层 `src/lib/exercise.ts`
 * 由页面、时间线和地图共用，这里不往里加只属于统计面板的东西。
 * 与共享层一样保持纯函数、不访问 DOM，构建期与浏览器端都能安全调用。
 */
import type { ExerciseRecord, SportKey, SportTotal } from './exercise';
import { SPORT_META, SPORT_ORDER } from './exercise';

/** 1234 -> "1,234"（手动分组，避免 toLocaleString 在构建机与浏览器之间不一致） */
export function groupDigits(value: number): string {
    const digits = String(Math.round(Math.abs(value)));
    let output = '';
    for (let index = 0; index < digits.length; index += 1) {
        if (index > 0 && (digits.length - index) % 3 === 0) output += ',';
        output += digits[index];
    }
    return value < 0 ? `-${output}` : output;
}

/** 爬升/海拔：0 显示占位，四位数以上加千位分隔 */
export function formatElevation(meters: number): string {
    if (!Number.isFinite(meters) || meters <= 0) return '—';
    return `${groupDigits(meters)} m`;
}

/** 月份加减，跨年自动进位；"2026 年 1 月" 往前一格是 "2025 年 12 月" */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const index = year * 12 + (month - 1) + delta;
    const nextYear = Math.floor(index / 12);
    return { year: nextYear, month: index - nextYear * 12 + 1 };
}

/**
 * 月历格子的着色档位：0 无运动，1..3 由当天距离相对「当月最远一天」的比例决定，
 * 这样每个月的月历都能拉开层次（都是 5 km 的月份也不至于整片一个色）；
 * 当天/整月都没有距离（比如只爬楼）时退回按次数分档。
 */
export function dayLevel(count: number, distance: number, maxDistance: number): 0 | 1 | 2 | 3 {
    if (count <= 0) return 0;
    if (maxDistance > 0 && distance > 0) {
        const ratio = distance / maxDistance;
        if (ratio >= 0.6) return 3;
        if (ratio >= 0.25) return 2;
        return 1;
    }
    return count >= 3 ? 3 : count >= 2 ? 2 : 1;
}

export interface MetricParts {
    value: string;
    unit: string;
}

/** 「39.05」+「km」：数字与单位拆开，窄格子里才不会把单位挤掉 */
export function distanceParts(meters: number): MetricParts {
    if (!Number.isFinite(meters) || meters <= 0) return { value: '—', unit: '' };
    if (meters < 1000) return { value: `${Math.round(meters)}`, unit: 'm' };
    return { value: (meters / 1000).toFixed(2), unit: 'km' };
}

/** 「22,992」+「m」 */
export function elevationParts(meters: number): MetricParts {
    if (!Number.isFinite(meters) || meters <= 0) return { value: '—', unit: '' };
    return { value: groupDigits(meters), unit: 'm' };
}

/** 「142」+「h」 */
export function hoursParts(seconds: number): MetricParts {
    const hours = seconds / 3600;
    return { value: hours >= 10 ? `${Math.round(hours)}` : hours.toFixed(1), unit: 'h' };
}

export interface SportSlice {
    key: SportKey;
    label: string;
    color: string;
    count: number;
    distance: number;
    seconds: number;
    /** 0..1，按距离算；整组都没有距离时退回按次数 */
    share: number;
    /** 0..100 的整数百分比，用于展示 */
    percent: number;
}

/** 把 totalsOf().sports 变成带占比的切片，按占比降序 */
export function sportSlices(sports: SportTotal[]): SportSlice[] {
    const distanceTotal = sports.reduce((sum, item) => sum + Math.max(0, item.distance), 0);
    const countTotal = sports.reduce((sum, item) => sum + Math.max(0, item.count), 0);
    const byDistance = distanceTotal > 0;
    const total = byDistance ? distanceTotal : countTotal;
    return sports
        .map((item) => {
            const value = byDistance ? Math.max(0, item.distance) : Math.max(0, item.count);
            const share = total > 0 ? value / total : 0;
            return {
                key: item.key,
                label: item.label,
                color: item.color,
                count: item.count,
                distance: item.distance,
                seconds: item.seconds,
                share,
                percent: Math.round(share * 100)
            };
        })
        .sort((a, b) => b.share - a.share || SPORT_ORDER.indexOf(a.key) - SPORT_ORDER.indexOf(b.key));
}

/**
 * 柱状图高度百分比（0..100）。
 * 优先按距离归一化；整段都没有距离（爬楼）时退回按次数，保证有记录的天/月仍看得见；
 * 有记录但数值为 0 的柱子给一个最小高度，避免读成「无事发生」。
 */
export function barHeights<T>(items: T[], pickDistance: (item: T) => number, pickCount: (item: T) => number, minPercent = 5): number[] {
    const maxDistance = items.reduce((max, item) => Math.max(max, pickDistance(item)), 0);
    const maxCount = items.reduce((max, item) => Math.max(max, pickCount(item)), 0);
    return items.map((item) => {
        const count = pickCount(item);
        if (count <= 0) return 0;
        const max = maxDistance > 0 ? maxDistance : maxCount;
        const value = maxDistance > 0 ? pickDistance(item) : count;
        if (max <= 0) return 0;
        return Math.max(minPercent, Math.min(100, (value / max) * 100));
    });
}

/** 按天挑出主导运动（距离优先，其次次数，最后按固定运动顺序），返回当天的颜色，给月历格子取色 */
export function dominantSportColors(records: ExerciseRecord[]): Map<string, string> {
    const byDate = new Map<string, ExerciseRecord[]>();
    for (const record of records) {
        const list = byDate.get(record.date) ?? [];
        list.push(record);
        byDate.set(record.date, list);
    }
    const result = new Map<string, string>();
    for (const [date, list] of byDate) {
        const best = list.reduce((acc, record) => {
            if (record.distance > acc.distance) return record;
            if (record.distance === acc.distance && SPORT_ORDER.indexOf(record.sport) < SPORT_ORDER.indexOf(acc.sport)) return record;
            return acc;
        }, list[0]);
        result.set(date, SPORT_META[best.sport].color);
    }
    return result;
}

/** 全部记录的跨度："2024.03 — 2026.10" */
export function spanLabel(records: ExerciseRecord[]): string {
    if (!records.length) return '暂无记录';
    const dates = records.map((record) => record.date).sort();
    const first = dates[0].slice(0, 7).replace('-', '.');
    const last = dates[dates.length - 1].slice(0, 7).replace('-', '.');
    return `${first} — ${last}`;
}

/** 平均每次距离；0 次或 0 距离返回占位 */
export function averageParts(distance: number, count: number): MetricParts {
    if (!count || distance <= 0) return { value: '—', unit: '' };
    return distanceParts(distance / count);
}
