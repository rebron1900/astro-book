import { describe, expect, it } from 'vitest';
import { allContent, isPublishableNeodbMark, publicMemos, timeline, timelineVisible } from '../../src/api/store';
import { isPublishableMemo } from '../../src/lib/privacy';
import memosJson from '../../src/data/memos.json';
import neodbJson from '../../src/data/neodb.json';

/**
 * M1 消费者侧双保险：store 只暴露可发布的 memos。
 * 搜索（search-data.json）与 RSS 都从 store 的 postsAll 生成，时间线/首页/now 从 memos 来；
 * 所以只要这里拿不到非公开记录，这些产物就不可能带上它们。
 */
describe('store 只暴露公开 Memos', () => {
    it('publicMemos 里每一条都是 PUBLIC（默认白名单）', () => {
        expect(publicMemos.length).toBeGreaterThan(0);
        for (const memo of publicMemos) {
            expect(isPublishableMemo(memo)).toBe(true);
            expect(String(memo.visibility).toUpperCase()).toBe('PUBLIC');
        }
    });

    it('publicMemos 与 data 文件按同一规则过滤后一致', () => {
        const expected = (memosJson as Array<{ visibility?: string }>).filter((memo) => isPublishableMemo(memo));
        expect(publicMemos.map((memo) => memo.id)).toEqual(expected.map((memo) => (memo as { id: string }).id));
    });

    it('时间线（含隐藏 neodb 前的全量）里的 memo 全部可发布', () => {
        const memoEntries = [...timeline, ...timelineVisible].filter((entry) => entry.kind === 'memo');
        expect(memoEntries.length).toBeGreaterThan(0);
        for (const entry of memoEntries) {
            expect(isPublishableMemo(entry.data)).toBe(true);
        }
    });

    it('allContent 里的 memo 全部可发布', () => {
        const memos = allContent.filter((item) => 'createdTs' in item);
        expect(memos.length).toBeGreaterThan(0);
        for (const memo of memos) {
            expect(isPublishableMemo(memo as { visibility?: string })).toBe(true);
        }
    });
});

/**
 * NeoDB 标记是同一类「默认放行」隐患：原实现 `Number(m.visibility ?? 0) === 0`
 * 把缺字段当成 0（=public）。这里固定住「缺字段/非法值一律不发布」。
 */
describe('store 只展示明确公开的 NeoDB 标记', () => {
    it('缺字段、null、空串、非数字一律不发布', () => {
        for (const mark of [{}, { visibility: undefined }, { visibility: null }, { visibility: '' }, { visibility: '   ' }, { visibility: 'PUBLIC' }, { visibility: {} }, { visibility: [] }]) {
            expect(isPublishableNeodbMark(mark)).toBe(false);
        }
        expect(isPublishableNeodbMark(null)).toBe(false);
        expect(isPublishableNeodbMark(undefined)).toBe(false);
    });

    it('只有明确 0（public）发布；1=unlisted、2=private 均不发布', () => {
        expect(isPublishableNeodbMark({ visibility: 0 })).toBe(true);
        expect(isPublishableNeodbMark({ visibility: '0' })).toBe(true);
        expect(isPublishableNeodbMark({ visibility: 1 })).toBe(false);
        expect(isPublishableNeodbMark({ visibility: 2 })).toBe(false);
        expect(isPublishableNeodbMark({ visibility: '2' })).toBe(false);
    });

    it('时间线与 /douban 消费的 neodb 条目全部显式公开，且与数据文件的显式 0 条数一致', () => {
        const marks = timeline.filter((entry) => entry.kind === 'neodb');
        const expected = (neodbJson as unknown as { data: Array<{ visibility?: unknown }> }).data.filter(
            (mark) => mark.visibility === 0 || mark.visibility === '0'
        ).length;
        expect(marks.length).toBeGreaterThan(0);
        expect(marks).toHaveLength(expected);
        for (const entry of marks) {
            expect(isPublishableNeodbMark(entry.data)).toBe(true);
            expect(String((entry.data as { visibility?: unknown }).visibility)).toBe('0');
        }
    });
});
