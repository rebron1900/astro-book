import { describe, expect, it } from 'vitest';
import { allContent, publicMemos, timeline, timelineVisible } from '../../src/api/store';
import { isPublishableMemo } from '../../src/lib/privacy';
import memosJson from '../../src/data/memos.json';

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
