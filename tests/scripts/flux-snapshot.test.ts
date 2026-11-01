import { describe, it, expect } from 'vitest';
import { buildFluxSnapshot, PARSING_ERROR_LIMIT } from '../../src/lib/flux-snapshot';
import type { FluxEntry, FluxLostFeed } from '../../src/api/types';

const NOW = '2026-10-29T08:00:00.000Z';

function feed(id: number, overrides: Record<string, unknown> = {}) {
    return {
        id,
        title: `Feed ${id}`,
        site_url: `https://example${id}.com/path`,
        feed_url: `https://example${id}.com/feed.xml`,
        parsing_error_count: 0,
        parsing_error_message: '',
        disabled: false,
        ...overrides
    };
}

function entry(feedId: number, publishedAt: string) {
    return {
        feedId,
        entry: {
            title: `Post ${feedId}`,
            url: `https://example${feedId}.com/post`,
            published_at: publishedAt,
            created_at: publishedAt
        }
    };
}

describe('buildFluxSnapshot', () => {
    it('正常订阅生成 entries，并规范化 site_url / 剔除多余字段', () => {
        const snapshot = buildFluxSnapshot({
            feeds: [feed(1), feed(2)],
            latestResults: [entry(1, '2026-10-28T00:00:00Z'), entry(2, '2026-10-29T00:00:00Z')],
            now: NOW
        });

        expect(snapshot.lost).toEqual([]);
        expect(snapshot.entries).toHaveLength(2);
        // 按更新时间倒序
        expect(snapshot.entries.map((e) => e.feed_id)).toEqual([2, 1]);
        expect(snapshot.entries[0].feed).toEqual({ id: 2, site_url: 'https://example2.com', title: 'Feed 2' });
        expect(snapshot.entries[0].update_timestamp).toBe(new Date('2026-10-29T00:00:00Z').getTime());
    });

    it('接口成功但没有文章 → 归入失联，并记录缓存中的最后文章时间', () => {
        const previousEntries: FluxEntry[] = [
            {
                feed_id: 1,
                feed: { id: 1, site_url: 'https://example1.com', title: 'Feed 1' },
                update_timestamp: 1,
                title: 'Old post',
                published_at: '2024-01-02T00:00:00Z'
            }
        ];

        const snapshot = buildFluxSnapshot({
            feeds: [feed(1)],
            latestResults: [{ feedId: 1, entry: null }],
            previousEntries,
            now: NOW
        });

        expect(snapshot.entries).toEqual([]);
        expect(snapshot.lost).toEqual([
            expect.objectContaining({
                id: 1,
                title: 'Feed 1',
                site_url: 'https://example1.com',
                reason: 'empty',
                last_entry_at: '2024-01-02T00:00:00.000Z',
                first_seen_at: NOW
            })
        ]);
    });

    it('达到 Miniflux 解析错误上限 → 标记抓取失败，并保留错误信息', () => {
        const snapshot = buildFluxSnapshot({
            feeds: [
                feed(1, {
                    parsing_error_count: PARSING_ERROR_LIMIT,
                    parsing_error_message: '由于网络错误，Miniflux 无法访问此网站'
                })
            ],
            latestResults: [entry(1, '2026-10-01T00:00:00Z')],
            now: NOW
        });

        expect(snapshot.entries).toEqual([]);
        expect(snapshot.lost[0]).toMatchObject({
            id: 1,
            reason: 'error',
            error: '由于网络错误，Miniflux 无法访问此网站',
            last_entry_at: '2026-10-01T00:00:00.000Z'
        });
    });

    it('有解析错误但未达到上限且没有文章 → 也标记抓取失败', () => {
        const snapshot = buildFluxSnapshot({
            feeds: [feed(1, { parsing_error_count: 1, parsing_error_message: '临时解析错误' })],
            latestResults: [{ feedId: 1, entry: null }],
            now: NOW
        });

        expect(snapshot.lost[0]).toMatchObject({ id: 1, reason: 'error', error: '临时解析错误' });
    });

    it('disabled 订阅 → 标记已停用', () => {
        const snapshot = buildFluxSnapshot({
            feeds: [feed(1, { disabled: true, parsing_error_message: 'stopped' })],
            latestResults: [{ feedId: 1, entry: null }],
            now: NOW
        });

        expect(snapshot.lost[0]).toMatchObject({ id: 1, reason: 'disabled', error: 'stopped' });
    });

    it('单条 entries 请求失败且有旧文章 → 沿用缓存，不误判失联', () => {
        const previousEntries: FluxEntry[] = [
            {
                feed_id: 1,
                feed: { id: 1, site_url: 'https://example1.com', title: 'Feed 1' },
                update_timestamp: 123
            }
        ];
        const snapshot = buildFluxSnapshot({
            feeds: [feed(1)],
            latestResults: [{ feedId: 1, entry: null, error: 'HTTP 500' }],
            previousEntries,
            now: NOW
        });

        expect(snapshot.lost).toEqual([]);
        expect(snapshot.entries).toEqual(previousEntries);
    });

    it('单条 entries 请求失败且无缓存 → 标记抓取失败', () => {
        const snapshot = buildFluxSnapshot({
            feeds: [feed(1)],
            latestResults: [{ feedId: 1, entry: null, error: 'HTTP 500' }],
            now: NOW
        });

        expect(snapshot.entries).toEqual([]);
        expect(snapshot.lost[0]).toMatchObject({ id: 1, reason: 'error', error: 'HTTP 500' });
    });

    it('再次同步时继承 first_seen_at；订阅恢复后从失联列表移除', () => {
        const previousLost: FluxLostFeed[] = [
            {
                id: 1,
                title: 'Feed 1',
                site_url: 'https://example1.com',
                reason: 'empty',
                first_seen_at: '2026-09-01T00:00:00.000Z'
            }
        ];

        const stillLost = buildFluxSnapshot({
            feeds: [feed(1)],
            latestResults: [{ feedId: 1, entry: null }],
            previousLost,
            now: NOW
        });
        expect(stillLost.lost[0].first_seen_at).toBe('2026-09-01T00:00:00.000Z');

        const recovered = buildFluxSnapshot({
            feeds: [feed(1)],
            latestResults: [entry(1, '2026-10-29T00:00:00Z')],
            previousLost,
            now: NOW
        });
        expect(recovered.lost).toEqual([]);
        expect(recovered.entries).toHaveLength(1);
    });

    it('忽略重复/无效订阅，并按中文标题排序失联列表', () => {
        const snapshot = buildFluxSnapshot({
            feeds: [feed(1, { title: '乙' }), feed(1, { title: '重复' }), null as never, feed(2, { title: '甲' })],
            latestResults: [],
            now: NOW
        });

        expect(snapshot.lost.map((f) => f.id)).toEqual([2, 1]);
    });
});
