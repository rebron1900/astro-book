import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { validateDataset } from '../../scripts/lib/ingest/validate.mjs';
import { classifyFailure } from '../../scripts/sync-data.mjs';

/**
 * reading 源迁移验收（可选源）。
 *
 * 数据源是 WebDAV 分片库；用 `MODU_WEBDAV_URL=file://…` 的本地调试模式喂固定分片，
 * 分片由 tests/fixtures/ingest/reading/seed.sql 现场造（不提交二进制）。
 * golden 是迁移前同一份 syncReading 在同一分片上的产物（只有 generatedAt 是运行时值，比较时剔除）。
 * 该源必须保持 optional:true —— WebDAV 打盹只告警、退出码 0。
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'ingest', 'reading');
const quiet = { log() {}, warn() {}, error() {} };
const tempRoots: string[] = [];

const expected = JSON.parse(readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));

/** 造一个「WebDAV 根」：<root>/modu/record-log-v1/a/shard1.db。 */
function makeWebdavRoot(sql?: string): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'modu-'));
    tempRoots.push(root);
    const dir = path.join(root, 'modu', 'record-log-v1', 'a');
    mkdirSync(dir, { recursive: true });
    const db = path.join(dir, 'shard1.db');
    // sql 落成临时文件再喂给 node:sqlite（避免把多行 SQL 塞进 -e 的字符串）
    const sqlFile = path.join(root, 'seed.sql');
    writeFileSync(sqlFile, sql ?? readFileSync(path.join(FIXTURES, 'seed.sql'), 'utf8'), 'utf8');
    const script = [
        "const { DatabaseSync } = require('node:sqlite');",
        "const { readFileSync } = require('node:fs');",
        'const db = new DatabaseSync(process.argv[1]);',
        "db.exec(readFileSync(process.argv[2], 'utf8'));",
        'db.close();'
    ].join('\n');
    execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', '-e', script, db, sqlFile], { stdio: 'pipe' });
    return root;
}

function makeProject(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'reading-'));
    tempRoots.push(root);
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    return root;
}

afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('reading：冻结输入等价（file:// 本地分片）', () => {
    it('输出与 golden 深比较相等（generatedAt 除外），并原样写入 reading.json', async () => {
        const webdav = makeWebdavRoot();
        const root = makeProject();
        const result = await runIngestSource('reading', { projectRoot: root, env: { MODU_WEBDAV_URL: `file://${webdav}` }, log: quiet });
        const { generatedAt, ...rest } = result.outputs[0].data;
        expect(rest).toEqual(expected);
        expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        const written = JSON.parse(readFileSync(path.join(root, 'src/data/reading.json'), 'utf8'));
        expect(written.totals).toEqual(expected.totals);
        expect(written.books).toEqual(expected.books);
        expect(result.outputs[0]).toMatchObject({ dataset: 'reading.digest', file: 'reading.json', count: expected.days.length });
    });

    it('语义点：已删除的 book 与其 time 不计入、position 走 sync_id 关联成 progress、days 倒序', () => {
        expect(expected.totals).toEqual({ seconds: 2700, days: 2, books: 2 });
        expect(expected.books[0]).toMatchObject({ title: '夜航西飞', progress: 55 });
        expect(expected.books.map((b: { title: string }) => b.title)).not.toContain('已删除的书');
        expect(expected.days.map((d: { date: string }) => d.date)).toEqual(['2026-11-21', '2026-11-20']);
    });

    it('真实 src/data/reading.json 过契约校验：0 错误，count=days(54)', () => {
        const real = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'src', 'data', 'reading.json'), 'utf8'));
        const result = validateDataset('reading.digest', real);
        expect(result.errors).toEqual([]);
        expect(result.count).toBe(real.days.length);
        expect(real.days.length).toBeGreaterThan(30);
        expect(real.books.length).toBeGreaterThan(10);
    });
});

describe('reading：可选源语义与失败', () => {
    it('optional:true 且失败只告警（classifyFailure=warn）', () => {
        expect(classifyFailure('reading')).toBe('warn');
    });

    it('缺 MODU_WEBDAV_URL → auth，不写盘', async () => {
        const root = makeProject();
        await expect(runIngestSource('reading', { projectRoot: root, env: {}, log: quiet })).rejects.toMatchObject({ code: 'auth' });
        expect(existsSync(path.join(root, 'src/data/reading.json'))).toBe(false);
    });

    it('分片目录为空 → 报错且不覆盖已有 reading.json', async () => {
        const webdav = mkdtempSync(path.join(os.tmpdir(), 'modu-empty-'));
        tempRoots.push(webdav);
        mkdirSync(path.join(webdav, 'modu', 'record-log-v1', 'a'), { recursive: true });
        const root = makeProject();
        const file = path.join(root, 'src/data/reading.json');
        writeFileSync(file, '{"kept":true}\n', 'utf8');
        await expect(runIngestSource('reading', { projectRoot: root, env: { MODU_WEBDAV_URL: `file://${webdav}` }, log: quiet })).rejects.toThrow(/没有 \.db 分片/);
        expect(readFileSync(file, 'utf8')).toBe('{"kept":true}\n');
    });

    it('分片里没有 time/book 记录 → 拒绝写空阅读数据', async () => {
        const webdav = makeWebdavRoot(`CREATE TABLE modu_sync_records (kind TEXT NOT NULL, sync_id TEXT NOT NULL, clock INTEGER, revision INTEGER, deleted INTEGER NOT NULL DEFAULT 0, payload TEXT, narration TEXT, PRIMARY KEY (kind, sync_id));`);
        const root = makeProject();
        await expect(runIngestSource('reading', { projectRoot: root, env: { MODU_WEBDAV_URL: `file://${webdav}` }, log: quiet })).rejects.toThrow(/拒绝写入空阅读数据/);
        expect(existsSync(path.join(root, 'src/data/reading.json'))).toBe(false);
    });
});

describe('reading：兼容导出', () => {
    it('scripts/sync-reading.mjs 仍导出 syncReading', async () => {
        const mod = await import('../../scripts/sync-reading.mjs');
        expect(typeof mod.syncReading).toBe('function');
        expect(typeof mod.cleanAppliedData).toBe('function');
    });
});
