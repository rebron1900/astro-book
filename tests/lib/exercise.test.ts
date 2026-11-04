import { describe, it, expect } from 'vitest';
import {
    addDays,
    buildRecords,
    buildRouteIndex,
    decodeRoute,
    defaultScope,
    formatDistance,
    formatDuration,
    formatHours,
    formatPace,
    groupByMonth,
    isoWeekNumber,
    monthBuckets,
    monthGrid,
    parseDuration,
    recordsInScope,
    scopeAnchor,
    scopeKey,
    scopeLabel,
    scopeRange,
    sportOf,
    totalsOf,
    weekBuckets,
    weekStartOf,
    weekdayLabel
} from '../../src/lib/exercise';
import type { ExerciseRecord } from '../../src/lib/exercise';
import type { StravaActivity } from '../../src/lib/strava-types';

function record(partial: Partial<ExerciseRecord> & { id: string; date: string }): ExerciseRecord {
    const [year, month] = partial.date.split('-').map(Number);
    return {
        id: partial.id,
        name: partial.name ?? 'Morning Run',
        date: partial.date,
        time: partial.time ?? '07:00',
        month: partial.month ?? `${year}-${String(month).padStart(2, '0')}`,
        year: partial.year ?? year,
        type: partial.type ?? 'Run',
        sport: partial.sport ?? 'run',
        distance: partial.distance ?? 5000,
        seconds: partial.seconds ?? 1800,
        elevation: partial.elevation ?? 40,
        speed: partial.speed ?? 2.7,
        hr: partial.hr ?? null,
        location: partial.location ?? '',
        hasRoute: partial.hasRoute ?? true
    };
}

describe('时长 / 距离格式化', () => {
    it('parseDuration 支持 H:MM:SS 与 M:SS', () => {
        expect(parseDuration('1:47:02')).toBe(6422);
        expect(parseDuration('0:00:04')).toBe(4);
        expect(parseDuration('50:57')).toBe(3057);
        expect(parseDuration(120)).toBe(120);
        expect(parseDuration(null)).toBe(0);
    });

    it('formatDuration 按需省略小时位', () => {
        expect(formatDuration(6422)).toBe('1:47:02');
        expect(formatDuration(3057)).toBe('50:57');
        expect(formatDuration(4)).toBe('0:04');
    });

    it('formatHours 保留一位小数', () => {
        expect(formatHours(3600 * 142)).toBe('142 h');
        expect(formatHours(3600 * 1.5)).toBe('1.5 h');
    });

    it('formatDistance 在公里/米之间切换', () => {
        expect(formatDistance(4410)).toBe('4.41 km');
        expect(formatDistance(413)).toBe('413 m');
        expect(formatDistance(0)).toBe('0 km');
    });

    it('formatPace 输出配速', () => {
        expect(formatPace(1800, 5000)).toBe(`6'00"/km`);
        expect(formatPace(0, 5000)).toBeNull();
        expect(formatPace(1800, 0)).toBeNull();
    });
});

describe('运动类型归类', () => {
    it('把 Strava 类型映射到站点运动类型', () => {
        expect(sportOf('Run')).toBe('run');
        expect(sportOf('Ride')).toBe('ride');
        expect(sportOf('Walk')).toBe('walk');
        expect(sportOf('Hike')).toBe('hike');
        expect(sportOf('RockClimbing')).toBe('climb');
        expect(sportOf('StairStepper')).toBe('stair');
        expect(sportOf('Swim')).toBe('swim');
        expect(sportOf('UnknownThing')).toBe('other');
    });
});

describe('日期工具', () => {
    it('addDays 跨月跨年正确', () => {
        expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('weekStartOf 以周一为起点', () => {
        // 2026-10-11 是周日
        expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
        // 周一本身保持不变
        expect(weekStartOf('2026-10-05')).toBe('2026-10-05');
    });

    it('weekdayLabel 输出中文星期', () => {
        expect(weekdayLabel('2026-10-11')).toBe('周日');
        expect(weekdayLabel('2026-10-05')).toBe('周一');
    });

    it('isoWeekNumber 与周一为周首的口径一致', () => {
        expect(isoWeekNumber('2026-01-04')).toBe(1);
        expect(isoWeekNumber('2026-10-05')).toBe(41);
    });
});

describe('buildRecords', () => {
    const raw = [
        {
            run_id: 1,
            name: 'Morning Run',
            distance: 4810,
            moving_time: '0:31:53',
            type: 'Run',
            start_date: '2024-03-11 23:05:55+00:00',
            start_date_local: '2024-03-12 07:05:55',
            location_country: '恒大农贸市场, 恒大绿洲, 板仓街道, 沿滩区, 自贡市, 四川省, 643000, 中国',
            summary_polyline: 'wc}qDw}r~REAIJ[~@QJOGIMEU?MV{ADK~BiDfBc',
            average_heartrate: null,
            average_speed: 2.514,
            elevation_gain: 238.4
        },
        {
            run_id: 2,
            name: 'Night Stair Stepper',
            distance: 0,
            moving_time: '24:47',
            type: 'StairStepper',
            start_date: '2026-09-30 12:00:00+00:00',
            start_date_local: '2026-09-30 20:00:00',
            elevation_gain: 271
        }
    ] as unknown as StravaActivity[];

    it('整理字段并按时间倒序', () => {
        const records = buildRecords(raw);
        expect(records.map((item) => item.id)).toEqual(['2', '1']);

        const first = records[0];
        expect(first.date).toBe('2026-09-30');
        expect(first.time).toBe('20:00');
        expect(first.month).toBe('2026-09');
        expect(first.sport).toBe('stair');
        expect(first.seconds).toBe(1487);
        expect(first.hasRoute).toBe(false);
        expect(first.polyline).toBeUndefined();

        const second = records[1];
        expect(second.seconds).toBe(1913);
        expect(second.elevation).toBe(238);
        expect(second.hasRoute).toBe(true);
        expect(second.location).toBe('自贡市 · 沿滩区');
        expect(second.location).not.toContain('中国');
        expect(second.location).not.toContain('643000');
    });

    it('buildRouteIndex 只保留有轨迹的记录', () => {
        const index = buildRouteIndex(buildRecords(raw));
        expect(Object.keys(index)).toEqual(['1']);
        expect(typeof index['1']).toBe('string');
    });
});

describe('decodeRoute', () => {
    it('解码 Google 官方示例折线为 [lng, lat]', () => {
        const points = decodeRoute('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
        expect(points.length).toBe(3);
        expect(points[0][1]).toBeCloseTo(38.5, 4);
        expect(points[0][0]).toBeCloseTo(-120.2, 4);
        expect(points[2][1]).toBeCloseTo(43.252, 3);
        expect(points[2][0]).toBeCloseTo(-126.453, 3);
    });

    it('空串返回空数组', () => {
        expect(decodeRoute('')).toEqual([]);
    });
});

describe('scope 过滤与描述', () => {
    const records = [
        record({ id: 'a', date: '2026-10-01', distance: 10000 }),
        record({ id: 'b', date: '2026-10-03', distance: 5000 }),
        record({ id: 'c', date: '2026-09-28', distance: 2000 }),
        record({ id: 'd', date: '2025-12-31', distance: 7000 })
    ];

    it('all / year / month / week / day / record', () => {
        expect(recordsInScope(records, { kind: 'all' }).length).toBe(4);
        expect(recordsInScope(records, { kind: 'year', year: 2026 }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
        expect(recordsInScope(records, { kind: 'month', year: 2026, month: 10 }).map((r) => r.id)).toEqual(['a', 'b']);
        // 2026-09-28 是周一，该周覆盖 09-28 ~ 10-04
        expect(recordsInScope(records, { kind: 'week', date: '2026-09-28' }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
        expect(recordsInScope(records, { kind: 'day', date: '2026-10-03' }).map((r) => r.id)).toEqual(['b']);
        expect(recordsInScope(records, { kind: 'record', id: 'd' }).map((r) => r.id)).toEqual(['d']);
    });

    it('scopeRange 覆盖整月/整年/整周', () => {
        expect(scopeRange({ kind: 'month', year: 2026, month: 2 })).toEqual({ start: '2026-02-01', end: '2026-02-28' });
        expect(scopeRange({ kind: 'year', year: 2026 })).toEqual({ start: '2026-01-01', end: '2026-12-31' });
        expect(scopeRange({ kind: 'week', date: '2026-10-11' })).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    });

    it('scopeKey / scopeLabel 生成稳定文案', () => {
        expect(scopeKey({ kind: 'month', year: 2026, month: 9 })).toBe('month:2026-09');
        expect(scopeLabel({ kind: 'year', year: 2026 })).toBe('2026 年');
        expect(scopeLabel({ kind: 'month', year: 2026, month: 9 })).toBe('2026 年 9 月');
        expect(scopeLabel({ kind: 'all' })).toBe('全部运动');
        expect(scopeLabel({ kind: 'record', id: 'b' }, records)).toContain('跑步');
    });

    it('scopeAnchor 对空范围回退到范围起始日', () => {
        expect(scopeAnchor({ kind: 'month', year: 2026, month: 9 }, records)).toMatchObject({ year: 2026, month: 9 });
        expect(scopeAnchor({ kind: 'month', year: 2026, month: 11 }, records)).toMatchObject({ year: 2026, month: 11 });
    });

    it('defaultScope 取最近一条有轨迹的记录', () => {
        expect(defaultScope(records)).toEqual({ kind: 'record', id: 'a' });
        expect(defaultScope([])).toEqual({ kind: 'all' });
        // 全部无轨迹时退回最新记录所在月份
        const noRoute = [record({ id: 'x', date: '2026-10-02', hasRoute: false })];
        expect(defaultScope(noRoute)).toEqual({ kind: 'month', year: 2026, month: 10 });
    });
});

describe('totalsOf', () => {
    const records = [
        record({ id: 'a', date: '2026-10-01', distance: 10000, seconds: 3600, elevation: 100, sport: 'run', speed: 2.78 }),
        record({ id: 'b', date: '2026-10-01', distance: 0, seconds: 1487, elevation: 271, sport: 'stair' }),
        record({ id: 'c', date: '2026-10-03', distance: 5000, seconds: 1200, elevation: 20, sport: 'ride', speed: 4.17 })
    ];
    const totals = totalsOf(records);

    it('汇总距离/时长/爬升/出勤天数', () => {
        expect(totals.count).toBe(3);
        expect(totals.distance).toBe(15000);
        expect(totals.seconds).toBe(6287);
        expect(totals.elevation).toBe(391);
        expect(totals.activeDays).toBe(2);
    });

    it('按运动类型分项并保持固定顺序', () => {
        expect(totals.sports.map((item) => item.key)).toEqual(['run', 'ride', 'stair']);
        expect(totals.sports[0]).toMatchObject({ count: 1, distance: 10000 });
    });

    it('最远/最久/爬升最多记录', () => {
        expect(totals.longest?.id).toBe('a');
        expect(totals.longestDuration?.id).toBe('a');
        expect(totals.mostElevation?.id).toBe('b');
    });

    it('最快配速只统计跑步/步行/徒步，不把骑行算进来', () => {
        expect(totals.bestPace?.record.id).toBe('a');
        expect(totals.bestPace?.pace).toBe(`6'00"/km`);
    });

    it('没有徒步类记录时 bestPace 为 null', () => {
        const rideOnly = totalsOf([record({ id: 'r', date: '2026-10-01', sport: 'ride', distance: 20000, seconds: 2400 })]);
        expect(rideOnly.bestPace).toBeNull();
    });

    it('最忙的一天', () => {
        expect(totals.busiestDay).toMatchObject({ date: '2026-10-01', count: 2, distance: 10000 });
    });

    it('空集合不产生 NaN', () => {
        const empty = totalsOf([]);
        expect(empty.count).toBe(0);
        expect(empty.distance).toBe(0);
        expect(empty.bestPace).toBeNull();
        expect(empty.sports).toEqual([]);
    });
});

describe('分组与日历', () => {
    const records = [
        record({ id: 'a', date: '2026-10-01', distance: 10000 }),
        record({ id: 'b', date: '2026-10-03', distance: 5000 }),
        record({ id: 'c', date: '2026-09-28', distance: 2000 }),
        record({ id: 'd', date: '2025-12-31', distance: 7000 })
    ];

    it('groupByMonth 按月倒序', () => {
        const groups = groupByMonth(records);
        expect(groups.map((group) => group.key)).toEqual(['2026-10', '2026-09', '2025-12']);
        expect(groups[0].label).toBe('2026 年 10 月');
        expect(groups[0].records.length).toBe(2);
        expect(groups[0].totals.distance).toBe(15000);
    });

    it('monthGrid 周一起始并标记月份归属', () => {
        const grid = monthGrid(2026, 10, records);
        expect(grid.length).toBeGreaterThanOrEqual(5);
        expect(grid.every((week) => week.length === 7)).toBe(true);
        // 2026-10-01 是周四，第 0 行第 3 列
        expect(grid[0][3].date).toBe('2026-10-01');
        expect(grid[0][3].count).toBe(1);
        expect(grid[0][3].distance).toBe(10000);
        expect(grid[0][0].inMonth).toBe(false);
        expect(grid[0][3].inMonth).toBe(true);
        // 汇总到 10-03
        const cell = grid.flat().find((item) => item.date === '2026-10-03');
        expect(cell?.count).toBe(1);
    });

    it('monthBuckets 生成 12 个月', () => {
        const buckets = monthBuckets(records, 2026);
        expect(buckets.length).toBe(12);
        expect(buckets[9]).toMatchObject({ month: 10, count: 2, distance: 15000 });
        expect(buckets[8]).toMatchObject({ month: 9, count: 1, distance: 2000 });
        expect(buckets[0]).toMatchObject({ month: 1, count: 0 });
    });

    it('weekBuckets 覆盖整月并按周汇总', () => {
        const buckets = weekBuckets(records, 2026, 10);
        expect(buckets[0].start).toBe('2026-09-28');
        expect(buckets[0].count).toBe(3);
        expect(buckets[0].distance).toBe(17000);
        expect(buckets[1].start).toBe('2026-10-05');
    });
});
