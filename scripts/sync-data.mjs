#!/usr/bin/env node
/**
 * 数据同步脚本：从各外部源拉取数据，落地为 src/data/*.json
 * 供 Astro 构建时离线读取（零运行时网络依赖）。
 *
 * 用法:
 *   node scripts/sync-data.mjs            # 全量同步所有源
 *   node scripts/sync-data.mjs ghost      # 只同步指定源(逗号分隔)
 *   node scripts/sync-data.mjs --dry-run  # 预览将要写入的文件(不写盘)
 *   node scripts/sync-data.mjs --full      # 忽略增量缓存，全量同步
 *
 * 需要环境变量(或 .env 文件): GHOST_API_URL, GHOST_API_KEY,
 *   NEODB_TOKEN, FLUX_URL, FLUX_KEY, MAP_KMZ_URL,
 *   GOTOSOCIAL_URL, GOTOSOCIAL_TOKEN,
 *   MEMOS_PUBLISH_VISIBILITIES（可选，默认 PUBLIC；显式写 PUBLIC,UNLISTED 才会放开未列出）
 *   INTERVALS_ICU_API_KEY, INTERVALS_ICU_ATHLETE_ID
 * 非密钥配置从 src/config/site.ts 读取。
 *
 * intervals 源：每次同步都从 intervals.icu 全量拉取活动（数据量小，按自然年分段请求），
 * 只有轨迹（地图折线）走增量缓存——复用上一版 activities.json 里已有的 polyline，
 * 缺失时才请求 /activity/{id}/map。`--full` 会让轨迹也全部重拉。
 */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIngestSource, listIngestSources, sources as ingestRegistry } from './lib/ingest/registry.mjs';
import { runIngestSource } from './lib/ingest/executor.mjs';

// ---------- 路径 ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');

// ---------- 配置加载 ----------
function loadEnv() {
    const env = {};
    const envFile = path.join(ROOT, '.env');
    if (existsSync(envFile)) {
        const content = readFileSync(envFile, 'utf8');
        for (const line of content.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
    }
    // 进程环境变量优先
    for (const [k, v] of Object.entries(process.env)) {
        if ((k.startsWith('GHOST_') || k.startsWith('NEODB_') || k.startsWith('FLUX_') || k.startsWith('MAP_') || k.startsWith('CDN_') || k.startsWith('INTERVALS_') || k.startsWith('GOTOSOCIAL_') || k.startsWith('MEMOS_') || k.startsWith('MODU_') || k.startsWith('EMBY_')) && v !== undefined && v !== '') {
            env[k] = v;
        }
    }
    return env;
}

// 读取 site 配置中的非密钥项
async function loadSiteConfig() {
    try {
        const mod = await import(path.join(ROOT, 'src/config/site.ts'));
        return mod.siteConfig;
    } catch (e) {
        console.warn('[config] 无法读取 site.ts，使用默认值:', e.message);
        return {
            memos: { url: 'https://m2m.996288.xyz/api/v1/memo', siteURL: 'https://m2m.996288.xyz' }
        };
    }
}

// ---------- 工具 ----------
async function fetchJson(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// 直连订阅源时使用的 UA（部分站点会拦截默认的 Node UA）。
// 读取已有 JSON 作为本次同步的状态/缓存；缺失或损坏时返回 fallback。
function readJson(filename, fallback) {
    const filepath = path.join(DATA_DIR, filename);
    if (!existsSync(filepath)) return fallback;
    try {
        return JSON.parse(readFileSync(filepath, 'utf8'));
    } catch (e) {
        console.warn(`[cache] 读取 ${filename} 失败，将从空状态开始: ${e.message}`);
        return fallback;
    }
}

// 写入 JSON（带增量比较，不变则不写；默认空数组不覆盖已有非空数据）
async function writeJson(filename, data, options = {}) {
    const filepath = path.join(DATA_DIR, filename);
    const json = JSON.stringify(data, null, 2) + '\n';

    // 空数组保护：若新数据为空且已有非空数据，保留旧数据避免覆盖。
    // 派生数据（如 flux-lost.json，空数组是合法结果）可用 allowEmpty 关闭保护。
    const isEmpty = Array.isArray(data) ? data.length === 0 : data === null || (data && typeof data === 'object' && Object.keys(data).length === 0);
    if (!options.allowEmpty && isEmpty && existsSync(filepath)) {
        const existing = readFileSync(filepath, 'utf8');
        const existingTrimmed = existing.trim();
        if (existingTrimmed.length > 2) { // 非空 JSON（至少 '[]' 或 '{}' 之外有内容）
            console.log(`[keep] ${filename} 新数据为空，保留已有非空数据`);
            return false;
        }
    }

    if (existsSync(filepath)) {
        const existing = readFileSync(filepath, 'utf8');
        if (existing === json) {
            console.log(`[skip] ${filename} 无变化`);
            return false;
        }
    }
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(filepath, json, 'utf8');
    console.log(`[write] ${filename} (${(json.length / 1024).toFixed(1)} KB)`);
    return true;
}

// ---------- 字段白名单 ----------
// 只在 JSON 中保留这些字段，控制体积；上游全量拉取后裁剪。
// 启用新字段：往对应白名单加字段名，重跑同步即可（可逆）。

async function syncRank() {
    try {
        return await fetchJson('https://divine-cell-831a.me-d1b.workers.dev/', {}, 10000);
    } catch (e) {
        console.warn('[rank] 获取失败:', e.message);
        return null;
    }
}

// 兼容导出：memos 已迁到模块层（scripts/lib/sources/memos.mjs），
// 这两个函数仍被 tests/scripts/privacy.test.ts 直接引用，所以保持同名转发。
export { gtsStatusToMemo, trimMemos } from './lib/sources/memos.mjs';

// ---------- 主流程 ----------
const SOURCES = {
    rank: { run: () => syncRank(), file: 'rank.json' },
    // emby / imagemeta 已迁到模块层（scripts/lib/sources/ + registry.mjs），由执行器统一校验与写盘。
};

/**
 * 源失败的分类：可选源失败只告警（返回 'warn'），其余源硬失败（返回 'fail'）。
 * 供 main() 使用，也方便单测直接验。
 */
export function classifyFailure(name, sources = SOURCES) {
    if (sources[name]?.optional) return 'warn';
    if (isIngestSource(name) && ingestRegistry[name]?.optional) return 'warn';
    return 'fail';
}

/**
 * 跑一批源，返回 { changed, failed, warnings }。
 * - 可选源抛错：计 warnings，不计 failed，已写的产物不动（不写空、不清理）。
 * - 其它源抛错：计 failed，行为与以前一致。
 */
export async function runSources(sources, ctx = {}) {
    const { env = {}, site = null, dryRun = false, write = null, log = console } = ctx;
    let changed = 0;
    let failed = 0;
    let exitCode = 0;
    const warnings = [];
    for (const name of sources) {
        // 模块化来源：执行器负责校验、原子写与状态；这里只汇总结果。
        if (isIngestSource(name)) {
            try {
                const result = await runIngestSource(name, { env, log, projectRoot: ROOT, dryRun });
                changed += result.changed;
            } catch (e) {
                if (e?.code === 'lock') exitCode = 2;
                if (classifyFailure(name) === 'warn') {
                    warnings.push(`${name}: ${e.message}`);
                    log.warn(`[${name}] 可选源同步失败，已跳过（保留现有数据）: ${e.message}`);
                } else {
                    failed++;
                    log.error(`[${name}] 同步失败: ${e.message}`);
                }
            }
            continue;
        }
        const src = SOURCES[name];
        try {
            const data = await src.run(env, site);
            const outputs = sourceFiles(src, data);
            if (dryRun) {
                for (const output of outputs) {
                    log.log(`[dry-run] ${output.file} 将写入 ${Array.isArray(output.data) ? output.data.length : Object.keys(output.data).length} 项`);
                }
            } else {
                for (const output of outputs) {
                    const wrote = write ? await write(output.file, output.data, { allowEmpty: output.allowEmpty }) : false;
                    if (wrote) changed++;
                }
            }
        } catch (e) {
            if (classifyFailure(name) === 'warn') {
                warnings.push(`${name}: ${e.message}`);
                log.warn(`[${name}] 可选源同步失败，已跳过（保留现有数据）: ${e.message}`);
            } else {
                failed++;
                log.error(`[${name}] 同步失败: ${e.message}`);
            }
        }
    }
    return { changed, failed, warnings, exitCode };
}

function sourceFiles(src, data) {
    return typeof src.files === 'function' ? src.files(data) : [{ file: src.file, data }];
}

// 仅在直接执行时跑主流程；被 import（单测 / 其它脚本）时不跑，避免副作用。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fullSync = args.includes('--full') || process.env.SYNC_FULL === '1';
const only = args.filter((a) => !a.startsWith('--'));

async function main() {
    const env = loadEnv();
    env.SYNC_FULL = fullSync ? '1' : '0';
    const site = await loadSiteConfig();

    const known = [...Object.keys(SOURCES), ...listIngestSources()];
    const sources = only.length ? only.filter((s) => known.includes(s)) : known;
    if (only.length && sources.length !== only.length) {
        console.warn('未知源:', only.filter((s) => !known.includes(s)).join(', '), '（可用:', known.join(','), '）');
    }

    console.log(`开始同步 [${sources.join(', ')}]${dryRun ? ' (dry-run)' : ''}${fullSync ? ' (full)' : ' (incremental)'}`);

    const run = await runSources(sources, { env, site, dryRun, write: writeJson });
    for (const w of run.warnings) console.warn(`[warn] 可选源 ${w}`);

    console.log(dryRun ? 'dry-run 完成（未写盘）' : `同步完成，${run.changed} 个文件有变化`);
    return { failed: run.failed, exitCode: run.exitCode };
}

if (isMain) main().then(({ failed, exitCode }) => {
    if (exitCode) {
        console.error(`同步被并发锁拦截，退出码 ${exitCode}`);
        process.exit(exitCode);
    }
    if (failed > 0) {
        console.error(`同步完成，${failed} 个源失败`);
        process.exit(1);
    }
    console.log('同步完成，无硬失败源');
}).catch((e) => {
    console.error('脚本异常:', e);
    process.exit(1);
});
