import { describe, it, expect } from 'vitest';
import {
    averageParts,
    barHeights,
    dayLevel,
    distanceParts,
    dominantSportColors,
    elevationParts,
    formatElevation,
    groupDigits,
    hoursParts,
    shiftMonth,
    spanLabel,
    sportSlices
} from '../../src/lib/exercise-stats';
import type { ExerciseRecord, SportTotal } from '../../src/lib/exercise';

function record(partial: Partial<ExerciseRecord> & { id: string; date: string }): ExerciseRecord {
    const [year, month] = partial.date.split('-').map(Number);
    return {
        id: partial.id,
        name: partial.name ?? 'Morning Run',
        date: partial.date,
        time: '07:00',
        month: `${year}-${String(month).padStart(2, '0')}`,
        year,
        type: partial.type ?? 'Run',
        sport: partial.sport ?? 'run',
        distance: partial.distance ?? 5000,
        seconds: partial.seconds ?? 1800,
        elevation: partial.elevation ?? 40,
        speed: null,
        hr: null,
        location: '',
        hasRoute: partial.hasRoute ?? true
    };
}

describe('数值拆分与格式化', () => {
    it('groupDigits 千分位', () => {
        expect(groupDigits(22992)).toBe('22,992');
        expect(groupDigits(0)).toBe('0');
        expect(groupDigits(999)).toBe('999');
    });

    it('formatElevation 带单位，0 显示占位', () => {
        expect(formatElevation(4303)).toBe('4,303 m');
        expect(formatElevation(0)).toBe('—');
    });

    it('distanceParts 距离与单位分开，零距离显示占位', () => {
        expect(distanceParts(121640)).toEqual({ value: '121.64', unit: 'km' });
        expect(distanceParts(413)).toEqual({ value: '413', unit: 'm' });
        expect(distanceParts(0)?.value).toBe('—');
    });

    it('elevationParts / hoursParts / averageParts', () => {
        expect(elevationParts(4303)).toEqual({ value: '4,303', unit: 'm' });
        expect(hoursParts(3600 * 72 + 1800)).toEqual({ value: '73', unit: 'h' });
        expect(hoursParts(3600 * 1.5)).toEqual({ value: '1.5', unit: 'h' });
        expect(averageParts(15000, 3)).toEqual({ value: '5.00', unit: 'km' });
        expect(averageParts(0, 0).value).toBe('—');
    });
});

describe('shiftMonth', () => {
    it('跨年正确', () => {
        expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
        expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
        expect(shiftMonth(2026, 10, 0)).toEqual({ year: 2026, month: 10 });
    });
});

describe('dayLevel', () => {
    it('按相对当月最远距离分三档', () => {
        expect(dayLevel(0, 0, 20000)).toBe(0);
        expect(dayLevel(1, 12000, 20000)).toBe(3);
        expect(dayLevel(1, 6000, 20000)).toBe(2);
        expect(dayLevel(1, 1000, 20000)).toBe(1);
    });

    it('没有距离时退回按次数分档', () => {
        expect(dayLevel(1, 0, 0)).toBe(1);
        expect(dayLevel(2, 0, 0)).toBe(2);
        expect(dayLevel(3, 0, 0)).toBe(3);
    });
});

describe('sportSlices', () => {
    const sports: SportTotal[] = [
        { key: 'ride', label: '骑行', color: '#2563eb', count: 8, distance: 397180, seconds: 10800, elevation: 1000 },
        { key: 'run', label: '跑步', color: '#16a34a', count: 29, distance: 108750, seconds: 21600, elevation: 500 },
        { key: 'stair', label: '爬楼', color: '#d97706', count: 11, distance: 0, seconds: 7200, elevation: 3000 }
    ];

    it('按距离降序并给出 0..1 占比与整数百分比', () => {
        const slices = sportSlices(sports);
        expect(slices.map((item) => item.key)).toEqual(['ride', 'run', 'stair']);
        expect(slices[0].percent).toBeGreaterThan(slices[1].percent);
        expect(slices.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1, 5);
        expect(slices.reduce((sum, item) => sum + item.percent, 0)).toBe(100);
    });

    it('零距离运动占比为 0，不产生 NaN', () => {
        const stair = sportSlices(sports).find((item) => item.key === 'stair');
        expect(stair?.share).toBe(0);
        expect(stair?.percent).toBe(0);
    });

    it('整组都没有距离时退回按次数算占比', () => {
        const slices = sportSlices([
            { key: 'stair', label: '爬楼', color: '#d97706', count: 3, distance: 0, seconds: 100, elevation: 10 },
            { key: 'climb', label: '攀岩', color: '#7c3aed', count: 1, distance: 0, seconds: 100, elevation: 10 }
        ]);
        expect(slices[0].key).toBe('stair');
        expect(slices[0].percent).toBe(75);
    });
});

describe('barHeights', () => {
    it('按最大值归一化，并保留最小高度', () => {
        const items = [{ d: 100, c: 1 }, { d: 50, c: 1 }, { d: 0, c: 0 }];
        const heights = barHeights(items, (item) => item.d, (item) => item.c, 4);
        expect(heights[0]).toBe(100);
        expect(heights[1]).toBe(50);
        expect(heights[2]).toBe(0);
    });

    it('有记录但距离为 0 时给最小高度', () => {
        const items = [{ d: 0, c: 2 }, { d: 5000, c: 1 }];
        const heights = barHeights(items, (item) => item.d, (item) => item.c, 5);
        expect(heights[0]).toBe(5);
        expect(heights[1]).toBeGreaterThan(0);
    });

    it('全为 0 时不产生 NaN', () => {
        const heights = barHeights([{ d: 0, c: 0 }], (item) => item.d, (item) => item.c);
        expect(heights[0]).toBe(0);
    });
});

describe('dominantSportColors', () => {
    it('同一天多条记录取距离最大的运动颜色', () => {
        const colors = dominantSportColors([
            record({ id: 'a', date: '2026-10-01', sport: 'stair', distance: 0 }),
            record({ id: 'b', date: '2026-10-01', sport: 'ride', distance: 20000 })
        ]);
        expect(colors.get('2026-10-01')).toBe('#2563eb');
    });

    it('零距离时退回次数最多的运动', () => {
        const colors = dominantSportColors([
            record({ id: 'a', date: '2026-10-02', sport: 'stair', distance: 0 }),
            record({ id: 'b', date: '2026-10-02', sport: 'stair', distance: 0 })
        ]);
        expect(colors.get('2026-10-02')).toBe('#d97706');
    });
});

describe('spanLabel', () => {
    it('输出首末月份', () => {
        expect(spanLabel([record({ id: 'a', date: '2024-03-12' }), record({ id: 'b', date: '2026-10-11' })])).toBe('2024.03 — 2026.10');
    });

    it('空集合返回占位', () => {
        expect(spanLabel([])).toBe('暂无记录');
    });
});
