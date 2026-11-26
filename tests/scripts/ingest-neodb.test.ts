import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';

/**
 * neodb 源迁移验收。
 *
 * golden 来源：迁移前实现（630519c 的 sync-data.mjs）在冻结响应 + fixtures 里的上一版数据上
 * 的产物 → expected.json。覆盖三件事：增量合并（旧标记保留）、中文译名沿用上一版、
 * 按 created_time 降序。新模块必须与 golden 深比较相等。
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'ingest', 'neodb');
const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];

const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'responses.json'), 'utf8'));
const expected = JSON.parse(readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));
const expectedRequests = JSON.parse(readFileSync(path.join(FIXTURES, 'requests.json'), 'utf8'));
const previous = readFileSync(path.join(FIXTURES, 'previous.json'), 'utf8');

function makeProject(seed?: string): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'neodb-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    if (seed !== undefined) writeFileSync(path.join(root, 'src', 'data', 'neodb.json'), seed, 'utf8');
    return root;
}

function stubFetch(overrides: Record<string, { status: number; body?: unknown }> = {}) {
    const seen: string[] = [];
    const fetchImpl = async (url: string, init: { method?: string } = {}) => {
        const key = `${String(init.method || 'GET').toUpperCase()} ${String(url)}`;
        seen.push(key);
        const override = overrides[key];
        if (override) return new Response(override.body === undefined ? null : JSON.stringify(override.body), { status: override.status, headers: { 'content-type': 'application/json' } });
        const body = fixture.routes[key];
        if (!body) return new Response(JSON.stringify({ error: key }), { status: 404, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { seen, fetchImpl };
}

const ENV = { NEODB_TOKEN: '{{SECRET_8kjq1nzv}}', NEODB_API_URL: fixture.base };
const PAGE1 = `${fixture.base}/me/shelf/complete?page=1`;

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('neodb：冻结输入等价（旧实现产出的 golden）', () => {
    it('增量合并 + 中文名沿用：与 golden 深比较相等，请求序列一致', async () => {
        const root = makeProject(previous);
        const { seen, fetchImpl } = stubFetch();
        const result = await runIngestSource('neodb', { projectRoot: root, env: { ...ENV, SYNC_FULL: '0' }, fetchImpl, log: quiet });

        expect(result.changed).toBe(1);
        expect(result.outputs[0]).toMatchObject({ dataset: 'neodb.marks', file: 'neodb.json', count: expected.data.length });
        expect(result.outputs[0].data).toEqual(expected);
        expect(seen).toEqual(expectedRequests);
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/neodb.json'), 'utf8'))).toEqual(expected);
    });

    it('语义点：旧标记保留、新标记并入、中文名沿用上一版、严格降序', () => {
        const rows = expected.data;
        expect(rows.map((m: { post_id: number }) => m.post_id)).toEqual([102, 100, 101]);
        const byId = new Map(rows.map((m: { post_id: number }) => [m.post_id, m]));
        // 100 这次上游没进 fetched（已知），时间戳保持上一版
        expect(byId.get(100)).toMatchObject({ created_time: '2026-10-01T00:00:00+00:00' });
        // localized_title 里 zh-cn 有全译名就用它；没有就沿用上一版 title_cn
        expect(byId.get(102)?.item?.title_cn).toBe('第一百零二号');
        expect(byId.get(100)?.item?.title_cn).toBe('一百号旧译名');
        // 裁剪只留白名单字段
        expect(Object.keys(byId.get(102)).sort()).toEqual(['comment_text', 'created_time', 'item', 'post_id', 'rating_grade', 'shelf', 'visibility']);
    });

    it('真实 src/data/neodb.json 过契约校验：0 错误，count 取 data 长度（数字主键）', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'neodb.json'), 'utf8'));
        const result = validateDataset('neodb.marks', real);
        expect(result.errors).toEqual([]);
        expect(result.count).toBe(real.data.length);
        expect(real.data.length).toBeGreaterThan(500);
        for (let i = 1; i < real.data.length; i += 1) {
            expect(new Date(real.data[i - 1].created_time).getTime()).toBeGreaterThanOrEqual(new Date(real.data[i].created_time).getTime());
        }
    });
});

describe('neodb：失败语义', () => {
    it('401 → auth，且不写盘（重试也不会把鉴权错误吞掉）', async () => {
        const root = makeProject(previous);
        const { fetchImpl } = stubFetch({ [`GET ${PAGE1}`]: { status: 401, body: { error: 'unauthorized' } } });
        await expect(runIngestSource('neodb', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'auth' });
        expect(readFileSync(path.join(root, 'src/data/neodb.json'), 'utf8')).toBe(previous);
    }, 20_000);

    it('503 → upstream（3 次重试后失败），已有文件不变', async () => {
        const root = makeProject(previous);
        const { fetchImpl } = stubFetch({ [`GET ${PAGE1}`]: { status: 503, body: { error: 'down' } } });
        await expect(runIngestSource('neodb', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'upstream' });
        expect(readFileSync(path.join(root, 'src/data/neodb.json'), 'utf8')).toBe(previous);
    }, 30_000);

    it('空结果（上一版也为空）→ 拒写', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [`GET ${PAGE1}`]: { status: 200, body: { pages: 1, data: [] } } });
        await expect(runIngestSource('neodb', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/0 条记录，拒绝覆盖已有数据/);
        expect(existsSync(path.join(root, 'src/data/neodb.json'))).toBe(false);
    });

    it('页响应缺少 data 数组 → 抛错，不当成空结果', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [`GET ${PAGE1}`]: { status: 200, body: { pages: 1, items: [] } } });
        await expect(runIngestSource('neodb', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/缺少 data 数组/);
    });
});

describe('neodb：跨源跳转剥掉 Authorization', () => {
    it('shelf 请求 302 到别的域时，Authorization 不跟过去（执行器 fetchWithTimeout 行为）', async () => {
        const root = makeProject(previous);
        const seenHeaders: Array<Record<string, string>> = [];
        const fetchImpl = async (url: string, init: { headers?: unknown; method?: string } = {}) => {
            const map: Record<string, string> = {};
            for (const [name, value] of (Array.isArray(init.headers) ? init.headers : Object.entries(init.headers || {})) as Array<[string, string]>) {
                map[String(name).toLowerCase()] = String(value);
            }
            seenHeaders.push(map);
            const raw = String(url);
            if (raw === PAGE1) {
                return new Response(null, { status: 302, headers: { location: `${fixture.base.replace('neodb.test', 'cdn.other.test')}/me/shelf/complete?page=1` } });
            }
            if (raw.includes('cdn.other.test')) {
                return new Response(JSON.stringify(fixture.routes[`GET ${PAGE1}`]), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return new Response(JSON.stringify({ error: raw }), { status: 404 });
        };
        const result = await runIngestSource('neodb', { projectRoot: root, env: { ...ENV, SYNC_FULL: '0' }, fetchImpl, log: quiet });
        expect(seenHeaders[0].authorization).toMatch(/^Bearer /);
        expect(seenHeaders[1].authorization).toBeUndefined();
        expect(result.outputs[0].count).toBe(expected.data.length);
    });
});
