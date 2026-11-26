#!/usr/bin/env node
/**
 * 兼容入口：Emby 同步已迁到模块层。
 *
 * 逻辑在 scripts/lib/sources/emby.mjs（meta + collect），由 scripts/lib/ingest/executor.mjs
 * 统一校验契约、原子写盘、更新同步状态。这里只保留命令兼容：
 *
 *   node scripts/sync-emby.mjs
 *
 * 等价于 `node scripts/sync-data.mjs emby`（写 src/data/emby.json + .cache/sync-state.json）。
 * 定时任务应继续用 sync-data.mjs；不要在这里再写一套取数或写盘。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIngestSource } from './lib/ingest/executor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

runIngestSource('emby', { env: process.env, projectRoot: ROOT })
    .then((result) => {
        const count = result.outputs[0]?.count ?? 0;
        console.log(`[emby] 完成，${count} 条`);
    })
    .catch((error) => {
        console.error(`[emby] ${error.message}`);
        process.exitCode = 1;
    });
