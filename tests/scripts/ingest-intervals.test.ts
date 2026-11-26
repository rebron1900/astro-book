import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';

/**
 * intervals 源迁移验收。
 *
 * golden 来源：迁移前实现（0b3487a 的 syncIntervals）在同一冻结响应 + 同一份上一版 activities.json
 * 上的产物。覆盖：分年窗口去重、轨迹缓存复用（i3）、新拉轨迹（i1）、室内活动不请求轨迹（i2）、
 * 升序输出。年窗口数量随年份变化，stub 只对「第一个 activities 请求」返回数据，之后返回 []，
 * 因此 golden 与用例不随运行年份漂移。
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'ingest', 'intervals');
const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];

const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'responses.json'), 'utf8'));
const expected = JSON.parse(readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));
const expectedRequests = JSON.parse(readFileSync(path.join(FIXTURES, 'requests.json'), 'utf8'));
const previous = readFileSync(path.join(FIXTURES, 'previous.json'), 'utf8');
const ACTIVITIES_PREFIX = `${fixture.base}/athlete/0/activities?`;

const ENV = { INTERVALS_ICU_API_KEY: '{{SECRET_3kqvnztl}}', INTERVALS_ICU_ATHLETE_ID: '0' };

function makeProject(seed: string | null = previous): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'intervals-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    if (seed !== null) writeFileSync(path.join(root, 'src', 'data', 'activities.json'), seed, 'utf8');
    return root;
}

/** 冻结响应 → fetch stub；activities 列表只发一次（后续窗口返回空数组）。 */
function stubFetch(overrides: Record<string, { status: number; body?: unknown }> = {}, options: { activitiesFirstOnly?: boolean } = {}) {
    const seen: string[] = [];
    let served = false;
    const activitiesFirstOnly = options.activitiesFirstOnly !== false;
    const fetchImpl = async (url: string, init: { method?: string } = {}) => {
        const raw = String(url);
        seen.push(`${String(init.method || 'GET').toUpperCase()} ${raw}`);
        if (raw.startsWith(ACTIVITIES_PREFIX)) {
            const override = overrides[ACTIVITIES_PREFIX];
            if (override) return new Response(JSON.stringify(override.body), { status: override.status, headers: { 'content-type': 'application/json' } });
            if (activitiesFirstOnly && served) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
            served = true;
            return new Response(JSON.stringify(fixture.routes[`GET ${ACTIVITIES_PREFIX}`].body), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        const key = `GET ${raw}`;
        const route = overrides[key] || fixture.routes[key];
        if (!route) return new Response(JSON.stringify({ error: key }), { status: 404, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify(route.body), { status: route.status, headers: { 'content-type': 'application/json' } });
    };
    return { seen, fetchImpl };
}

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('intervals：冻结输入等价（旧实现产出的 golden）', () => {
    it('活动列表 + 轨迹缓存 + 升序：与 golden 深比较相等，请求序列一致', async () => {
        const root = makeProject();
        const { seen, fetchImpl } = stubFetch();
        const result = await runIngestSource('intervals', { projectRoot: root, env: { ...ENV, SYNC_FULL: '0' }, fetchImpl, log: quiet });

        expect(result.outputs[0]).toMatchObject({ dataset: 'intervals.activities', file: 'activities.json', count: expected.length });
        expect(result.outputs[0].data).toEqual(expected);
        expect(seen).toEqual(expectedRequests);
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/activities.json'), 'utf8'))).toEqual(expected);
    });

    it('语义点：i3 复用缓存轨迹（不请求 /map）、i1 新拉、i2 室内不请求、升序', () => {
        type Activity = { id: string; polyline?: string };
        const byId = new Map<string, Activity>(expected.map((a: Activity) => [a.id, a] as [string, Activity]));
        expect(byId.get('i3')!.polyline).toBe('_cached_poly_i3');
        expect(typeof byId.get('i1')!.polyline).toBe('string');
        expect(byId.get('i1')!.polyline).not.toBe('_cached_poly_i3');
        expect(byId.get('i2')!.polyline).toBeUndefined();
        expect(expected.map((a: { id: string }) => a.id)).toEqual(['i1', 'i2', 'i3']);
        expect(expectedRequests.filter((line: string) => line.includes('/map')).sort()).toEqual([
            'GET https://intervals.icu/api/v1/activity/i1/map'
        ]);
    });

    it('真实 src/data/activities.json 过契约校验：0 错误、升序、条数一致', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'activities.json'), 'utf8'));
        const result = validateDataset('intervals.activities', real);
        expect(result.errors).toEqual([]);
        expect(result.count).toBe(real.length);
        expect(real.length).toBeGreaterThan(100);
        for (let i = 1; i < real.length; i += 1) expect(real[i - 1].start_date_local <= real[i].start_date_local).toBe(true);
    });
});

describe('intervals：SYNC_FULL 全重拉轨迹', () => {
    it('SYNC_FULL=1 时不再用缓存，i3 也请求 /map 并拿到新轨迹', async () => {
        const root = makeProject();
        const { seen, fetchImpl } = stubFetch();
        const result = await runIngestSource('intervals', { projectRoot: root, env: { ...ENV, SYNC_FULL: '1' }, fetchImpl, log: quiet });
        type Activity = { id: string; polyline?: string };
        const byId = new Map<string, Activity>(result.outputs[0].data.map((a: Activity) => [a.id, a] as [string, Activity]));
        expect(byId.get('i3')!.polyline).not.toBe('_cached_poly_i3');
        expect(seen).toContain('GET https://intervals.icu/api/v1/activity/i3/map');
    });
});

describe('intervals：失败语义', () => {
    it('401 → auth，不写盘', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [ACTIVITIES_PREFIX]: { status: 401, body: { error: 'unauthorized' } } });
        await expect(runIngestSource('intervals', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'auth' });
        expect(readFileSync(path.join(root, 'src/data/activities.json'), 'utf8')).toBe(previous);
    });

    it('500 → upstream，不写盘', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [ACTIVITIES_PREFIX]: { status: 500, body: { error: 'boom' } } });
        await expect(runIngestSource('intervals', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'upstream' });
    });

    it('0 条活动 → 拒绝覆盖已有文件', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [ACTIVITIES_PREFIX]: { status: 200, body: [] } });
        await expect(runIngestSource('intervals', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/返回 0 条活动，拒绝覆盖已有数据/);
        expect(readFileSync(path.join(root, 'src/data/activities.json'), 'utf8')).toBe(previous);
    });

    it('单条 /map 失败只计数，整个源仍然成功', async () => {
        const root = makeProject(null);
        const { fetchImpl } = stubFetch({ 'GET https://intervals.icu/api/v1/activity/i1/map': { status: 500, body: { error: 'boom' } } });
        const result = await runIngestSource('intervals', { projectRoot: root, env: ENV, fetchImpl, log: quiet });
        const i1 = result.outputs[0].data.find((a: { id: string }) => a.id === 'i1');
        expect(i1.polyline).toBeUndefined();
        expect(result.outputs[0].count).toBe(3);
        expect(existsSync(path.join(root, 'src/data/activities.json'))).toBe(true);
    });
});

describe('intervals：跨源跳转剥掉 Authorization', () => {
    it('activities 请求 302 到别的域时，Authorization 不跟过去', async () => {
        const root = makeProject();
        const seenHeaders: Array<Record<string, string>> = [];
        let first = true;
        const fetchImpl = async (url: string, init: { headers?: unknown; method?: string } = {}) => {
            const map: Record<string, string> = {};
            const entries = Array.isArray(init.headers) ? init.headers : Object.entries(init.headers || {});
            for (const [name, value] of entries as Array<[string, string]>) map[String(name).toLowerCase()] = String(value);
            seenHeaders.push(map);
            const raw = String(url);
            if (raw.startsWith(ACTIVITIES_PREFIX) && first) {
                first = false;
                return new Response(null, { status: 302, headers: { location: 'https://mirror.other.test/api/v1/activities' } });
            }
            if (raw.startsWith('https://mirror.other.test/')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
            if (raw.startsWith(ACTIVITIES_PREFIX)) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
            const route = fixture.routes[`GET ${raw}`];
            if (!route) return new Response(JSON.stringify({ error: raw }), { status: 404, headers: { 'content-type': 'application/json' } });
            return new Response(JSON.stringify(route.body), { status: 200, headers: { 'content-type': 'application/json' } });
        };
        // 这一例只验跳转剥头，不关心取得多少活动；空结果会被「0 条拒写」拦下，故断言抛错信息
        await expect(runIngestSource('intervals', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/0 条活动/);
        expect(seenHeaders[0].authorization).toMatch(/^Basic /);
        expect(seenHeaders[1].authorization).toBeUndefined();
    });
});
