import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// scripts/sync-data.mjs 的 writeJson 未被导出，且脚本顶层直接执行 main()（import 即触发真实网络请求）。
// 文件边界不允许修改 scripts/，因此：
//   A) 把 writeJson 的空数据保护规则复刻为纯函数，验证其决策矩阵（与实现逐行一致）。
//   B) 用 `--dry-run <不存在源>` 做冒烟测试：源列表为空 → 零网络请求，验证脚本能解析、加载 site.ts 并正常退出。

// 与 scripts/sync-data.mjs 中 writeJson 的空数组/空对象判定逐行一致
function isEmpty(data: unknown): boolean {
    if (Array.isArray(data)) return data.length === 0;
    return data === null || (data !== null && typeof data === 'object' && Object.keys(data as object).length === 0);
}

// 决策：新数据为空且磁盘已有非空数据 → 保留旧数据（不覆盖）；其余走常规写入/跳过逻辑
function shouldKeepExisting(data: unknown, existingJson: string | null): boolean {
    if (!isEmpty(data)) return false; // 新数据非空，正常写入
    if (existingJson === null) return false; // 磁盘无旧文件，写入空数据
    // 磁盘文件非空（trim 后长度 > 2，即不止 '[]' / '{}'）
    return existingJson.trim().length > 2;
}

const DATA_DIR = path.join(__dirname, '..', '..', 'src', 'data');

describe('sync-data.mjs writeJson 空数据保护', () => {
    it('新数据为空 + 磁盘已有非空数据 → 保留旧数据', () => {
        expect(shouldKeepExisting([], '{"posts":[]}\n')).toBe(true);
        expect(shouldKeepExisting({}, '[1,2,3]')).toBe(true);
        expect(shouldKeepExisting(null, '["x"]')).toBe(true);
    });

    it('新数据为空 + 磁盘文件本身就是空 JSON → 覆盖（写空）', () => {
        expect(shouldKeepExisting([], '[]')).toBe(false);
        expect(shouldKeepExisting([], '{}')).toBe(false);
        expect(shouldKeepExisting([], '[]\n')).toBe(false);
    });

    it('新数据为空 + 磁盘无文件 → 写入空数据', () => {
        expect(shouldKeepExisting([], null)).toBe(false);
    });

    it('新数据非空 → 正常写入（不受旧文件影响）', () => {
        expect(shouldKeepExisting([1, 2], '{"old":true}')).toBe(false);
        expect(shouldKeepExisting([{ a: 1 }], null)).toBe(false);
        expect(shouldKeepExisting({ a: 1 }, '[1]')).toBe(false);
    });

    it('写盘路径与实现一致（src/data 下）', () => {
        // DATA_DIR 指向 src/data，即 writeJson 的 DATA_DIR
        expect(existsSync(DATA_DIR)).toBe(true);
    });

    it('readFileSync 判断与 writeJson 的 existingTrimmed.length>2 判定等价', () => {
        const filepath = path.join(os.tmpdir(), 'sync-test-empty.json');
        writeFileSync(filepath, '{"a":1}', 'utf8');
        const existing = readFileSync(filepath, 'utf8');
        expect(existing.trim().length > 2).toBe(true);
        expect(shouldKeepExisting([], existing)).toBe(true);
        writeFileSync(filepath, '[]', 'utf8');
        const emptyExisting = readFileSync(filepath, 'utf8');
        expect(shouldKeepExisting([], emptyExisting)).toBe(false);
    });
});

describe('sync-data.mjs 冒烟测试（dry-run，零网络）', () => {
    it('以不存在的源运行 --dry-run 能解析并正常退出', () => {
        // 源列表为空 → 不请求任何外部源；验证脚本可解析、加载 site.ts、输出 dry-run 完成
        const out = execFileSync('node', ['scripts/sync-data.mjs', '--dry-run', 'no-such-source'], {
            cwd: path.join(__dirname, '..', '..'),
            encoding: 'utf8',
            timeout: 30000,
        });
        expect(out).toContain('(dry-run)');
        expect(out).toContain('dry-run 完成');
    });
});
