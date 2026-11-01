import { describe, it, expect } from 'vitest';
import { allContent, postsAll, timeline } from '../../src/api/store';
import memosAll from '../../src/data/memos.json';
import neodbData from '../../src/data/neodb.json';
import stravaData from '../../src/data/strava.json';
import type { TimelineEntry } from '../../src/api/store';

// store.ts 在模块顶层 import src/data/*.json（同步脚本产物），
// allContent 直接读取这些 JSON 合并 posts + memos 并按时间降序排序。
// 这里不 mock src 内部，直接用真实 JSON 验证排序规则与 memos 时间戳单位换算。

// 复刻 store.ts 的排序比较器，作为独立断言依据（避免与实现同源）。
function sortByTime(items: unknown[]): unknown[] {
    const time = (it: any) =>
        'createdTs' in it ? (it.createdTs as number) * 1000 : new Date((it as any).created_at).getTime();
    return [...items].sort((a, b) => time(b) - time(a));
}

describe('allContent (store.ts)', () => {
    it('merges every post and memo', () => {
        expect(allContent.length).toBeGreaterThan(0);
        expect(allContent.length).toBe(postsAll.length + memosAll.length);
    });

    it('is sorted by time descending (posts via created_at, memos via createdTs*1000)', () => {
        // 与独立排序结果一致
        expect(allContent.map((x: any) => x.id ?? x.slug)).toEqual(
            sortByTime(allContent).map((x: any) => x.id ?? x.slug)
        );

        // 相邻元素严格不增
        for (let i = 1; i < allContent.length; i++) {
            const prev = allContent[i - 1] as any;
            const cur = allContent[i] as any;
            const prevTime = 'createdTs' in prev ? prev.createdTs * 1000 : new Date(prev.created_at).getTime();
            const curTime = 'createdTs' in cur ? cur.createdTs * 1000 : new Date(cur.created_at).getTime();
            expect(prevTime).toBeGreaterThanOrEqual(curTime);
        }
    });

    it('converts memos createdTs (seconds) to milliseconds consistently', () => {
        const memos = allContent.filter((x: any) => 'createdTs' in x) as any[];
        expect(memos.length).toBeGreaterThan(0);
        for (const m of memos) {
            // createdTs 是秒级时间戳；转毫秒后应落在合理历史区间
            const ms = m.createdTs * 1000;
            expect(Number.isFinite(ms)).toBe(true);
            expect(new Date(ms).getFullYear()).toBeGreaterThan(2000);
        }
    });
});

// timeline：首页信息流，聚合 posts/memos/neodb/strava 四源。
// 验证：四源都进来了、每条带 kind、按发生时间降序、各源取对了字段。
describe('timeline (store.ts)', () => {
    const publicNeodb = (neodbData as any).data.filter((m: any) => Number(m.visibility ?? 0) === 0);

    it('includes entries from all four sources', () => {
        const kinds = new Set(timeline.map((e) => e.kind));
        expect(kinds.has('post')).toBe(true);
        expect(kinds.has('memo')).toBe(true);
        expect(kinds.has('neodb')).toBe(true);
        expect(kinds.has('strava')).toBe(true);
    });

    it('counts match source data (only public neodb marks)', () => {
        const count = (k: TimelineEntry['kind']) => timeline.filter((e) => e.kind === k).length;
        expect(count('post')).toBe(postsAll.length);
        expect(count('memo')).toBe(memosAll.length);
        expect(count('neodb')).toBe(publicNeodb.length);
        expect(count('strava')).toBe(stravaData.length);
    });

    it('is sorted by time descending', () => {
        for (let i = 1; i < timeline.length; i++) {
            expect(timeline[i - 1].time).toBeGreaterThanOrEqual(timeline[i].time);
        }
    });

    it('strava entries parse start_date_local ("YYYY-MM-DD HH:MM:SS" local) into ms', () => {
        const strava = timeline.filter((e): e is Extract<TimelineEntry, { kind: 'strava' }> => e.kind === 'strava');
        expect(strava.length).toBeGreaterThan(0);
        // 与 store.ts 同样的解析口径独立复核
        const a = stravaData[0];
        const expected = new Date(a.start_date_local.replace(' ', 'T')).getTime();
        expect(strava.find((e) => e.data.run_id === a.run_id)?.time).toBe(expected);
    });
});
