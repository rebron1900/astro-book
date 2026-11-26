import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';

/**
 * ghost 源迁移验收。
 *
 * golden 来源：迁移前实现（630519c 的 sync-data.mjs，走 @ts-ghost 客户端）在同一份冻结
 * Ghost Content API 响应上的产物 → tests/fixtures/ingest/ghost/expected.json。
 * 新模块换成 ctx.fetchJson（同样的路径与 query），产物必须与 golden 深比较相等。
 * 请求按「资源名」匹配（query 顺序不影响语义），并断言资源顺序一致：settings→posts→pages→authors→tags。
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'ingest', 'ghost');
const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];

const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'responses.json'), 'utf8'));
const expected = JSON.parse(readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));
const expectedRequests = JSON.parse(readFileSync(path.join(FIXTURES, 'requests.json'), 'utf8'));

function makeProject(seed?: unknown): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghost-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    if (seed !== undefined) writeFileSync(path.join(root, 'src', 'data', 'ghost.json'), JSON.stringify(seed), 'utf8');
    return root;
}

const RESOURCES = ['settings', 'posts', 'pages', 'authors', 'tags'];
function resourceOf(url: string): string | undefined {
    return RESOURCES.find((name) => url.includes(`/content/${name}/`));
}

/** 冻结资源响应 → fetch stub；可单独覆盖某个资源的响应（用来构造失败）。 */
function stubFetch(overrides: Record<string, { status: number; body?: unknown }> = {}) {
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
        const raw = String(url);
        const resource = resourceOf(raw);
        seen.push(resource ? `GET ${resource}` : `GET unknown ${raw}`);
        if (!resource) return new Response(JSON.stringify({ error: raw }), { status: 404, headers: { 'content-type': 'application/json' } });
        const override = overrides[resource];
        if (override) {
            return new Response(override.body === undefined ? null : JSON.stringify(override.body), { status: override.status, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify(fixture.bodies[resource]), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { seen, fetchImpl };
}

const ENV = { GHOST_API_URL: fixture.baseUrl, GHOST_API_KEY: fixture.apiKey };

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ghost：冻结输入等价（旧实现走 ts-ghost 客户端产出的 golden）', () => {
    it('五段全等：settings/posts/pages/authors/tags 与 golden 深比较相等，请求顺序与原来一致', async () => {
        const root = makeProject();
        const { seen, fetchImpl } = stubFetch();
        const result = await runIngestSource('ghost', { projectRoot: root, env: ENV, fetchImpl, log: quiet });

        expect(result.changed).toBe(1);
        expect(result.outputs[0]).toMatchObject({ dataset: 'ghost.content', file: 'ghost.json', count: expected.posts.length });
        expect(result.outputs[0].data).toEqual(expected);
        expect(seen).toEqual(expectedRequests.map((line: string) => line.split(' ').slice(0, 2).join(' ')));
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/ghost.json'), 'utf8'))).toEqual(expected);
    });

    it('裁剪仍然生效：posts 不带 primary_*、tags 内嵌的是裁剪版文章、type 已补', () => {
        const post = expected.posts[0];
        expect(post).not.toHaveProperty('primary_author');
        expect(post).not.toHaveProperty('plaintext');
        expect(post.type).toBe('post');
        expect(expected.pages[0].type).toBe('page');
        expect(expected.tags.map((t: { slug: string; posts: unknown[] }) => `${t.slug}:${t.posts.length}`)).toEqual(['life:1', 'tech:1']);
        const tagPost = expected.tags[0].posts[0];
        expect(tagPost).not.toHaveProperty('html');
        expect(tagPost).not.toHaveProperty('authors');
        expect(tagPost.type).toBe('post');
    });

    it('真实 src/data/ghost.json 过契约校验：0 错误，count 取 posts 长度', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'ghost.json'), 'utf8'));
        const result = validateDataset('ghost.content', real);
        expect(result.errors).toEqual([]);
        expect(result.count).toBe(real.posts.length);
        expect(real.posts.length).toBeGreaterThan(500);
        expect(Object.keys(real)).toEqual(['settings', 'posts', 'pages', 'authors', 'tags']);
    });
});

describe('ghost：失败语义', () => {
    it('0 篇文章 → 拒写，已有 ghost.json 一字节不变', async () => {
        const seed = { settings: null, posts: [{ id: 'old' }], pages: [], authors: [], tags: [] };
        const root = makeProject(seed);
        const file = path.join(root, 'src/data/ghost.json');
        const before = readFileSync(file, 'utf8');
        const { fetchImpl } = stubFetch({ posts: { status: 200, body: { posts: [], meta: { pagination: { page: 1, pages: 1, total: 0, next: null } } } } });
        await expect(runIngestSource('ghost', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/Ghost 拉取到 0 篇文章/);
        expect(readFileSync(file, 'utf8')).toBe(before);
    });

    it('401 → auth，不写盘', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ posts: { status: 401, body: { errors: [{ message: 'unauthorized' }] } } });
        await expect(runIngestSource('ghost', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'auth' });
        expect(existsSync(path.join(root, 'src/data/ghost.json'))).toBe(false);
    });

    it('403 → auth（settings 命中 403 也要抛，而不是静默变 null）', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ settings: { status: 403, body: { errors: [{ message: 'forbidden' }] } } });
        await expect(runIngestSource('ghost', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'auth' });
    });

    it('500 → upstream', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ tags: { status: 500, body: { errors: [{ message: 'boom' }] } } });
        await expect(runIngestSource('ghost', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'upstream' });
    });

    it('settings 非鉴权失败（500）只把 settings 落 null，其余照常写入（与原实现一致）', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ settings: { status: 500, body: { errors: [{ message: 'boom' }] } } });
        const result = await runIngestSource('ghost', { projectRoot: root, env: ENV, fetchImpl, log: quiet });
        expect(result.outputs[0].data.settings).toBeNull();
        expect(result.outputs[0].data.posts).toHaveLength(expected.posts.length);
    });
});
