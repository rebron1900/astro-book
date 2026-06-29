import { describe, it, expect, vi, afterEach } from 'vitest';
import { okResponse, resetFetch } from '../helpers/mock-fetch';

const mockMemoRaw = {
    content: '测试微博客内容',
    createdTs: 1_700_000_000,
    updatedTs: 1_700_000_001,
    creatorName: '1900',
    resourceList: [
        { type: 'image', filename: 'test.jpg', externalLink: 'https://cdn.test.com/test.jpg' }
    ]
};

describe('getMemos', () => {
    afterEach(() => {
        resetFetch();
    });

    it('returns memos with type "memo" on success', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse([mockMemoRaw]))));
        const { getMemos } = await import('../../src/api/memos');
        const result = await getMemos();

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('memo');
        expect(result[0].content).toBe('测试微博客内容');
        expect(result[0].createdTs).toBe(1_700_000_000);
    });

    it('preserves original memo fields', async () => {
        const dataWithExtra = { ...mockMemoRaw, extraField: 'preserved' };
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse([dataWithExtra]))));
        const { getMemos } = await import('../../src/api/memos');
        const result = await getMemos();

        expect(result[0]).toHaveProperty('extraField', 'preserved');
    });

    it('handles empty list', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse([]))));
        const { getMemos } = await import('../../src/api/memos');
        const result = await getMemos();

        expect(result).toEqual([]);
    });

    it('propagates network failure', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network error'))));
        const { getMemos } = await import('../../src/api/memos');

        await expect(getMemos()).rejects.toThrow('Network error');
    });

    it('propagates invalid JSON response', async () => {
        vi.stubGlobal('fetch', vi.fn(() =>
            Promise.resolve(new Response('not json at all', { status: 200 }))
        ));
        const { getMemos } = await import('../../src/api/memos');

        await expect(getMemos()).rejects.toThrow();
    });
});
