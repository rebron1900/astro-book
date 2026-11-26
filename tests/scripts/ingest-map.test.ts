import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';
import { kmzOf } from '../helpers/kmz';

/**
 * map 源验收。
 *
 * 转换已从「python3 子进程」换成 scripts/map/kmz-to-geojson.mjs 纯函数，所以这里喂的是**真实构造的
 * KMZ 字节**（tests/helpers/kmz.ts 现场打包 store 或 deflate），不再有假 python、PYTHON/STUB_GEOJSON。
 * expected.json 是这批 KMZ 在当前转换器上的输出，作为回归基线钉住（不是 Python 产物：本机没有 python3）。
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'ingest', 'map');
const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];

const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'responses.json'), 'utf8'));
const expected = JSON.parse(readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));
const KMZ = kmzOf(fixture.kml);

function makeProject(seed?: unknown): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'map-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    if (seed !== undefined) writeFileSync(path.join(root, 'src', 'data', 'geojson.json'), JSON.stringify(seed, null, 2) + '\n', 'utf8');
    return root;
}

function stubFetch(overrides: Record<string, { status: number; body?: unknown }> = {}) {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = async (url: string, init: { headers?: unknown } = {}) => {
        const headers: Record<string, string> = {};
        const entries = Array.isArray(init.headers) ? init.headers : Object.entries(init.headers || {});
        for (const [name, value] of entries as Array<[string, string]>) headers[String(name).toLowerCase()] = String(value);
        seen.push({ url: String(url), headers });
        const override = overrides[fixture.url];
        // 304 不能带 body（Response 构造器会抛），按规范只给状态码
        if (override) return override.status === 304 ? new Response(null, { status: 304 }) : new Response(JSON.stringify(override.body ?? null), { status: override.status });
        return new Response(KMZ, { status: 200, headers: { 'content-type': 'application/vnd.google-earth.kmz' } });
    };
    return { seen, fetchImpl };
}

const ENV = { MAP_KMZ_URL: fixture.url };

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('map：真实构造的 KMZ 走完整链路', () => {
    it('写入 src/data/geojson.json：与基线深比较相等，count 取 features 长度', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch();
        const result = await runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl, log: quiet });
        expect(result.outputs[0]).toMatchObject({ dataset: 'map.geojson', file: 'geojson.json', count: expected.features.length });
        expect(result.outputs[0].data).toEqual(expected);
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/geojson.json'), 'utf8'))).toEqual(expected);
        // 点做了 GCJ→WGS（不是原样搬 coordinate），线面才原样
        expect(expected.features[0].geometry.coordinates[0]).not.toBe(116.41024449916938);
    });

    it('真实 src/data/geojson.json 过契约校验：0 错误，count=features(127)', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'geojson.json'), 'utf8'));
        const result = validateDataset('map.geojson', real);
        expect(result.errors).toEqual([]);
        expect(result.count).toBe(real.features.length);
        expect(real.features.length).toBeGreaterThan(100);
    });

    it('不再创建 astro-book-map-* 临时目录（转换已无子进程、无临时文件）', async () => {
        const root = makeProject();
        const before = new Set(readdirSync(os.tmpdir()));
        const { fetchImpl } = stubFetch();
        await runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl, log: quiet });
        const added = readdirSync(os.tmpdir()).filter((name) => !before.has(name) && name.startsWith('astro-book-map-'));
        expect(added).toEqual([]);
    });
});

describe('map：If-Modified-Since / 304', () => {
    it('有本地产物时带 If-Modified-Since；304 直接复用本地且不写盘', async () => {
        const seed = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: '旧' }, geometry: { type: 'Point', coordinates: [1, 2] } }] };
        const root = makeProject(seed);
        const file = path.join(root, 'src/data/geojson.json');
        const before = readFileSync(file, 'utf8');
        const { seen, fetchImpl } = stubFetch({ [fixture.url]: { status: 304 } });
        const result = await runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl, log: quiet });
        expect(seen[0].headers['if-modified-since']).toMatch(/GMT$/);
        expect(result.outputs[0].data).toEqual(seed);
        expect(result.changed).toBe(0);
        expect(readFileSync(file, 'utf8')).toBe(before);
    });

    it('SYNC_FULL=1 时不带 If-Modified-Since（强制重拉）', async () => {
        const root = makeProject({ type: 'FeatureCollection', features: [] });
        const { seen, fetchImpl } = stubFetch();
        await runIngestSource('map', { projectRoot: root, env: { ...ENV, SYNC_FULL: '1' }, fetchImpl, log: quiet });
        expect(seen[0].headers['if-modified-since']).toBeUndefined();
    });
});

describe('map：失败语义', () => {
    it('401 → 报错 auth 分类、不写盘', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [fixture.url]: { status: 401, body: { error: 'unauthorized' } } });
        await expect(runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/HTTP 401/);
        expect(existsSync(path.join(root, 'src/data/geojson.json'))).toBe(false);
    });

    it('500 → 报错且不写盘；空响应体 → 报「KMZ 文件为空」', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [fixture.url]: { status: 500 } });
        await expect(runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/KMZ 下载失败/);
        const empty = makeProject();
        const emptyFetch = async () => new Response(new Uint8Array(0), { status: 200 });
        await expect(runIngestSource('map', { projectRoot: empty, env: ENV, fetchImpl: emptyFetch, log: quiet })).rejects.toThrow(/KMZ 文件为空/);
        expect(existsSync(path.join(empty, 'src/data/geojson.json'))).toBe(false);
    });

    it('响应不是 KMZ → 转换报错且不写盘（错误信息可读）', async () => {
        const root = makeProject();
        const broken = async () => new Response('not-a-zip', { status: 200 });
        await expect(runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl: broken, log: quiet })).rejects.toThrow(/不是有效的 ZIP/);
        expect(existsSync(path.join(root, 'src/data/geojson.json'))).toBe(false);
    });

    it('缺少 MAP_KMZ_URL → auth（执行器凭据检查）', async () => {
        const root = makeProject();
        await expect(runIngestSource('map', { projectRoot: root, env: {}, log: quiet })).rejects.toMatchObject({ code: 'auth' });
    });
});
