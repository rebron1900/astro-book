import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    it('真实 src/data/rank.json（当前是上游失败载荷）如实判为不合格，报出 error 字段', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'rank.json'), 'utf8'));
        const result = validateDataset('rank.status', real);
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toMatch(/字段 error 类型是 string，要求 null\?/);
    });
});

describe('rank：契约拦截上游错误载荷', () => {
    const ERROR_PAYLOAD = { success: false, error: 'Unexpected end of JSON input' };

    it('错误载荷 {success:false,error} 被契约拒绝（myRank 缺失时页面会静默显示 0 小时）', () => {
        const result = validateDataset('rank.status', ERROR_PAYLOAD);
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toMatch(/字段 error 类型是 string，要求 null\?/);
    });

    it('正常载荷 {myRank:{totalDuration}} 通过校验且能落地；空对象也能过（myRank 可选）', async () => {
        expect(validateDataset('rank.status', { myRank: { totalDuration: 12345 } }).ok).toBe(true);
        expect(validateDataset('rank.status', { success: true, myRank: { totalDuration: 12345 } }).ok).toBe(true);
        expect(validateDataset('rank.status', {}).ok).toBe(true);

        const root = makeProject();
        const { fetchImpl } = stubFetch(200, { success: true, myRank: { totalDuration: 12345 } });
        const result = await runIngestSource('rank', { projectRoot: root, env: {}, fetchImpl, log: quiet });
        expect(result.outputs[0].data).toEqual({ success: true, myRank: { totalDuration: 12345 } });
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/rank.json'), 'utf8'))).toEqual({ success: true, myRank: { totalDuration: 12345 } });
    });

    it('{success:true,myRank:null} 通过校验：null 表示本次无排名，仍属成功载荷', () => {
        const result = validateDataset('rank.status', { success: true, myRank: null });
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('{success:true,myRank:null} 能真的落地（读回新文件），不会冻结在旧文件', async () => {
        const seed = { success: true, myRank: { totalDuration: 999 } };
        const root = makeProject(seed);
        const { fetchImpl } = stubFetch(200, { success: true, myRank: null });
        const result = await runIngestSource('rank', { projectRoot: root, env: {}, fetchImpl, log: quiet });
        expect(result.changed).toBe(1);
        // 读回确认真的写进去了（不是被当空数据跳过）
        expect(JSON.parse(readFileSync(path.join(root, 'src/data/rank.json'), 'utf8'))).toEqual({ success: true, myRank: null });
    });

    it('远端返回错误载荷 → 整源不写盘：旧文件字节不变、无 .tmp 残留、按可选源只告警', async () => {
        const seed = { success: true, myRank: { totalDuration: 1 } };
        const root = makeProject(seed);
        const file = path.join(root, 'src/data/rank.json');
        const before = readFileSync(file, 'utf8');
        const warns: string[] = [];
        const { fetchImpl } = stubFetch(200, ERROR_PAYLOAD);
        await expect(
            runIngestSource('rank', { projectRoot: root, env: {}, fetchImpl, log: { ...quiet, warn: (line: string) => warns.push(line) } })
        ).rejects.toMatchObject({ code: 'contract' });
        expect(readFileSync(file, 'utf8')).toBe(before);
        // 写入是原子的（临时文件 + rename），失败后目录里只剩原来那一个文件
        expect(readdirSync(path.join(root, 'src/data'))).toEqual(['rank.json']);
        // 退出码：可选源失败只记 warn，runSources 不会把它算成硬失败
        expect(classifyFailure('rank')).toBe('warn');
    });
});

describe('rank：可选源失败语义', () => {
    it('optional:true（classifyFailure=warn）', () => {
        expect(classifyFailure('rank')).toBe('warn');
    });

    it('上游 500 → 告警 + 保留旧文件，不抛错', async () => {
        const seed = { success: true, myRank: { totalDuration: 999 } }; // 旧数据本身必须是合格载荷
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
