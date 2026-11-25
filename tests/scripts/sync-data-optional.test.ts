import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyFailure, runSources } from '../../scripts/sync-data.mjs';

const READING = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/data/reading.json');

/**
 * reading 是可选源：WebDAV 抖一下不能把整轮定时任务 / 发布拖下水。
 * 这里只验「失败分类 / 计数」这两个纯行为，不联网、不写盘。
 */
describe('可选源（reading）失败不影响整轮', () => {
    it('classifyFailure：reading 是可选项，其它源仍是硬失败', () => {
        expect(classifyFailure('reading')).toBe('warn');
        for (const name of ['ghost', 'neodb', 'flux', 'memos', 'intervals', 'map', 'rank', 'imagemeta']) {
            expect(classifyFailure(name)).toBe('fail');
        }
        expect(classifyFailure('不存在的源')).toBe('fail');
    });
});

describe('runSources 计数', () => {
    const quiet = { log() {}, warn() {}, error() {} };

    it('reading 抛错 → failed 为 0，只有警告，write 一次都没被调用', async () => {
        const snapshot = existsSync(READING) ? readFileSync(READING, 'utf8') : null;
        // 用真实源名 reading：它的 run 会去读 WebDAV，这里故意不配凭据让它必定失败
        const calls: string[] = [];
        const { failed, warnings } = await runSources(['reading'], {
            env: {}, // 没有 MODU_WEBDAV_URL → requireEnv 抛错
            dryRun: false,
            write: async (file: string) => {
                calls.push(file);
                return true;
            },
            log: quiet
        });
        expect(failed).toBe(0);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('reading');
        expect(calls).toEqual([]); // 失败时不写任何文件，绝不用空数据覆盖已有 reading.json
        expect(existsSync(READING) ? readFileSync(READING, 'utf8') : null).toBe(snapshot); // 磁盘上的 reading.json 一个字节都没变
    }, 30_000);
});
