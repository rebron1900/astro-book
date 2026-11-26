import { describe, expect, it } from 'vitest';
import {
    buildTimeline,
    compareTimelineEntries,
    countTimeline,
    dedupeTimeline,
    paginateTimeline,
    readingDayTime,
    timelineEntryId,
    timelineKey,
    timelineForKind
} from '../../src/lib/timeline';
import { cnDateKey } from '../../src/lib/utils/help';
import type { TimelineEntry } from '../../src/api/store';

/**
 * M3 时间线规范校验（docs/specs/2026-11-26-timeline-spec.md）：
 * 全序排序、source+id 去重、同日不跨页、北京时区分日、计数单一来源。
 */

const memo = (id: string, time: number): TimelineEntry => ({ kind: 'memo', time, data: { id, type: 'memo', content: id, createdTs: time / 1000, updatedTs: time / 1000, creatorName: 't', resourceList: [] } });
const post = (id: string, time: number): TimelineEntry => ({ kind: 'post', time, data: { id, slug: id, type: 'post' } as TimelineEntry extends { data: infer D } ? D : never } as TimelineEntry);
const media = (id: string, time: number, playedPercent = 50): TimelineEntry =>
    ({ kind: 'media', time, data: { id, type: 'episode', title: 't', played: false, playedPercent, lastPlayedAt: time } }) as TimelineEntry;
const reading = (date: string): TimelineEntry => ({ kind: 'reading', time: readingDayTime(date), data: { date } }) as TimelineEntry;

describe('稳定全序排序', () => {
    it('time 相同按 kind 固定序、再按 id 字典序，不依赖输入顺序', () => {
        const time = 1_700_000_000_000;
        const entries = [media('m2', time), memo('b', time), memo('a', time), post('z', time)];
        const sorted = buildTimeline(entries, { now: time });
        expect(sorted.map((entry) => `${entry.kind}:${timelineEntryId(entry)}`)).toEqual(['post:z', 'memo:a', 'memo:b', 'media:m2']);

        // 输入顺序打乱，输出必须一致
        const shuffled = buildTimeline([...entries].reverse(), { now: time });
        expect(shuffled.map(timelineKey)).toEqual(sorted.map(timelineKey));
    });

    it('比较器是全序：只有同一 key 才返回 0', () => {
        expect(compareTimelineEntries(memo('a', 10), memo('a', 10))).toBe(0);
        expect(compareTimelineEntries(memo('a', 10), memo('b', 10))).toBeLessThan(0);
        expect(compareTimelineEntries(memo('b', 10), memo('a', 10))).toBeGreaterThan(0);
        expect(compareTimelineEntries(memo('a', 11), memo('a', 10))).toBeLessThan(0);
    });

    it('未来超过 5 分钟丢弃，5 分钟内保留', () => {
        const now = 1_700_000_000_000;
        const entries = [memo('past', now - 1000), memo('near', now + 4 * 60 * 1000), memo('future', now + 6 * 60 * 1000)];
        expect(buildTimeline(entries, { now }).map((entry) => timelineEntryId(entry))).toEqual(['near', 'past']);
    });
});

describe('source + id 去重', () => {
    it('同一记录重复出现只保留一条', () => {
        const entries = [memo('a', 100), memo('a', 100), memo('b', 100)];
        expect(dedupeTimeline(entries)).toHaveLength(2);
        expect(dedupeTimeline(entries).map(timelineKey)).toEqual(['memos:a', 'memos:b']);
    });

    it('不同 kind 下同名 id 不算重复（键带来源）', () => {
        const entries = [memo('x', 100), post('x', 100)];
        expect(dedupeTimeline(entries)).toHaveLength(2);
    });

    it('影视重复：取较新观看时间、进度取较大值', () => {
        const entries = [media('m1', 100, 30), media('m1', 200, 70)];
        const [merged] = dedupeTimeline(entries);
        expect(merged.kind).toBe('media');
        if (merged.kind === 'media') {
            expect(merged.time).toBe(200);
            expect(merged.data.playedPercent).toBe(70);
        }
    });
});

describe('同日不跨页 + 北京时区分日', () => {
    const day = (date: string) => new Date(`${date}T10:00:00+08:00`).getTime();

    it('页内满 10 条但下一条仍是同一天时，继续留在本页', () => {
        const entries = Array.from({ length: 12 }, (_, i) => memo(`a${i}`, day('2026-11-20') - i));
        const pages = paginateTimeline(entries, 10);
        expect(pages).toHaveLength(1);
        expect(pages[0]).toHaveLength(12);
    });

    it('跨天才开新页，且同一天的多条记录不会被拆开', () => {
        const entries = [
            ...Array.from({ length: 10 }, (_, i) => memo(`a${i}`, day('2026-11-20') - i)),
            ...Array.from({ length: 3 }, (_, i) => memo(`b${i}`, day('2026-11-19') - i))
        ];
        const pages = paginateTimeline(entries, 10);
        expect(pages).toHaveLength(2);
        expect(pages[0]).toHaveLength(10);
        expect(pages[1]).toHaveLength(3);
        for (const page of pages) {
            const days = new Set(page.map((entry) => cnDateKey(entry.time)));
            expect(days.size).toBeLessThanOrEqual(1);
        }
    });

    it('北京时间 00:30 的记录归当天，不被算到前一天', () => {
        const time = new Date('2026-11-26T00:30:00+08:00').getTime();
        expect(cnDateKey(time)).toBe('2026-11-26');
        // UTC 下这一天还是 11-25 16:30，用本地时间会错位；这里必须按北京时区
        expect(new Date(time).toISOString().slice(0, 10)).toBe('2026-11-25');

        const entries = [memo('late-night', time), memo('same-day-morning', new Date('2026-11-26T09:00:00+08:00').getTime())];
        const pages = paginateTimeline(entries, 1);
        expect(pages).toHaveLength(1);
    });

    it('阅读日期型：北京时间当天 00:00 的 epoch，日键一致', () => {
        expect(readingDayTime('2026-11-26')).toBe(Date.UTC(2026, 10, 25, 16, 0, 0));
        expect(cnDateKey(readingDayTime('2026-11-26'))).toBe('2026-11-26');
    });
});

describe('栏目映射与计数口径', () => {
    const entries = [post('p', 3), memo('m', 2), reading('2026-11-20'), media('e', 1)];

    it('/timeline/reading/ = reading + media', () => {
        expect(timelineForKind(entries, 'reading').map((entry) => entry.kind)).toEqual(['reading', 'media']);
        expect(timelineForKind(entries, 'post').map((entry) => entry.kind)).toEqual(['post']);
    });

    it('计数 = 事件数，聚合栏目由两个 kind 相加', () => {
        const counts = countTimeline(entries);
        expect(counts).toMatchObject({ all: 4, post: 1, memo: 1, reading: 1, media: 1, readingAndMedia: 2 });
        // 与分页 total 同源：总条数就是事件数组长度
        expect(paginateTimeline(entries, 10)[0]).toHaveLength(counts.all);
    });
});
