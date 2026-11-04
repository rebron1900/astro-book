/**
 * 运动页面共享数据层：把 strava.json 的原始活动整理成「运动记录」，
 * 并计算时间线分组、时间范围（scope）统计、日历/周/月/年序列。
 *
 * 该模块同时被 Astro（构建期服务端渲染）和浏览器端 island 引用，
 * 因此保持纯函数、不依赖 DOM，也不做时区换算（数据里是本地墙上时间）。
 */
import type { StravaActivity } from './strava-types';

export type SportKey = 'run' | 'ride' | 'walk' | 'hike' | 'climb' | 'swim' | 'stair' | 'other';

export interface SportMeta {
    key: SportKey;
    label: string;
    /** 与时间线卡片同一套颜色，保持页面内一致 */
    color: string;
}

export const SPORT_META: Record<SportKey, SportMeta> = {
    run: { key: 'run', label: '跑步', color: '#16a34a' },
    ride: { key: 'ride', label: '骑行', color: '#2563eb' },
    walk: { key: 'walk', label: '步行', color: '#b45309' },
    hike: { key: 'hike', label: '徒步', color: '#4d7c0f' },
    climb: { key: 'climb', label: '攀岩', color: '#7c3aed' },
    swim: { key: 'swim', label: '游泳', color: '#0e7490' },
    stair: { key: 'stair', label: '爬楼', color: '#d97706' },
    other: { key: 'other', label: '运动', color: '#64748b' }
};

export const SPORT_ORDER: SportKey[] = ['run', 'ride', 'walk', 'hike', 'climb', 'swim', 'stair', 'other'];

/** 用配速（而不是速度）衡量的运动 */
export const FOOT_SPORTS = new Set<SportKey>(['run', 'walk', 'hike']);

export function sportOf(type: string): SportKey {
    const value = String(type || '').toLowerCase();
    if (value.includes('stair')) return 'stair';
    if (value.includes('ride') || value.includes('bike') || value.includes('cycle')) return 'ride';
    if (value.includes('run')) return 'run';
    if (value.includes('hike')) return 'hike';
    if (value.includes('walk')) return 'walk';
    if (value.includes('climb')) return 'climb';
    if (value.includes('swim')) return 'swim';
    return 'other';
}

export function sportMetaOf(type: string): SportMeta {
    return SPORT_META[sportOf(type)];
}

/** 时间线 / 地图 / 统计共用的运动记录 */
/** 估算卡路里用的默认体重（kg），可按需修改 */
export const CALORIE_WEIGHT_KG = 65;

/** 各运动类型的 MET 值（估算用） */
const MET_BY_SPORT: Record<SportKey, number> = {
    run: 9.8,
    ride: 7.5,
    walk: 3.5,
    hike: 6,
    climb: 8,
    swim: 8,
    stair: 9,
    other: 6
};

/** 按运动类型 + 时长估算消耗（kcal） */
export function estimateCalories(sport: SportKey, seconds: number): number {
    if (!(seconds > 0)) return 0;
    return Math.round((MET_BY_SPORT[sport] ?? 6) * CALORIE_WEIGHT_KG * (seconds / 3600));
}

export interface ExerciseRecord {
    id: string;
    name: string;
    /** YYYY-MM-DD（本地时间） */
    date: string;
    /** HH:mm */
    time: string;
    /** YYYY-MM */
    month: string;
    year: number;
    /** 原始类型，如 Run / Ride */
    type: string;
    sport: SportKey;
    /** 距离，米 */
    distance: number;
    /** 移动时长，秒 */
    seconds: number;
    /** 累计爬升，米 */
    elevation: number;
    /** 平均速度，m/s */
    speed: number | null;
    /** 平均心率 */
    hr: number | null;
    /** 三级地点描述（可能为空） */
    location: string;
    /** 是否有可绘制的轨迹 */
    hasRoute: boolean;
    /** 原始编码轨迹，仅构建期用于生成地图数据；页面数据集会剔除 */
    polyline?: string;
}

/** "0:31:53" / "50:57" / 3060 -> 秒 */
export function parseDuration(input: string | number | null | undefined): number {
    if (typeof input === 'number' && Number.isFinite(input)) return Math.max(0, Math.round(input));
    if (!input) return 0;
    const parts = String(input)
        .trim()
        .split(':')
        .map((part) => Number(part) || 0);
    if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

/** 3060 -> "51:00"，3661 -> "1:01:01" */
export function formatDuration(seconds: number): string {
    const value = Math.max(0, Math.round(seconds));
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** 秒数转「x.x 小时」统计口径 */
export function formatHours(seconds: number): string {
    const hours = seconds / 3600;
    if (hours >= 10) return `${Math.round(hours)} h`;
    return `${hours.toFixed(1)} h`;
}

/** 米 -> "12.34 km" / "800 m" */
export function formatDistance(meters: number): string {
    if (!Number.isFinite(meters) || meters <= 0) return '0 km';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
}

/** 记录距离：0 距离（爬楼等）显示占位 */
export function formatRecordDistance(meters: number): string {
    return meters > 0 ? formatDistance(meters) : '—';
}

/** 配速：米与秒 -> "5'32"/km" */
export function formatPace(seconds: number, meters: number): string | null {
    if (!seconds || !meters || meters <= 0) return null;
    const perKm = seconds / (meters / 1000);
    const m = Math.floor(perKm / 60);
    const s = Math.round(perKm % 60);
    return `${m}'${String(s === 60 ? 0 : s).padStart(2, '0')}"/km`;
}

/** 平均速度（m/s） */
export function formatSpeed(speed: number | null | undefined): string | null {
    if (!speed || speed <= 0) return null;
    return `${(speed * 3.6).toFixed(1)} km/h`;
}

/** 平均配速（m/s） */
export function formatPaceFromSpeed(speed: number | null | undefined): string | null {
    if (!speed || speed <= 0) return null;
    const perKm = 1000 / speed;
    const m = Math.floor(perKm / 60);
    const s = Math.round(perKm % 60);
    return `${m}'${String(s === 60 ? 0 : s).padStart(2, '0')}"/km`;
}

/* ------------------------------------------------------------------ */
/* 日期工具（一律按 UTC 计算，避免构建机与浏览器时区差异）               */
/* ------------------------------------------------------------------ */

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

/** "2026-10-11" -> { y, m, d } */
export function dateParts(date: string): { y: number; m: number; d: number } {
    const [y, m, d] = date.slice(0, 10).split('-').map(Number);
    return { y, m, d };
}

function utcMs(date: string): number {
    const { y, m, d } = dateParts(date);
    return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
    const date = new Date(ms);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
    return fromUtcMs(utcMs(date) + days * 86400000);
}

/** 0=周日 … 6=周六 */
export function weekdayOf(date: string): number {
    return new Date(utcMs(date)).getUTCDay();
}

/** "周六" */
export function weekdayLabel(date: string): string {
    return WEEKDAY_LABELS[weekdayOf(date)];
}

/** 一周从周一开始；返回该周周一 */
export function weekStartOf(date: string): string {
    const offset = (weekdayOf(date) + 6) % 7;
    return addDays(date, -offset);
}

export function weekDaysOf(weekStart: string): string[] {
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/** 周序号（ISO 8601，周一开始，含 1 月 4 日的那一周为第 1 周） */
export function isoWeekNumber(date: string): number {
    const { y } = dateParts(date);
    const target = utcMs(date);
    const jan4 = utcMs(`${y}-01-04`);
    const jan4Offset = (new Date(jan4).getUTCDay() + 6) % 7;
    const week1Start = jan4 - jan4Offset * 86400000;
    return Math.floor((target - week1Start) / (7 * 86400000)) + 1;
}

export function monthLabel(year: number, month: number): string {
    return `${year} 年 ${month} 月`;
}

export function monthKey(year: number, month: number): string {
    return `${year}-${pad2(month)}`;
}

/** "10-11" */
export function dateShort(date: string): string {
    const { m, d } = dateParts(date);
    return `${pad2(m)}-${pad2(d)}`;
}

/** "2026-10-11" -> "2026 年 10 月 11 日" */
export function dateLabel(date: string): string {
    const { y, m, d } = dateParts(date);
    return `${y} 年 ${m} 月 ${d} 日`;
}

/** "2026-10-05 - 10-11" */
export function weekRangeLabel(weekStart: string): string {
    const end = addDays(weekStart, 6);
    return `${dateShort(weekStart)} - ${dateShort(end)}`;
}

export function weekLabel(weekStart: string): string {
    const { y } = dateParts(weekStart);
    return `${y} 年第 ${isoWeekNumber(weekStart)} 周`;
}

/* ------------------------------------------------------------------ */
/* 记录构建                                                            */
/* ------------------------------------------------------------------ */

function locationOf(raw: StravaActivity): string {
    const parts = String(raw.location_country ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !/^\d{5,6}$/.test(part))
        .filter((part) => part !== '中国')
        .filter((part) => !/(省|自治区|特别行政区)$/.test(part));
    if (!parts.length) return '';

    // 地址是从细到粗排列的，优先取「市 · 区/县」两级，避免显示 POI 名
    const cityIndex = parts.reduce((found, part, index) => (/(市|州|地区)$/.test(part) ? index : found), -1);
    if (cityIndex >= 0) {
        const city = parts[cityIndex];
        const district = parts[cityIndex - 1];
        return /(区|县|旗|镇)$/.test(district ?? '') ? `${city} · ${district}` : city;
    }

    const tail = parts.slice(-2).reverse();
    return tail.join(' · ');
}

export function buildRecords(raw: StravaActivity[]): ExerciseRecord[] {
    return raw
        .map((activity) => {
            const local = String(activity.start_date_local ?? activity.start_date ?? '');
            const date = local.slice(0, 10);
            const time = local.slice(11, 16);
            const { y, m } = dateParts(date);
            const sport = sportOf(activity.type);
            return {
                id: String(activity.run_id),
                name: activity.name || SPORT_META[sport].label,
                date,
                time,
                month: monthKey(y, m),
                year: y,
                type: activity.type,
                sport,
                distance: Number(activity.distance) || 0,
                seconds: parseDuration(activity.moving_time),
                elevation: Math.round(Number(activity.elevation_gain) || 0),
                speed: activity.average_speed ?? null,
                hr: activity.average_heartrate ?? null,
                location: locationOf(activity),
                hasRoute: Boolean(activity.summary_polyline && activity.summary_polyline.length > 20),
                polyline: activity.summary_polyline || undefined
            } satisfies ExerciseRecord;
        })
        .filter((record) => record.date.length === 10)
        .sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));
}

/**
 * 还原成 StravaActivity 形状，复用 `strava-preview.ts` 里既有的卡片文案逻辑
 * （首页 / 时间线的运动卡片和这里保持同一套「距离 / 配速 / 均速 / 用时 / 爬升 / 心率」）。
 */
export function toStravaActivity(record: ExerciseRecord): StravaActivity {
    const hours = Math.floor(record.seconds / 3600);
    const minutes = Math.floor((record.seconds % 3600) / 60);
    const seconds = record.seconds % 60;
    return {
        run_id: record.id,
        name: record.name,
        distance: record.distance,
        moving_time: `${hours}:${pad2(minutes)}:${pad2(seconds)}`,
        type: record.type,
        start_date: record.date,
        start_date_local: `${record.date} ${record.time}:00`,
        location_country: record.location,
        summary_polyline: record.polyline,
        average_heartrate: record.hr,
        average_speed: record.speed ?? undefined,
        elevation_gain: record.elevation
    };
}

/** 页面内嵌给浏览器用的数据集（去掉轨迹，轨迹走单独 JSON） */
export function compactRecords(records: ExerciseRecord[]): ExerciseRecord[] {
    return records.map(({ polyline: _polyline, ...rest }) => rest);
}

/* ------------------------------------------------------------------ */
/* 时间范围（scope）                                                    */
/* ------------------------------------------------------------------ */

export type ExerciseScope =
    | { kind: 'all' }
    | { kind: 'year'; year: number }
    | { kind: 'month'; year: number; month: number }
    | { kind: 'week'; date: string }
    | { kind: 'day'; date: string }
    | { kind: 'record'; id: string };

export const SCOPE_ALL: ExerciseScope = { kind: 'all' };

export function scopeKey(scope: ExerciseScope): string {
    switch (scope.kind) {
        case 'all':
            return 'all';
        case 'year':
            return `year:${scope.year}`;
        case 'month':
            return `month:${monthKey(scope.year, scope.month)}`;
        case 'week':
            return `week:${weekStartOf(scope.date)}`;
        case 'day':
            return `day:${scope.date}`;
        case 'record':
            return `record:${scope.id}`;
        default:
            return 'all';
    }
}

export function scopeFromRecord(record: ExerciseRecord): ExerciseScope {
    return { kind: 'record', id: record.id };
}

/** scope 对应的日期区间 [start, end]（含端点） */
export function scopeRange(scope: ExerciseScope, records: ExerciseRecord[] = []): { start: string; end: string } {
    switch (scope.kind) {
        case 'year':
            return { start: `${scope.year}-01-01`, end: `${scope.year}-12-31` };
        case 'month': {
            const start = `${monthKey(scope.year, scope.month)}-01`;
            const lastDay = new Date(Date.UTC(scope.year, scope.month, 0)).getUTCDate();
            return { start, end: `${monthKey(scope.year, scope.month)}-${pad2(lastDay)}` };
        }
        case 'week': {
            const start = weekStartOf(scope.date);
            return { start, end: addDays(start, 6) };
        }
        case 'day':
            return { start: scope.date, end: scope.date };
        case 'record': {
            const record = records.find((item) => item.id === scope.id);
            return record ? { start: record.date, end: record.date } : { start: '', end: '' };
        }
        case 'all':
        default: {
            if (!records.length) return { start: '', end: '' };
            const dates = records.map((record) => record.date).sort();
            return { start: dates[0], end: dates[dates.length - 1] };
        }
    }
}

export function recordsInScope(records: ExerciseRecord[], scope: ExerciseScope): ExerciseRecord[] {
    switch (scope.kind) {
        case 'all':
            return records;
        case 'year':
            return records.filter((record) => record.year === scope.year);
        case 'month':
            return records.filter((record) => record.year === scope.year && dateParts(record.date).m === scope.month);
        case 'week': {
            const { start, end } = scopeRange(scope);
            return records.filter((record) => record.date >= start && record.date <= end);
        }
        case 'day':
            return records.filter((record) => record.date === scope.date);
        case 'record':
            return records.filter((record) => record.id === scope.id);
        default:
            return records;
    }
}

/** scope 的简短中文描述，用于地图角标与统计标题 */
export function scopeLabel(scope: ExerciseScope, records: ExerciseRecord[] = []): string {
    switch (scope.kind) {
        case 'year':
            return `${scope.year} 年`;
        case 'month':
            return monthLabel(scope.year, scope.month);
        case 'week': {
            const start = weekStartOf(scope.date);
            return `${weekLabel(start)} · ${weekRangeLabel(start)}`;
        }
        case 'day':
            return dateLabel(scope.date);
        case 'record': {
            const record = records.find((item) => item.id === scope.id);
            if (!record) return '运动记录';
            return `${dateShort(record.date)} ${record.time} · ${SPORT_META[record.sport].label}`;
        }
        case 'all':
        default:
            return '全部运动';
    }
}

/** 计算 scope 里「最新的一天」所在月份/年份，供统计面板定位 */
export function scopeAnchor(scope: ExerciseScope, records: ExerciseRecord[]): { date: string; year: number; month: number } | null {
    const list = recordsInScope(records, scope);
    if (list.length) {
        const latest = list.reduce((acc, record) => (record.date > acc.date ? record : acc), list[0]);
        return { date: latest.date, year: latest.year, month: dateParts(latest.date).m };
    }
    // 空 scope（比如没有记录的月份）也要能定位到它自己
    const { start } = scopeRange(scope, records);
    if (!start) {
        const first = records[0];
        if (!first) return null;
        return { date: first.date, year: first.year, month: dateParts(first.date).m };
    }
    const { y, m } = dateParts(start);
    return { date: start, year: y, month: m };
}

export function defaultScope(records: ExerciseRecord[]): ExerciseScope {
    if (!records.length) return SCOPE_ALL;
    // 默认聚焦到「最近一条有轨迹的记录」：地图在城区尺度上才看得清路线，
    // 也能在首屏直接演示「点记录 → 地图亮起路线」这个交互。
    const latestWithRoute = records.find((record) => record.hasRoute);
    if (latestWithRoute) return { kind: 'record', id: latestWithRoute.id };
    const latest = records[0];
    return { kind: 'month', year: latest.year, month: dateParts(latest.date).m };
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

export interface SportTotal {
    key: SportKey;
    label: string;
    color: string;
    count: number;
    distance: number;
    seconds: number;
    elevation: number;
}

export interface ExerciseTotals {
    count: number;
    distance: number;
    seconds: number;
    elevation: number;
    /** 有运动的天数 */
    activeDays: number;
    /** 每天次数分布里的最大值 */
    busiestDay: { date: string; count: number; distance: number } | null;
    sports: SportTotal[];
    longest: ExerciseRecord | null;
    longestDuration: ExerciseRecord | null;
    mostElevation: ExerciseRecord | null;
    /** 单次最快配速（只统计有距离的） */
    bestPace: { record: ExerciseRecord; pace: string } | null;
    first: ExerciseRecord | null;
    latest: ExerciseRecord | null;
}

export function totalsOf(records: ExerciseRecord[]): ExerciseTotals {
    const sports = new Map<SportKey, SportTotal>();
    const days = new Map<string, { count: number; distance: number }>();
    let distance = 0;
    let seconds = 0;
    let elevation = 0;
    let longest: ExerciseRecord | null = null;
    let longestDuration: ExerciseRecord | null = null;
    let mostElevation: ExerciseRecord | null = null;
    let bestPace: { record: ExerciseRecord; pace: string; seconds: number } | null = null;

    for (const record of records) {
        distance += record.distance;
        seconds += record.seconds;
        elevation += record.elevation;

        const sport = sports.get(record.sport) ?? {
            ...SPORT_META[record.sport],
            count: 0,
            distance: 0,
            seconds: 0,
            elevation: 0
        };
        sport.count += 1;
        sport.distance += record.distance;
        sport.seconds += record.seconds;
        sport.elevation += record.elevation;
        sports.set(record.sport, sport);

        const day = days.get(record.date) ?? { count: 0, distance: 0 };
        day.count += 1;
        day.distance += record.distance;
        days.set(record.date, day);

        if (!longest || record.distance > longest.distance) longest = record;
        if (!longestDuration || record.seconds > longestDuration.seconds) longestDuration = record;
        if (!mostElevation || record.elevation > mostElevation.elevation) mostElevation = record;

        // 配速只对跑步/步行/徒步有意义，骑行按速度看，混进来会得出「2'33"/km」这种怪值
        if (FOOT_SPORTS.has(record.sport) && record.distance >= 1000 && record.seconds > 0) {
            const perKm = record.seconds / (record.distance / 1000);
            if (!bestPace || perKm < bestPace.seconds) {
                bestPace = { record, pace: formatPace(record.seconds, record.distance) ?? '', seconds: perKm };
            }
        }
    }

    let busiestDay: ExerciseTotals['busiestDay'] = null;
    for (const [date, value] of days) {
        if (!busiestDay || value.distance > busiestDay.distance) busiestDay = { date, count: value.count, distance: value.distance };
    }

    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));

    return {
        count: records.length,
        distance,
        seconds,
        elevation,
        activeDays: days.size,
        busiestDay,
        sports: SPORT_ORDER.map((key) => sports.get(key)).filter((item): item is SportTotal => Boolean(item)),
        longest,
        longestDuration,
        mostElevation,
        bestPace: bestPace ? { record: bestPace.record, pace: bestPace.pace } : null,
        first: sorted[0] ?? null,
        latest: sorted[sorted.length - 1] ?? null
    };
}

/* ------------------------------------------------------------------ */
/* 分组与序列                                                          */
/* ------------------------------------------------------------------ */

export interface MonthGroup {
    key: string;
    year: number;
    month: number;
    label: string;
    records: ExerciseRecord[];
    totals: ExerciseTotals;
}

export function groupByMonth(records: ExerciseRecord[]): MonthGroup[] {
    const groups = new Map<string, ExerciseRecord[]>();
    for (const record of records) {
        const list = groups.get(record.month) ?? [];
        list.push(record);
        groups.set(record.month, list);
    }
    return [...groups.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([key, list]) => {
            const [year, month] = key.split('-').map(Number);
            return {
                key,
                year,
                month,
                label: monthLabel(year, month),
                records: list,
                totals: totalsOf(list)
            };
        });
}

export interface MonthCell {
    date: string;
    day: number;
    inMonth: boolean;
    count: number;
    distance: number;
    isToday?: boolean;
}

/** 月历网格：6 行 × 7 列，周一开始 */
export function monthGrid(year: number, month: number, records: ExerciseRecord[] = [], options: { keepTrailingWeek?: boolean } = {}): MonthCell[][] {
    const first = `${monthKey(year, month)}-01`;
    const gridStart = weekStartOf(first);
    const byDate = new Map<string, { count: number; distance: number }>();
    for (const record of records) {
        const entry = byDate.get(record.date) ?? { count: 0, distance: 0 };
        entry.count += 1;
        entry.distance += record.distance;
        byDate.set(record.date, entry);
    }
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    const cells: MonthCell[][] = [];
    for (let week = 0; week < 6; week += 1) {
        const row: MonthCell[] = [];
        for (let weekday = 0; weekday < 7; weekday += 1) {
            const date = addDays(gridStart, week * 7 + weekday);
            const { m, d } = dateParts(date);
            const entry = byDate.get(date);
            row.push({
                date,
                day: d,
                inMonth: m === month,
                count: entry?.count ?? 0,
                distance: entry?.distance ?? 0,
                isToday: date === todayKey
            });
        }
        cells.push(row);
    }
    // 默认去掉完全空白的第 6 行；日历卡片要固定 6 行高度时传 keepTrailingWeek
    if (!options.keepTrailingWeek) {
        const last = cells[cells.length - 1];
        if (last.every((cell) => !cell.inMonth)) cells.pop();
    }
    return cells;
}

export interface MonthBucket {
    month: number;
    label: string;
    count: number;
    distance: number;
    seconds: number;
}

/** 某年的 12 个月序列 */
export function monthBuckets(records: ExerciseRecord[], year: number): MonthBucket[] {
    const buckets = Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        label: `${index + 1}月`,
        count: 0,
        distance: 0,
        seconds: 0
    }));
    for (const record of records) {
        if (record.year !== year) continue;
        const bucket = buckets[dateParts(record.date).m - 1];
        if (!bucket) continue;
        bucket.count += 1;
        bucket.distance += record.distance;
        bucket.seconds += record.seconds;
    }
    return buckets;
}

export interface WeekBucket {
    start: string;
    end: string;
    label: string;
    count: number;
    distance: number;
    seconds: number;
}

/** 覆盖某月的周序列（以周一为起点，包含跨月的那几天，和点击后的周范围一致） */
export function weekBuckets(records: ExerciseRecord[], year: number, month: number): WeekBucket[] {
    const first = `${monthKey(year, month)}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = `${monthKey(year, month)}-${pad2(lastDay)}`;
    const buckets: WeekBucket[] = [];
    let cursor = weekStartOf(first);
    while (cursor <= last) {
        const end = addDays(cursor, 6);
        buckets.push({
            start: cursor,
            end,
            label: `${dateShort(cursor)}`,
            count: 0,
            distance: 0,
            seconds: 0
        });
        cursor = addDays(cursor, 7);
    }
    for (const record of records) {
        const bucket = buckets.find((item) => record.date >= item.start && record.date <= item.end);
        if (!bucket) continue;
        bucket.count += 1;
        bucket.distance += record.distance;
        bucket.seconds += record.seconds;
    }
    return buckets;
}

export interface DayBucket {
    date: string;
    weekday: number;
    label: string;
    count: number;
    distance: number;
    seconds: number;
    isToday: boolean;
}

/** 一周 7 天序列 */
export function dayBuckets(records: ExerciseRecord[], weekStart: string): DayBucket[] {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    return weekDaysOf(weekStart).map((date) => {
        const dayRecords = records.filter((record) => record.date === date);
        return {
            date,
            weekday: weekdayOf(date),
            label: WEEKDAY_LABELS[weekdayOf(date)].replace('周', ''),
            count: dayRecords.length,
            distance: dayRecords.reduce((sum, record) => sum + record.distance, 0),
            seconds: dayRecords.reduce((sum, record) => sum + record.seconds, 0),
            isToday: date === todayKey
        };
    });
}

/* ------------------------------------------------------------------ */
/* 轨迹（地图）                                                        */
/* ------------------------------------------------------------------ */

/** Google encoded polyline 解码，返回 [lng, lat][]（GeoJSON 顺序） */
export function decodeRoute(encoded: string): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
        let result = 0;
        let shift = 0;
        let byte: number;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;
        result = 0;
        shift = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        points.push([lng / 1e5, lat / 1e5]);
    }
    return points;
}

/** 生成地图用的轨迹索引 { [id]: polyline } */
export function buildRouteIndex(records: ExerciseRecord[]): Record<string, string> {
    const index: Record<string, string> = {};
    for (const record of records) {
        if (record.polyline) index[record.id] = record.polyline;
    }
    return index;
}

/* ------------------------------------------------------------------ */
/* 时间线 <-> 地图/统计 的事件协议                                      */
/* ------------------------------------------------------------------ */

/** 选中某个时间范围：detail = { scope: ExerciseScope, source: 'timeline' | 'stats' | 'map' | 'init' } */
export const EXERCISE_SELECT_EVENT = 'exercise:select';
/** 悬停某条记录（不改变选中状态）：detail = { id: string | null } */
export const EXERCISE_HOVER_EVENT = 'exercise:hover';

export interface ExerciseSelectDetail {
    scope: ExerciseScope;
    source?: 'timeline' | 'stats' | 'map' | 'init';
}

export interface ExerciseHoverDetail {
    id: string | null;
}
