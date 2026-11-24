/**
 * 公开仓库闸门：这个仓库是公开的，modureader 的原始数据库绝不能进版本库或 dist。
 *
 * 检查两处：
 *   1. git 索引里的文件名（允许清单外的 *.db / record-log / modu_sync 一律失败）
 *   2. dist/ 里的文件
 * 命中即退出码 1，CI 会红。
 *
 * 用法：node scripts/check-no-modu-db.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** 允许出现这些字样的文件：生成本身的脚本、测试、守卫自己。 */
const ALLOW = [
    'scripts/check-no-modu-db.mjs',
    'scripts/sync-reading.mjs',
    'scripts/modu-probe.mjs',
    'scripts/node-sqlite-read.mjs',
    'tests/lib/reading.test.ts',
    'tests/scripts/book-title.test.ts',
    'tests/scripts/no-modu-db.test.ts'
];

const BANNED = [/\.db$/i, /record-log/i, /modu_sync/i, /database8\.db/i];

function gitTracked() {
    try {
        return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\u0000').filter(Boolean);
    } catch {
        return [];
    }
}

function distFiles(dir) {
    if (!existsSync(dir)) return [];
    return execFileSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

const tracked = gitTracked().filter((file) => !ALLOW.includes(file) && BANNED.some((re) => re.test(file)));
const dist = distFiles(path.resolve('dist')).filter((file) => BANNED.some((re) => re.test(file)));

if (tracked.length === 0 && dist.length === 0) {
    console.log('[leak-guard] OK：git 索引与 dist/ 中没有 *.db / record-log / modu_sync 痕迹');
    process.exit(0);
}

for (const file of tracked) console.error(`[leak-guard] 仓库里有不该提交的文件：${file}`);
for (const file of dist) console.error(`[leak-guard] dist/ 里有不该发布的文件：${file}`);
console.error(`[leak-guard] 失败：共 ${tracked.length + dist.length} 处命中`);
process.exit(1);
