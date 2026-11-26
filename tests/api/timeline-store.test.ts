import { describe, expect, it } from 'vitest';
import { timeline, timelineVisible } from '../../src/api/store';
import { compareTimelineEntries, countTimeline, paginateTimeline, readingDayTime, timelineKey } from '../../src/lib/timeline';
import { cnDateKey } from '../../src/lib/utils/help';
import readingData from '../../src/data/reading.json';

/** M3：store 产出的时间线必须满足全序、去重、日键口径（真实数据回归）。 */
describe('store 时间线规范（真实数据）', () => {
    it('按全序比较器严格递增：相邻条目 compare < 0', () => {
        for (let i = 1; i < timeline.length; i += 1) {
            expect(compareTimelineEntries(timeline[i - 1], timeline[i])).toBeLessThan(0);
        }
    });

    it('source + id 唯一（构造阶段已去重）', () => {
        const keys = timeline.map(timelineKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('阅读条目的排序时间 = 北京时间当天 00:00', () => {
        const readings = timeline.filter((entry) => entry.kind === 'reading');
        expect(readings.length).toBeGreaterThan(0);
        for (const entry of readings) {
            if (entry.kind !== 'reading') continue;
            expect(entry.time).toBe(readingDayTime(entry.data.date));
            expect(cnDateKey(entry.time)).toBe(entry.data.date);
        }
        const days = readingData.days.map((day) => readingDayTime(day.date));
        expect(readings.map((entry) => entry.time)).toEqual(days);
    });

    it('分页不丢条目、同日不跨页，总条数与页头计数同源', () => {
        const pages = paginateTimeline(timelineVisible, 10);
        expect(pages.flat()).toHaveLength(timelineVisible.length);
        expect(countTimeline(timelineVisible).all).toBe(timelineVisible.length);
        // 「同日不跨页」= 同一天的条目必须全在同一页；一页可以包含连续的两天（页内满 10 条后才换天）
        const pageOfDay = new Map<string, number>();
        pages.forEach((page, index) => {
            for (const entry of page) {
                const day = cnDateKey(entry.time);
                if (!pageOfDay.has(day)) pageOfDay.set(day, index);
                expect(pageOfDay.get(day)).toBe(index);
            }
        });
    });
});
