import { describe, expect, it, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';

/**
 * map 源迁移验收。
 *
 * golden 来源：迁移前实现（0b3487a 的 syncMap）在同一冻结 KMZ 响应 + 同一个转换脚本下的产物。
 * 本机没有 python3，所以转换脚本用一个「假的 python3」代替（PYTHON 环境变量，旧实现本来就支持），
 * 它把 fixtures 里的 GeoJSON 复制到输出路径 —— 转换脚本本身没改，替换的只是「谁能写目标文件」。
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'ingest', 'map');
const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];
const stubPaths: string[] = [];

const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'responses.json'), 'utf8'));
const expected = JSON.parse(readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));

const ORIGINAL_PYTHON = process.env.PYTHON;
const ORIGINAL_STUB = process.env.STUB_GEOJSON;

function installStubPython(): void {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fakepy-'));
    stubPaths.push(dir);
    const file = path.join(dir, 'python3');
    writeFileSync(file, `#!/bin/sh\nout="\${3:-$2}"\ncp "$STUB_GEOJSON" "$out"\n`, 'utf8');
    chmodSync(file, 0o755);
    process.env.PYTHON = file;
    process.env.STUB_GEOJSON = path.join(FIXTURES, 'expected.json');
}

function makeProject(seed?: unknown): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'map-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    if (seed !== undefined) writeFileSync(path.join(root, 'src', 'data', 'geojson.json'), JSON.stringify(seed, null, 2) + '\n', 'utf8');
    return root;
}

function stubFetch(overrides: Record<string, { status: number; body?: unknown; text?: string }> = {}) {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = async (url: string, init: { headers?: unknown } = {}) => {
        const headers: Record<string, string> = {};
        const entries = Array.isArray(init.headers) ? init.headers : Object.entries(init.headers || {});
        for (const [name, value] of entries as Array<[string, string]>) headers[String(name).toLowerCase()] = String(value);
        seen.push({ url: String(url), headers });
        const override = overrides[fixture.url];
        // 304 不能带 body（Response 构造器会抛），按规范只给状态码
        if (override) return override.status === 304 ? new Response(null, { status: 304 }) : new Response(override.text ?? JSON.stringify(override.body ?? null), { status: override.status });
        return new Response(fixture.kmzText, { status: 200, headers: { 'content-type': 'application/vnd.google-earth.kmz' } });
    };
    return { seen, fetchImpl };
}

const ENV = { MAP_KMZ_URL: fixture.url };

afterEach(() => {
    process.env.PYTHON = ORIGINAL_PYTHON;
    process.env.STUB_GEOJSON = ORIGINAL_STUB;
    for (const dir of stubPaths.splice(0)) rmSync(dir, { recursive: true, force: true });
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('map：冻结输入等价（旧实现产出的 golden）', () => {
    it('GeoJSON 与 golden 深比较相等，条数取 features 长度', async () => {
        installStubPython();
        const root = makeProject();
        const { fetchImpl } = stubFetch();
        const result = await runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl, log: quiet });
        expect(result.outputs[0]).toMatchObject({ dataset: 'map.geojson', file: 'geojson.json', count: expected.features.length });
        expect(result.outputs[0].data).toEqual(expected);
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/geojson.json'), 'utf8'))).toEqual(expected);
    });

    it('真实 src/data/geojson.json 过契约校验：0 错误，count=features(127)', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'geojson.json'), 'utf8'));
        const result = validateDataset('map.geojson', real);
        expect(result.errors).toEqual([]);
        expect(result.count).toBe(real.features.length);
        expect(real.features.length).toBeGreaterThan(100);
    });

    it('临时目录不留 KMZ / 中间产物', async () => {
        installStubPython();
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
        installStubPython();
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
        installStubPython();
        const root = makeProject({ type: 'FeatureCollection', features: [] });
        const { seen, fetchImpl } = stubFetch();
        await runIngestSource('map', { projectRoot: root, env: { ...ENV, SYNC_FULL: '1' }, fetchImpl, log: quiet });
        expect(seen[0].headers['if-modified-since']).toBeUndefined();
    });
});

describe('map：失败语义', () => {
    it('401 → auth，不写盘', async () => {
        installStubPython();
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [fixture.url]: { status: 401, body: { error: 'unauthorized' } } });
        await expect(runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/HTTP 401/);
        expect(existsSync(path.join(root, 'src/data/geojson.json'))).toBe(false);
    });

    it('500 → 报错且不写盘；空 KMZ → 报错', async () => {
        installStubPython();
        const root = makeProject();
        const { fetchImpl } = stubFetch({ [fixture.url]: { status: 500 } });
        await expect(runIngestSource('map', { projectRoot: root, env: ENV, fetchImpl, log: quiet })).rejects.toThrow(/KMZ 下载失败/);
        const empty = makeProject();
        const emptyFetch = async () => new Response(new Uint8Array(0), { status: 200 });
        await expect(runIngestSource('map', { projectRoot: empty, env: ENV, fetchImpl: emptyFetch, log: quiet })).rejects.toThrow(/KMZ 文件为空/);
        expect(existsSync(path.join(empty, 'src/data/geojson.json'))).toBe(false);
    });

    it('缺少 MAP_KMZ_URL → auth（执行器凭据检查）', async () => {
        const root = makeProject();
        await expect(runIngestSource('map', { projectRoot: root, env: {}, log: quiet })).rejects.toMatchObject({ code: 'auth' });
    });
});
