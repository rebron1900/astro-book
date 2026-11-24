/**
 * node:sqlite 读库小工具：从 stdin 读一条 SELECT，把结果按 JSON 行数组打到 stdout。
 * 同步脚本在没有系统 sqlite3 CLI 时用它（Node 22 需要 --experimental-sqlite）。
 *
 * 用法：node --experimental-sqlite scripts/node-sqlite-read.mjs <db 文件> < <SQL 文件>
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [, , dbFile] = process.argv;
if (!dbFile) {
    console.error('用法：node --experimental-sqlite scripts/node-sqlite-read.mjs <db> < SQL');
    process.exit(2);
}

const sql = readFileSync(0, 'utf8').trim();
if (!sql) {
    console.error('stdin 为空：需要一条 SELECT');
    process.exit(2);
}

const db = new DatabaseSync(dbFile, { readOnly: true });
try {
    const rows = db.prepare(sql).all();
    // Uint8Array 不能直接 JSON 化，转成文本（payload 列是 TEXT）
    const safe = rows.map((row) => {
        const out = {};
        for (const [key, value] of Object.entries(row)) {
            out[key] = value instanceof Uint8Array ? new TextDecoder().decode(value) : value;
        }
        return out;
    });
    process.stdout.write(JSON.stringify(safe));
} finally {
    db.close();
}
