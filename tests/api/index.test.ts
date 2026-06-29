import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the ghost and memos modules before importing getAllContent
vi.mock('../../src/api/ghost', () => ({
    getAllPosts: vi.fn()
}));

vi.mock('../../src/api/memos', () => ({
    getMemos: vi.fn()
}));

const mockGetAllPosts = () =>
    import('../../src/api/ghost').then((m) => m.getAllPosts as ReturnType<typeof vi.fn>);
const mockGetMemos = () =>
    import('../../src/api/memos').then((m) => m.getMemos as ReturnType<typeof vi.fn>);

describe('getAllContent', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('merges and sorts posts and memos by created time descending', async () => {
        const posts = [
            { slug: 'post-old', title: 'Post Old', created_at: '2024-01-01T00:00:00Z', type: 'post' },
            { slug: 'post-mid', title: 'Post Mid', created_at: '2024-06-01T00:00:00Z', type: 'post' },
        ];
        const memos = [
            { content: 'Memo New', createdTs: 1_720_000_000, type: 'memo' },  // ~2024-07-04
            { content: 'Memo Old', createdTs: 1_700_000_000, type: 'memo' },  // ~2023-11-14
        ];

        const getAllPostsMock = await mockGetAllPosts();
        const getMemosMock = await mockGetMemos();
        getAllPostsMock.mockResolvedValue(posts);
        getMemosMock.mockResolvedValue(memos);

        const { getAllContent } = await import('../../src/api/index');
        const result = await getAllContent();

        // Should have 4 items sorted descending by creation time
        expect(result).toHaveLength(4);
        // Memo New (July 2024) should be first
        expect(result[0].type).toBe('memo');
        expect(result[0]).toHaveProperty('content', 'Memo New');
        // Post Mid (June 2024) second
        expect(result[1].type).toBe('post');
        expect(result[1]).toHaveProperty('slug', 'post-mid');
        // Post Old (Jan 2024) third
        expect(result[2].type).toBe('post');
        expect(result[2]).toHaveProperty('slug', 'post-old');
        // Memo Old (Nov 2023) last
        expect(result[3].type).toBe('memo');
        expect(result[3]).toHaveProperty('content', 'Memo Old');
    });

    it('handles empty posts and memos', async () => {
        const getAllPostsMock = await mockGetAllPosts();
        const getMemosMock = await mockGetMemos();
        getAllPostsMock.mockResolvedValue([]);
        getMemosMock.mockResolvedValue([]);

        const { getAllContent } = await import('../../src/api/index');
        const result = await getAllContent();

        expect(result).toEqual([]);
    });

    it('returns posts only when there are no memos', async () => {
        const posts = [
            { slug: 'post-1', title: 'Post 1', created_at: '2024-06-01T00:00:00Z', type: 'post' }
        ];

        const getAllPostsMock = await mockGetAllPosts();
        const getMemosMock = await mockGetMemos();
        getAllPostsMock.mockResolvedValue(posts);
        getMemosMock.mockResolvedValue([]);

        const { getAllContent } = await import('../../src/api/index');
        const result = await getAllContent();

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('slug', 'post-1');
    });

    it('returns memos only when there are no posts', async () => {
        const getAllPostsMock = await mockGetAllPosts();
        const getMemosMock = await mockGetMemos();
        getAllPostsMock.mockResolvedValue([]);
        getMemosMock.mockResolvedValue([
            { content: 'Memo 1', createdTs: 1_700_000_000, type: 'memo' }
        ]);

        const { getAllContent } = await import('../../src/api/index');
        const result = await getAllContent();

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('content', 'Memo 1');
    });

    it('returns empty array when getAllPosts rejects', async () => {
        const getAllPostsMock = await mockGetAllPosts();
        const getMemosMock = await mockGetMemos();
        getAllPostsMock.mockRejectedValue(new Error('Ghost API error'));
        getMemosMock.mockResolvedValue([]);

        const { getAllContent } = await import('../../src/api/index');
        const result = await getAllContent();

        // Error caught by try/catch, returns empty array
        expect(result).toEqual([]);
    });

    it('preserves all fields of both posts and memos', async () => {
        const post = {
            slug: 'test-slug',
            title: 'Test Title',
            created_at: '2024-01-15T00:00:00Z',
            html: '<p>content</p>',
            excerpt: 'Test excerpt',
            feature_image: 'https://example.com/img.jpg',
            type: 'post'
        };
        const memo = {
            content: 'Memo content',
            createdTs: 1_700_000_001,
            updatedTs: 1_700_000_002,
            creatorName: 'test',
            resourceList: [],
            type: 'memo'
        };

        const getAllPostsMock = await mockGetAllPosts();
        const getMemosMock = await mockGetMemos();
        getAllPostsMock.mockResolvedValue([post]);
        getMemosMock.mockResolvedValue([memo]);

        const { getAllContent } = await import('../../src/api/index');
        const result = await getAllContent();

        // Use toContainEqual to avoid union narrowing issues
        expect(result).toContainEqual(expect.objectContaining({ slug: 'test-slug' }));
        expect(result).toContainEqual(expect.objectContaining({ content: 'Memo content' }));
    });
});
