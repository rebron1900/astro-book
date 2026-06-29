import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { okResponse, errorResponse, resetFetch, mockFetchWithMap } from '../helpers/mock-fetch';

const mockFeed = {
    id: 'feed-1',
    site_url: 'https://blog.example.com',
    title: 'Example Blog'
};

const mockEntry = {
    id: 'entry-1',
    title: '测试文章',
    url: 'https://blog.example.com/post/1',
    content: '<p>测试内容</p>',
    published_at: '2024-03-15T10:00:00Z'
};

describe('getFlux', () => {
    afterEach(() => {
        resetFetch();
    });

    it('returns FluxEntry[] sorted by date descending', async () => {
        // Mock feeds response
        const feedsUrl = new URL('/categories/4/feeds', 'https://flux.test.com').toString();

        // Mock entry response
        const entryUrl = new URL('/feeds/feed-1/entries?limit=1&order=published_at&direction=desc', 'https://flux.test.com').toString();

        mockFetchWithMap({
            [feedsUrl]: () =>
                okResponse({
                    feeds: [mockFeed]
                }),
            [entryUrl]: () =>
                okResponse({
                    entries: [mockEntry]
                })
        });

        const { getFlux } = await import('../../src/api/flux');
        const result = await getFlux();

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('测试文章');
        expect(result[0].feed_id).toBe('feed-1');
        expect(result[0].feed.site_url).toBe('https://blog.example.com');
        expect(result[0]).toHaveProperty('update_timestamp');
    });

    it('sorts multiple feeds by update_timestamp descending', async () => {
        const mockFeeds = [
            { id: 'feed-1', site_url: 'https://blog1.example.com', title: 'Blog 1' },
            { id: 'feed-2', site_url: 'https://blog2.example.com', title: 'Blog 2' }
        ];

        const feedsUrl = new URL('/categories/4/feeds', 'https://flux.test.com').toString();
        const entryUrl1 = new URL('/feeds/feed-1/entries?limit=1&order=published_at&direction=desc', 'https://flux.test.com').toString();
        const entryUrl2 = new URL('/feeds/feed-2/entries?limit=1&order=published_at&direction=desc', 'https://flux.test.com').toString();

        mockFetchWithMap({
            [feedsUrl]: () => okResponse({ feeds: mockFeeds }),
            [entryUrl1]: () =>
                okResponse({
                    entries: [{ ...mockEntry, id: 'entry-1', published_at: '2024-01-01T00:00:00Z' }]
                }),
            [entryUrl2]: () =>
                okResponse({
                    entries: [{ ...mockEntry, id: 'entry-2', published_at: '2024-06-01T00:00:00Z' }]
                })
        });

        const { getFlux } = await import('../../src/api/flux');
        const result = await getFlux();

        expect(result).toHaveLength(2);
        // Newer entry first (feed-2 has June post)
        expect(result[0].feed_id).toBe('feed-2');
        expect(result[1].feed_id).toBe('feed-1');
    });

    it('filters out feeds without entries', async () => {
        const mockFeeds = [
            { id: 'feed-1', site_url: 'https://blog1.example.com', title: 'Blog 1' },
            { id: 'feed-empty', site_url: 'https://empty.com', title: 'Empty' }
        ];

        const feedsUrl = new URL('/categories/4/feeds', 'https://flux.test.com').toString();
        const entryUrl1 = new URL('/feeds/feed-1/entries?limit=1&order=published_at&direction=desc', 'https://flux.test.com').toString();
        const entryUrlEmpty = new URL('/feeds/feed-empty/entries?limit=1&order=published_at&direction=desc', 'https://flux.test.com').toString();

        mockFetchWithMap({
            [feedsUrl]: () => okResponse({ feeds: mockFeeds }),
            [entryUrl1]: () =>
                okResponse({ entries: [mockEntry] }),
            [entryUrlEmpty]: () =>
                okResponse({ entries: [] })
        });

        const { getFlux } = await import('../../src/api/flux');
        const result = await getFlux();

        // feed-empty has no entries → filtered out
        expect(result).toHaveLength(1);
        expect(result[0].feed_id).toBe('feed-1');
    });

    it('returns empty array when feeds fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network error'))));

        const { getFlux } = await import('../../src/api/flux');
        const result = await getFlux();

        // Error is caught internally, returns empty array
        expect(result).toEqual([]);
    });

    it('returns empty array when feeds list is empty', async () => {
        const feedsUrl = new URL('/categories/4/feeds', 'https://flux.test.com').toString();
        mockFetchWithMap({
            [feedsUrl]: () => okResponse({ feeds: [] })
        });

        const { getFlux } = await import('../../src/api/flux');
        const result = await getFlux();

        expect(result).toEqual([]);
    });
});
