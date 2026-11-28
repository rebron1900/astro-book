#!/usr/bin/env node
/**
 * 回填 src/data/neodb.json 里「没有短评」条目的作品简介（item.brief）。
 *
 * 卡片在没有短评时用这段简介当回退文案（见 LedgerNeodb.astro）。
 * 定时同步（scripts/lib/sources/neodb.mjs 的 enrichBriefs）也会补新条目，
 * 这个脚本是给历史数据一次性回填、或者本地先看效果用的。
 *
 * 用法:
 *   node scripts/fill-neodb-briefs.mjs            # 补齐所有缺简介的条目
 *   node scripts/fill-neodb-briefs.mjs --limit 20 # 只补前 20 条（试跑）
 *   node scripts/fill-neodb-briefs.mjs --dry-run  # 只报告，不写盘
 *
 * 走 NeoDB 公开条目接口，不需要 NEODB_TOKEN。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichBriefs } from './lib/sources/neodb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'src', 'data', 'neodb.json');
const apiBase = (process.env.NEODB_API_URL || 'https://neodb.social/api').replace(/\/$/, '');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 0;

const fetchJson = async (url, options = {}, timeout = 20000) => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    return response.json();
};

const payload = JSON.parse(readFileSync(FILE, 'utf8'));
const marks = Array.isArray(payload.data) ? payload.data : [];

// 只处理「没有短评、也还没有简介」的条目；enrichBriefs 自己也会再筛一次。
const targets = marks.filter((mark) => !String(mark?.comment_text ?? '').trim() && mark?.item?.uuid && !mark.item.brief);
const scoped = limit > 0 ? targets.slice(0, limit) : targets;

console.log(`没有短评的条目 ${targets.length} 条，本次处理 ${scoped.length} 条${dryRun ? '（dry-run）' : ''}`);

const filled = await enrichBriefs(scoped, { apiBase, fetchJson, log: console.log });

if (!dryRun && filled > 0) {
    writeFileSync(FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`已写回 ${path.relative(ROOT, FILE)}（本次补上 ${filled} 条）`);
} else {
    console.log(`本次补上 ${filled} 条，未写盘`);
}
