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
import { applyRouteCache, pendingRouteIds, polylineFromMap, sortActivities, toActivity, yearWindows } from '../src/lib/intervals.ts';
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

// ---------- intervals.icu（运动记录） ----------
const INTERVALS_BASE = 'https://intervals.icu/api/v1';
// 从这一年开始拉取活动；更早的活动即使账号里有也不会出现在页面上。
const INTERVALS_FIRST_YEAR = 2015;
const INTERVALS_ACTIVITY_FIELDS =
    'id,name,type,sub_type,start_date,start_date_local,distance,moving_time,elapsed_time,average_heartrate,average_speed,total_elevation_gain,source,external_id';
// 地图请求用小并发，避免被上游限流；单个失败只 warn，不中断整次同步。
const ROUTE_CONCURRENCY = 5;

/** 拉取单个活动的轨迹；返回 { polyline } 或 { error }，两者都没有表示上游确实没有 GPS 数据。 */
async function fetchIntervalsMap(id, authorization) {
    try {
        const data = await fetchJson(`${INTERVALS_BASE}/activity/${encodeURIComponent(id)}/map`, { headers: { Authorization: authorization } }, 20000);
        return { polyline: polylineFromMap(data) };
    } catch (error) {
        console.warn(`[intervals] 活动 ${id} 地图获取失败: ${error.message}`);
        return { error: error.message };
    }
}

/**
 * 运动记录同步：数据源只有 intervals.icu。
 * 1) 按自然年窗口全量拉取活动（每窗口 limit=500，按 id 去重）；
 * 2) 用上一版 activities.json 的轨迹做增量缓存，只有缺失轨迹（且距离 > 0）的活动才请求 /map；
 * 3) 按 start_date_local 升序输出 Activities 契约数组。
 */
async function syncIntervals(env) {
    const apiKey = env.INTERVALS_ICU_API_KEY;
    if (!apiKey) throw new Error('缺少 INTERVALS_ICU_API_KEY');
    const athleteId = env.INTERVALS_ICU_ATHLETE_ID || '0';
    const fullSync = env.SYNC_FULL === '1';
    const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;

    const rawById = new Map();
    const windowSummary = [];
    let rawTotal = 0;
    const thisYear = new Date().getUTCFullYear();
    for (const { oldest, newest } of yearWindows(INTERVALS_FIRST_YEAR, thisYear)) {
        const params = new URLSearchParams({ oldest, newest, limit: '500', fields: INTERVALS_ACTIVITY_FIELDS });
        const url = `${INTERVALS_BASE}/athlete/${encodeURIComponent(athleteId)}/activities?${params}`;
        const data = await fetchJson(url, { headers: { Authorization: authorization } }, 30000);
        if (!Array.isArray(data)) throw new Error(`[intervals] ${oldest} ~ ${newest} 返回了非数组活动数据`);
        if (data.length >= 500) console.warn(`[intervals] ${oldest} ~ ${newest} 达到单次 500 条上限，可能有活动被截断`);
        for (const activity of data) {
            if (activity?.id) rawById.set(String(activity.id), activity);
        }
        rawTotal += data.length;
        windowSummary.push(`${oldest.slice(0, 4)}:${data.length}`);
    }
    // 空结果多半是认证/上游异常：拒绝写入，避免用空数组覆盖线上数据。
    if (rawById.size === 0) throw new Error('[intervals] intervals.icu 返回 0 条活动，拒绝覆盖已有数据');
    console.log(`[intervals] 分年拉取 ${windowSummary.join(' ')} → 合计 ${rawTotal} 条，按 id 去重后 ${rawById.size} 条`);
    if (rawTotal !== rawById.size) console.warn(`[intervals] 分年窗口有 ${rawTotal - rawById.size} 条重复活动（已按 id 去重）`);

    const cachedRoutes = new Map(
        readJson('activities.json', [])
            .filter((item) => item?.id && typeof item.polyline === 'string' && item.polyline.length > 0)
            .map((item) => [String(item.id), item.polyline])
    );
    const activities = applyRouteCache(
        [...rawById.values()].map((activity) => toActivity(activity)),
        cachedRoutes,
        fullSync
    );
    const total = activities.length;
    const reused = activities.filter((activity) => activity.polyline).length;

    const pending = pendingRouteIds(activities);
    const byId = new Map(activities.map((activity) => [activity.id, activity]));
    let fetched = 0;
    let empty = 0;
    let failed = 0;
    for (let index = 0; index < pending.length; index += ROUTE_CONCURRENCY) {
        const batch = pending.slice(index, index + ROUTE_CONCURRENCY);
        const results = await Promise.all(batch.map(async (id) => ({ id, ...(await fetchIntervalsMap(id, authorization)) })));
        for (const result of results) {
            if (result.polyline) {
                byId.get(result.id).polyline = result.polyline;
                fetched += 1;
            } else if (result.error) {
                failed += 1;
            } else {
                // 上游这条活动本身没有 GPS（室内跑步/器械等），不算失败，下次同步也拉不到。
                empty += 1;
            }
        }
        if (pending.length > ROUTE_CONCURRENCY) console.log(`[intervals] 轨迹进度 ${Math.min(index + batch.length, pending.length)}/${pending.length}`);
    }

    const withRoute = activities.filter((activity) => activity.polyline).length;
    console.log(
        `[intervals] 活动 ${total} 条（${fullSync ? '全量' : '全量活动 + 增量轨迹'}），复用轨迹 ${reused} 条，新拉轨迹 ${fetched} 条，上游无轨迹 ${empty} 条，失败 ${failed} 条，有轨迹 ${withRoute} 条`
    );
    return sortActivities(activities);
}

async function syncMap(env) {
    if (!env.MAP_KMZ_URL) throw new Error('缺少 MAP_KMZ_URL，无法同步地图数据');

    const outputFile = path.join(DATA_DIR, 'geojson.json');
    const headers = { 'User-Agent': 'astro-book-map-sync' };
    if (env.SYNC_FULL !== '1' && existsSync(outputFile)) headers['If-Modified-Since'] = statSync(outputFile).mtime.toUTCString();

    const response = await fetch(env.MAP_KMZ_URL, {
        signal: AbortSignal.timeout(30000),
        headers
    });
    if (response.status === 304 && existsSync(outputFile)) {
        console.log('[map] 未修改，复用本地 geojson.json');
        return JSON.parse(readFileSync(outputFile, 'utf8'));
    }
    if (!response.ok) throw new Error(`[map] KMZ 下载失败: HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error('[map] KMZ 文件为空');

    const tempFile = path.join(tmpdir(), `astro-book-map-${Date.now()}.kmz`);
    writeFileSync(tempFile, buffer);
    try {
        execFileSync(process.env.PYTHON || 'python3', [
            path.join(__dirname, 'map', 'convert_kmz_to_geojson.py'),
            tempFile,
            outputFile
        ], { stdio: 'inherit' });
    } finally {
        try {
            if (existsSync(tempFile)) unlinkSync(tempFile);
        } catch {
            // 临时文件清理失败不影响同步结果。
        }
    }

    const geojson = JSON.parse(readFileSync(outputFile, 'utf8'));
    if (!Array.isArray(geojson.features)) throw new Error('[map] 转换结果缺少 features');
    return geojson;
}

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
    intervals: { run: (env) => syncIntervals(env), file: 'activities.json' },
    map: { run: (env) => syncMap(env), file: 'geojson.json' },
    rank: { run: () => syncRank(), file: 'rank.json' },
    // reading：modureader 的 WebDAV 分片库，聚合/清洗在 src/lib/reading.ts 与 scripts/lib/book-title.mjs
    // optional：外部自建服务（NAS 上的 WebDAV）。它打吨时不应该把整轮定时任务 / 发布拖下水，
    // 失败只告警并保留已有 reading.json。
    reading: { run: (env) => import('./sync-reading.mjs').then((m) => m.syncReading(env)), file: 'reading.json', optional: true }
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
