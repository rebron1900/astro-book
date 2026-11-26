import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';

/**
 * memos 源（GoToSocial 优先 / 旧 Memos API 兜底）迁移验收。
 *
 * golden 来源：用迁移前实现（commit 630519c 的 sync-data.mjs）在下面这份冻结响从上跑出的产物，
 * 存于 tests/fixtures/ingest/memos-{gts,legacy}/expected.json；新模块对同一响应必须深比较相等。
 * 这里不联网：fetch 全部走注入的 stub。
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'ingest');
const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];

function makeProject(memos?: unknown[]): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'memos-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    if (memos) writeFileSync(path.join(root, 'src', 'data', 'memos.json'), JSON.stringify(memos, null, 2) + '\n', 'utf8');
    return root;
}

function readFixture(...parts: string[]) {
    return JSON.parse(readFileSync(path.join(FIXTURES, ...parts), 'utf8'));
}

/**
 * 冻结响应 → fetch stub：routes 的键是「METHOD URL」，返回体原样序列化。
 * 同时挂到 globalThis.fetch —— 旧 Memos API 兜底分支要读 X-Total-Count 响应头，
 * 走的是全局 fetch（保持与原实现一致的「非 2xx 只 warn 并停止翻页」语义），
 * 注入的 fetchImpl 只覆盖走 ctx.fetchJson 的 GoToSocial 分支。
 */
const originalFetch = globalThis.fetch;
function stubFetch(routes: Record<string, { status: number; body?: unknown; headers?: Record<string, string> }>) {
    const seen: string[] = [];
    const fetchImpl = async (url: string, init: { method?: string } = {}) => {
        const key = `${String(init.method || 'GET').toUpperCase()} ${String(url)}`;
        seen.push(key);
        const route = routes[key];
        if (!route) return new Response(JSON.stringify({ error: `无此路由: ${key}` }), { status: 404, headers: { 'content-type': 'application/json' } });
        const headers = { 'content-type': 'application/json', ...(route.headers || {}) };
        return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status, headers });
    };
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    return { seen, fetchImpl };
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const GTS_FIXTURE = readFixture('memos-gts', 'responses.json');
const GTS_EXPECTED = readFixture('memos-gts', 'expected.json');
const LEGACY_FIXTURE = readFixture('memos-legacy', 'responses.json');
const LEGACY_EXPECTED = readFixture('memos-legacy', 'expected.json');

/** 与 fixtures 里 seed 的上一个版本一致（增量合并要用）。 */
const PREVIOUS = [
    { id: 'm-old', content: '旧动态', createdTs: 1000, updatedTs: 1000, creatorName: '1900', resourceList: [], visibility: 'PUBLIC', pinned: false, type: 'memo' },
    { id: 's1', content: 's1 旧版本', createdTs: 2000, updatedTs: 2000, creatorName: '1900', resourceList: [], visibility: 'PUBLIC', pinned: false, type: 'memo' }
];

const GTS_ROUTES = GTS_FIXTURE.routes;
const LEGACY_ROUTES = LEGACY_FIXTURE.routes;

const GTS_ENV = { GOTOSOCIAL_URL: 'https://gts.test', GOTOSOCIAL_TOKEN: 'tok-123456' };

describe('memos：冻结输入等价（旧实现在同一响应下的 golden）', () => {
    it('GoToSocial 增量：输出与 golden 深比较相等，请求序列也一致', async () => {
        const root = makeProject(PREVIOUS);
        const { seen, fetchImpl } = stubFetch(GTS_ROUTES);
        const result = await runIngestSource('memos', { projectRoot: root, env: GTS_ENV, fetchImpl, log: quiet });
        expect(result.changed).toBe(1);
        expect(result.outputs[0]).toMatchObject({ dataset: 'memos.list', file: 'memos.json', count: GTS_EXPECTED.length });
        expect(result.outputs[0].data).toEqual(GTS_EXPECTED);
        expect(seen).toEqual(GTS_FIXTURE.requests);
        // 落盘内容与 golden 一致（写盘路径也等价）
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/memos.json'), 'utf8'))).toEqual(GTS_EXPECTED);
    });

    it('旧 Memos API 兜底：输出与 golden 相等', async () => {
        const root = makeProject();
        const { seen, fetchImpl } = stubFetch(LEGACY_ROUTES);
        const result = await runIngestSource('memos', { projectRoot: root, env: {}, fetchImpl, log: quiet });
        expect(result.outputs[0].data).toEqual(LEGACY_EXPECTED);
        expect(seen).toEqual(LEGACY_FIXTURE.requests);
    });

    it('隐私：非公开一条都不落地（golden 里只剩 3 条，private 被丢）', () => {
        expect(GTS_EXPECTED.map((memo: { id: string }) => memo.id)).toEqual(['s2', 's1', 'm-old']);
        for (const memo of GTS_EXPECTED) expect(memo.visibility).toBe('PUBLIC');
    });

    it('真实 src/data/memos.json 过契约校验：0 错误，条数与文件一致', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'memos.json'), 'utf8'));
        const result = validateDataset('memos.list', real);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.count).toBe(real.length);
        expect(real.length).toBeGreaterThan(1000);
    });
});

describe('memos：失败语义', () => {
    it('401 → auth，且不写盘', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ 'GET https://gts.test/api/v1/accounts/verify_credentials': { status: 401, body: { error: 'unauthorized' } } });
        await expect(runIngestSource('memos', { projectRoot: root, env: GTS_ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'auth' });
        expect(existsSync(path.join(root, 'src/data/memos.json'))).toBe(false);
    });

    it('429 → upstream，且不写盘', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ 'GET https://gts.test/api/v1/accounts/verify_credentials': { status: 429, body: { error: 'slow down' } } });
        await expect(runIngestSource('memos', { projectRoot: root, env: GTS_ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'upstream' });
        expect(existsSync(path.join(root, 'src/data/memos.json'))).toBe(false);
    });

    it('5xx → upstream', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ 'GET https://gts.test/api/v1/accounts/verify_credentials': { status: 503, body: { error: 'down' } } });
        await expect(runIngestSource('memos', { projectRoot: root, env: GTS_ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'upstream' });
    });

    it('空结果不覆盖已有文件（旧 API 5xx → 0 条 → 抛错，原文件一字节不变）', async () => {
        const root = makeProject(PREVIOUS);
        const file = path.join(root, 'src/data/memos.json');
        const before = readFileSync(file, 'utf8');
        const { fetchImpl } = stubFetch({ [`GET ${LEGACY_FIXTURE.base}?limit=50&offset=0`]: { status: 500, body: { error: 'boom' } } });
        await expect(runIngestSource('memos', { projectRoot: root, env: {}, fetchImpl, log: quiet })).rejects.toThrow(/0 条动态/);
        expect(readFileSync(file, 'utf8')).toBe(before);
    });

    it('全部非公开 → 拒写（抛错而不是落空文件）', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({
            [`GET ${LEGACY_FIXTURE.base}?limit=50&offset=0`]: {
                status: 200,
                headers: { 'x-total-count': '2' },
                body: [
                    { id: 'p1', content: '私密一', createdTs: 1, updatedTs: 1, creatorName: '1900', resourceList: [], visibility: 'PRIVATE', pinned: false },
                    { id: 'p2', content: '私密二', createdTs: 2, updatedTs: 2, creatorName: '1900', resourceList: [], visibility: 'PRIVATE', pinned: false }
                ]
            }
        });
        await expect(runIngestSource('memos', { projectRoot: root, env: {}, fetchImpl, log: quiet })).rejects.toThrow(/拒绝用空数据覆盖已有文件/);
        expect(existsSync(path.join(root, 'src/data/memos.json'))).toBe(false);
    });
});
