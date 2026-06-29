import { describe, it, expect, vi, afterEach } from 'vitest';
import { okResponse, errorResponse, resetFetch } from '../helpers/mock-fetch';

const mockMark = {
    shelf: 'done',
    visibility: 'public',
    title: '测试电影',
    comment_text: '好看！',
    rating_grade: 8,
    type: 'movie',
    item: {
        uuid: 'test-uuid',
        url: 'https://neodb.social/movie/test',
        api_url: 'https://neodb.social/api/movie/test',
        category: 'movie',
        parent_uuid: null,
        display_title: '测试电影',
        external_resources: [{ url: 'https://douban.com/subject/123' }]
    },
    created_time: '2024-03-15T10:00:00Z'
};

describe('getNeodb', () => {
    afterEach(() => {
        resetFetch();
    });

    it('returns NeoDBResponse data on success', async () => {
        const mockResponse = { data: [mockMark] };
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse(mockResponse))));

        const { getNeodb } = await import('../../src/api/neodb');
        const result = await getNeodb();

        expect(result).toHaveProperty('data');
        expect(result.data).toHaveLength(1);
        expect(result.data[0].title).toBe('测试电影');
        expect(result.data[0].type).toBe('movie');
    });

    it('throws on non-OK status', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(errorResponse(404, 'Not Found'))));

        const { getNeodb } = await import('../../src/api/neodb');
        await expect(getNeodb()).rejects.toThrow('NeoDB 404 Not Found');
    });

    it('throws on 500 error', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(errorResponse(500, 'Server Error'))));

        const { getNeodb } = await import('../../src/api/neodb');
        await expect(getNeodb()).rejects.toThrow('NeoDB 500 Server Error');
    });

    it('handles empty data array', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse({ data: [] }))));

        const { getNeodb } = await import('../../src/api/neodb');
        const result = await getNeodb();

        expect(result.data).toEqual([]);
    });

    it('propagates network failure', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network error'))));

        const { getNeodb } = await import('../../src/api/neodb');
        await expect(getNeodb()).rejects.toThrow('Network error');
    });
});
