import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';

/**
 * flux 源迁移验收（一个源两个产物）。
 *
 * golden 来源：迁移前实现（0b3487a 的 syncFlux）在同一份冻结响应 + 同一份上一版数据上的产物。
 * 覆盖分支：正常最新文章 / Miniflux 无文章时直连订阅源兜底 / 解析错误达上限 / 直连失败沿用旧文章 /
 * entries 接口失败沿用旧文章 / 失联时间沿用上一版。
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'ingest', 'flux');
const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];

const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'responses.json'), 'utf8'));
const expected = JSON.parse(readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));
const expectedRequests = JSON.parse(readFileSync(path.join(FIXTURES, 'requests.json'), 'utf8'));
const previousEntries = readFileSync(path.join(FIXTURES, 'previous-entries.json'), 'utf8');
const previousLost = readFileSync(path.join(FIXTURES, 'previous-lost.json'), 'utf8');

const ENV = { FLUX_URL: fixture.base, FLUX_KEY: '{{SECRET_ux9k2vqx}}', FLUX_READER_PROXY: '0' };

function makeProject(seed = true): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'flux-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    if (seed) {
        writeFileSync(path.join(root, 'src', 'data', 'flux.json'), previousEntries, 'utf8');
        writeFileSync(path.join(root, 'src', 'data', 'flux-lost.json'), previousLost, 'utf8');
    }
    return root;
}

/** 冻结响应 → fetch stub：body 走 JSON，text 直接当 XML 文本。 */
function stubFetch(overrides: Record<string, { status: number; body?: unknown; text?: string }> = {}) {
    const seen: string[] = [];
    const fetchImpl = async (url: string, init: { method?: string } = {}) => {
        const key = `${String(init.method || 'GET').toUpperCase()} ${String(url)}`;
        seen.push(key);
        const route = overrides[key] || fixture.routes[key];
        if (!route) return new Response(JSON.stringify({ error: key }), { status: 404, headers: { 'content-type': 'application/json' } });
        if (route.text !== undefined) return new Response(route.text, { status: route.status, headers: { 'content-type': 'application/rss+xml' } });
        return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status, headers: { 'content-type': 'application/json' } });
    };
    return { seen, fetchImpl };
}

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('flux：冻结输入等价（旧实现产出的 golden，两个产物各自对照）', () => {
    it('flux.feed 与 flux.lost 都与 golden 深比较相等，请求序列一致', async () => {
        const root = makeProject();
        const { seen, fetchImpl } = stubFetch();
        const result = await runIngestSource('flux', { projectRoot: root, env: ENV, fetchImpl, log: quiet });

        const byDataset = new Map(result.outputs.map((output: { dataset: string; data: unknown }) => [output.dataset, output.data]));
        expect(byDataset.get('flux.feed')).toEqual(expected.entries);
        expect(byDataset.get('flux.lost')).toEqual(expected.lost);
        expect(seen).toEqual(expectedRequests);
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/flux.json'), 'utf8'))).toEqual(expected.entries);
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/flux-lost.json'), 'utf8'))).toEqual(expected.lost);
        expect(result.changed).toBe(2);
    });

    it('语义点：直连兜底 / 解析上限 / 沿用旧文章 / 失联时间继承', () => {
        const entries = expected.entries;
        expect(entries.map((e: { feed_id: number }) => e.feed_id)).toEqual([1, 2, 5]); // 2 来自直连 XML；5 沿用旧文章
        expect(entries.find((e: { feed_id: number }) => e.feed_id === 2).title).toBe('B 的最新');
        const lost = expected.lost;
        expect(lost.map((l: { id: number }) => l.id)).toEqual([3, 4]);
        expect(lost[0]).toMatchObject({ reason: 'error', first_seen_at: '2026-01-01T00:00:00.000Z' });
        expect(lost[1]).toMatchObject({ reason: 'error', first_seen_at: '2026-02-02T00:00:00.000Z' });
    });

    it('真实 src/data/flux.json 与 flux-lost.json 过契约校验：0 错误', () => {
        const dir = path.join(__dirname, '..', '..', 'src', 'data');
        const feed = JSON.parse(readFileSync(path.join(dir, 'flux.json'), 'utf8'));
        const lost = JSON.parse(readFileSync(path.join(dir, 'flux-lost.json'), 'utf8'));
        const feedResult = validateDataset('flux.feed', feed);
        const lostResult = validateDataset('flux.lost', lost);
        expect(feedResult.errors).toEqual([]);
        expect(lostResult.errors).toEqual([]);
        expect(feedResult.count).toBe(feed.length);
        expect(lostResult.count).toBe(lost.length);
        expect(feed.length).toBeGreaterThan(100);
        expect(lost.length).toBeGreaterThan(0);
    });
});

describe('flux：失败语义', () => {
    it('>50% 订阅最新文章失败 → 放弃本轮，两个旧文件一字节不变', async () => {
        const root = makeProject();
        const before = [readFileSync(path.join(root, 'src/data/flux.json'), 'utf8'), readFileSync(path.join(root, 'src/data/flux-lost.json'), 'utf8')];
        const overrides = {};
        for (const id of [1, 2, 3]) overrides[`GET ${fixture.base}/feeds/${id}/entries?limit=1&order=published_at&direction=desc`] = { status: 500, body: { error: 'boom' } };
        const { fetchImpl } = stubFetch(overrides);
        await expect(runIngestSource('flux', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/个订阅最新文章请求失败/);
        expect([readFileSync(path.join(root, 'src/data/flux.json'), 'utf8'), readFileSync(path.join(root, 'src/data/flux-lost.json'), 'utf8')]).toEqual(before);
    });

    it('401 → auth，不写盘', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [`GET ${fixture.base}/categories/4/feeds`]: { status: 401, body: { error: 'unauthorized' } } });
        await expect(runIngestSource('flux', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'auth' });
        expect(readFileSync(path.join(root, 'src/data/flux.json'), 'utf8')).toBe(previousEntries);
    });

    it('429 → upstream，不写盘', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [`GET ${fixture.base}/categories/4/feeds`]: { status: 429, body: { error: 'slow down' } } });
        await expect(runIngestSource('flux', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'upstream' });
    });

    it('feed 列表为空 → 拒绝覆盖', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [`GET ${fixture.base}/categories/4/feeds`]: { status: 200, body: [] } });
        await expect(runIngestSource('flux', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/没有返回任何订阅/);
    });

    it('多产物任一不过 → 整源不写（feed 条目缺 url 时 flux.lost 的成功结果也不落地）', async () => {
        const root = makeProject(false);
        const { fetchImpl } = stubFetch({ [`GET ${fixture.base}/feeds/1/entries?limit=1&order=published_at&direction=desc`]: { status: 200, body: [{ title: '无链接', published_at: '2026-11-20T10:00:00Z' }] } });
        await expect(runIngestSource('flux', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/flux\.feed 契约校验失败/);
        expect(existsSync(path.join(root, 'src/data/flux.json'))).toBe(false);
        expect(existsSync(path.join(root, 'src/data/flux-lost.json'))).toBe(false);
    });

    it('全部订阅都正常 → flux-lost.json 写空数组（allowEmpty:true，空是合法结果）', async () => {
        const root = makeProject(false);
        const oneFeed = [{ id: 9, title: '只剩一个', site_url: 'https://f.test/', feed_url: 'https://f.test/feed.xml' }];
        const { fetchImpl } = stubFetch({
            [`GET ${fixture.base}/categories/4/feeds`]: { status: 200, body: oneFeed },
            [`GET ${fixture.base}/feeds/9/entries?limit=1&order=published_at&direction=desc`]: { status: 200, body: [{ title: 'F', url: 'https://f.test/1', published_at: '2026-11-21T00:00:00Z' }] }
        });
        const result = await runIngestSource('flux', { projectRoot: root, env: ENV, fetchImpl, log: quiet });
        expect(result.outputs.map((o: { dataset: string; count: number }) => [o.dataset, o.count])).toEqual([
            ['flux.feed', 1],
            ['flux.lost', 0]
        ]);
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/flux-lost.json'), 'utf8'))).toEqual([]);
    });
});

describe('flux：跨源跳转剥掉 X-Auth-Token', () => {
    it('feeds 请求 302 到别的域时，X-Auth-Token 不跟过去（同源跳转保留）', async () => {
        const root = makeProject();
        const seenHeaders: Array<Record<string, string>> = [];
        const base = fixture.base;
        const fetchImpl = async (url: string, init: { headers?: unknown; method?: string } = {}) => {
            const map: Record<string, string> = {};
            const entries = Array.isArray(init.headers) ? init.headers : Object.entries(init.headers || {});
            for (const [name, value] of entries as Array<[string, string]>) map[String(name).toLowerCase()] = String(value);
            seenHeaders.push(map);
            const raw = String(url);
            if (raw === `${base}/categories/4/feeds`) {
                return new Response(null, { status: 302, headers: { location: 'https://mirror.other.test/categories/4/feeds' } });
            }
            if (raw === 'https://mirror.other.test/categories/4/feeds') {
                return new Response(JSON.stringify(fixture.routes[`GET ${base}/categories/4/feeds`].body), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            const route = fixture.routes[`GET ${raw}`];
            if (!route) return new Response(JSON.stringify({ error: raw }), { status: 404, headers: { 'content-type': 'application/json' } });
            if (route.text !== undefined) return new Response(route.text, { status: route.status, headers: { 'content-type': 'application/rss+xml' } });
            return new Response(JSON.stringify(route.body), { status: route.status, headers: { 'content-type': 'application/json' } });
        };
        await runIngestSource('flux', { projectRoot: root, env: ENV, fetchImpl, log: quiet });
        expect(seenHeaders[0]['x-auth-token']).toBe(ENV.FLUX_KEY);
        expect(seenHeaders[1]['x-auth-token']).toBeUndefined();
        expect(seenHeaders[2]['x-auth-token']).toBe(ENV.FLUX_KEY); // 回到 flux.test 的 entries 仍带
    });
});
