import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';
import { classifyFailure } from '../../scripts/sync-data.mjs';

/**
 * rank 源迁移验收（可选源，结构由上游决定）。
 *
 * golden 来源：迁移前实现（0b3487a 的 syncRank）在冻结响应上的产物。
 * optional:true 是硬要求：远端 worker 打盹只告警、退出码 0，不能变成整轮硬失败。
 */

const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];
const RANK_URL = 'https://divine-cell-831a.me-d1b.workers.dev/';
const SAMPLE = { success: true, items: [{ name: '友链 A', score: 9 }, { name: '友链 B', score: 7 }] };

function makeProject(seed?: unknown): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rank-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    if (seed !== undefined) writeFileSync(path.join(root, 'src', 'data', 'rank.json'), JSON.stringify(seed, null, 2) + '\n', 'utf8');
    return root;
}

function stubFetch(status = 200, body: unknown = SAMPLE) {
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
        seen.push(String(url));
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { seen, fetchImpl };
}

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('rank：冻结输入等价（旧实现产出的 golden）', () => {
    it('上游 JSON 原样落地：与旧实现的返回值深比较相等（未声明字段全部保留）', async () => {
        const root = makeProject();
        const { seen, fetchImpl } = stubFetch();
        const result = await runIngestSource('rank', { projectRoot: root, env: {}, fetchImpl, log: quiet });
        expect(result.outputs[0]).toMatchObject({ dataset: 'rank.status', file: 'rank.json' });
        expect(result.outputs[0].data).toEqual(SAMPLE);
        expect(result.outputs[0].count).toBe(Object.keys(SAMPLE).length);
        expect(seen).toEqual([RANK_URL]);
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/rank.json'), 'utf8'))).toEqual(SAMPLE);
    });

    it('真实 src/data/rank.json 过契约校验：0 错误（当前是 {success:false,error}）', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'rank.json'), 'utf8'));
        const result = validateDataset('rank.status', real);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
    });
});

describe('rank：可选源失败语义', () => {
    it('optional:true（classifyFailure=warn）', () => {
        expect(classifyFailure('rank')).toBe('warn');
    });

    it('上游 500 → 告警 + 保留旧文件，不抛错', async () => {
        const seed = { success: false, error: '旧数据' };
        const root = makeProject(seed);
        const file = path.join(root, 'src/data/rank.json');
        const before = readFileSync(file, 'utf8');
        const warns: string[] = [];
        const { fetchImpl } = stubFetch(500, { error: 'boom' });
        const result = await runIngestSource('rank', { projectRoot: root, env: {}, fetchImpl, log: { ...quiet, warn: (line: string) => warns.push(line) } });
        expect(result.changed).toBe(0);
        expect(warns.join('\n')).toMatch(/\[rank\] 获取失败/);
        expect(readFileSync(file, 'utf8')).toBe(before);
    });

    it('上游 429 → 同样只告警、保留旧数据', async () => {
        const seed = { success: true, items: [] };
        const root = makeProject(seed);
        const { fetchImpl } = stubFetch(429, { error: 'slow down' });
        const result = await runIngestSource('rank', { projectRoot: root, env: {}, fetchImpl, log: quiet });
        expect(result.changed).toBe(0);
    });

    it('失败且没有旧数据 → 抛错（在 runSources 里按可选源记警告、退出码不受影响）', async () => {
        const root = makeProject();
        const { fetchImpl } = stubFetch(500, { error: 'boom' });
        await expect(runIngestSource('rank', { projectRoot: root, env: {}, fetchImpl, log: quiet })).rejects.toThrow(/没有可复用的旧数据/);
        expect(existsSync(path.join(root, 'src/data/rank.json'))).toBe(false);
    });

    it('上游返回空对象 → 不覆盖已有文件（沿用空数据保护语义）', async () => {
        const seed = { success: true };
        const root = makeProject(seed);
        const file = path.join(root, 'src/data/rank.json');
        const before = readFileSync(file, 'utf8');
        const { fetchImpl } = stubFetch(200, {});
        await expect(runIngestSource('rank', { projectRoot: root, env: {}, fetchImpl, log: quiet })).rejects.toThrow(/结果为空/);
        expect(readFileSync(file, 'utf8')).toBe(before);
    });
});
