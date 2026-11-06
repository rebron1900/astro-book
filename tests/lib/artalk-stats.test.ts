import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ARTALK_SERVER,
    ARTALK_SITE,
    artalkLikedKey,
    artalkPageKey,
    artalkPvSeenKey,
    fetchArtalkPageStats,
    hasCountedPv,
    hasLiked,
    markLiked,
    markPvCounted,
    voteArtalkPageUp
} from '../../src/lib/artalk-stats';
import { okResponse, resetFetch } from '../helpers/mock-fetch';

afterEach(() => {
    resetFetch();
});

describe('artalkPageKey', () => {
    it('normalizes pathname to a single trailing slash', () => {
        expect(artalkPageKey('/foo')).toBe('/foo/');
        expect(artalkPageKey('/foo/')).toBe('/foo/');
        expect(artalkPageKey('/')).toBe('/');
        expect(artalkPageKey('/foo/bar')).toBe('/foo/bar/');
    });
});

describe('Artalk storage keys', () => {
    it('includes the site name and page key', () => {
        expect(artalkLikedKey('/foo/')).toBe(`artalk_like:${ARTALK_SITE}:/foo/`);
        expect(artalkPvSeenKey('/foo/')).toBe(`artalk_pv:${ARTALK_SITE}:/foo/`);
    });
});

describe('localStorage helpers', () => {
    function stubStorage() {
        const store = new Map<string, string>();
        vi.stubGlobal('window', {
            localStorage: {
                getItem: (key: string) => store.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    store.set(key, value);
                }
            }
        });
    }

    it('remembers likes per page key', () => {
        stubStorage();

        expect(hasLiked('/foo/')).toBe(false);
        markLiked('/foo/');
        expect(hasLiked('/foo/')).toBe(true);
        expect(hasLiked('/bar/')).toBe(false);
    });

    it('remembers counted PV per page key', () => {
        stubStorage();

        expect(hasCountedPv('/foo/')).toBe(false);
        markPvCounted('/foo/');
        expect(hasCountedPv('/foo/')).toBe(true);
        expect(hasCountedPv('/bar/')).toBe(false);
    });

    it('degrades gracefully when storage is unavailable', () => {
        expect(hasLiked('/foo/')).toBe(false);
        expect(hasCountedPv('/foo/')).toBe(false);
        expect(() => markLiked('/foo/')).not.toThrow();
        expect(() => markPvCounted('/foo/')).not.toThrow();
    });
});

describe('fetchArtalkPageStats', () => {
    it('reads page id, pv and vote counts from the comments API', async () => {
        const fetchMock = vi.fn((url: string | URL | Request) => {
            expect(url.toString()).toBe(`${ARTALK_SERVER}/api/v2/comments?page_key=%2Ffoo%2F&site_name=1900%27Blog&limit=1`);
            return Promise.resolve(
                okResponse({
                    comments: [],
                    count: 0,
                    roots_count: 0,
                    page: { id: 42, pv: 123, vote_up: 7, vote_down: 1 }
                })
            );
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchArtalkPageStats('/foo/')).resolves.toEqual({ id: 42, pv: 123, voteUp: 7, voteDown: 1 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns zeros when the page is not registered yet', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(okResponse({ comments: [], count: 0, page: { id: 0, pv: 0, vote_up: 0 } })))
        );

        await expect(fetchArtalkPageStats('/new/')).resolves.toEqual({ id: 0, pv: 0, voteUp: 0, voteDown: 0 });
    });

    it('throws when the API responds with an error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response(null, { status: 500 })))
        );

        await expect(fetchArtalkPageStats('/foo/')).rejects.toThrow('Artalk comments API failed: 500');
    });
});

describe('voteArtalkPageUp', () => {
    it('posts to the page_up endpoint and returns the updated counts', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(okResponse({ up: 8, down: 1 })));
        vi.stubGlobal('fetch', fetchMock);

        await expect(voteArtalkPageUp(42)).resolves.toEqual({ up: 8, down: 1 });
        expect(fetchMock).toHaveBeenCalledWith(`${ARTALK_SERVER}/api/v2/votes/page_up/42`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: '{}'
        });
    });

    it('throws when voting fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response(null, { status: 404 })))
        );

        await expect(voteArtalkPageUp(42)).rejects.toThrow('Artalk vote API failed: 404');
    });
});
