#!/usr/bin/env node
/**
 * 把「Strava 导出」里 intervals.icu 缺失的活动导入 intervals.icu。
 *
 * 导出目录来自 Strava 的「请求你的存档」：activities.csv + activities/<id>.fit.gz|.tcx.gz。
 * 脚本按开始时间（UTC，默认 ±5 分钟）把导出记录和 intervals.icu 现有活动对齐，
 * 只上传真正缺失的那些，并用 external_id `strava:<活动ID>` 做幂等标记。
 *
 * 用法:
 *   node scripts/import-strava-export.mjs <导出目录> --dry-run          # 只匹配、只报告，不写远端
 *   node scripts/import-strava-export.mjs <导出目录>                    # 上传缺失活动并校验
 *   node scripts/import-strava-export.mjs <导出目录> --only=<活动ID,...> # 只处理指定 Strava 活动 ID（或文件名编号）
 *   node scripts/import-strava-export.mjs <导出目录> --expect-missing=12 # 缺失条数与预期不符则拒绝上传
 *   node scripts/import-strava-export.mjs <导出目录> --fix-type          # 上传后自动识别的 type 与 CSV 映射不一致时用 PUT 纠正
 *
 * 参数:
 *   --dry-run              只做匹配与报告，不发任何写请求
 *   --only=<id,id>         只对指定 Strava 活动 ID 执行上传（排查/补漏用；也接受导出文件名里的编号）
 *   --expect-missing=<n>   缺失条数不等于 n 时中止（门禁，防止误传）
 *   --window=<分钟>        时间匹配窗口，默认 5
 *   --verify-delay=<毫秒>  上传完成后等待多久再回查列表，默认 2000（intervals 解析是异步的）
 *   --fix-type             上传后 type 家族不一致时用 PUT 纠正（默认只报告，不擅自改）
 *   --verbose              打印已匹配的全部记录
 *   --help                 显示帮助
 *
 * 需要环境变量（或仓库根目录 .env）: INTERVALS_ICU_API_KEY, INTERVALS_ICU_ATHLETE_ID
 *
 * 退出码: 0 成功 / 1 用法或配置错误 / 2 匹配门禁失败（有歧义或条数不符）/ 3 上传失败 / 4 上传后校验失败
 *
 * 注意:
 *   - API key 只用于 Authorization 请求头，任何日志都不打印它。
 *   - intervals.icu 按文件内容 hash 去重，Strava 导出文件与其它 App 的文件 hash 不同，
 *     所以「只上传时间上确实缺失的活动」是唯一可靠的防重手段，不能依赖服务端去重兜底。
 *   - 上传串行执行，429/5xx 退避后重试一次。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const API_BASE = 'https://intervals.icu';

// ---------- 配置加载 ----------

/** 与 scripts/sync-data.mjs 的 loadEnv 保持一致：进程环境变量优先，其次 .env */
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
    for (const key of ['INTERVALS_ICU_API_KEY', 'INTERVALS_ICU_ATHLETE_ID']) {
        const value = process.env[key];
        if (value !== undefined && value !== '') env[key] = value;
    }
    return env;
}

// ---------- 参数 ----------

const USAGE = `用法: node scripts/import-strava-export.mjs <导出目录> [--dry-run] [--only=<活动ID,...>] [--expect-missing=<n>]
                                        [--window=<分钟>] [--verify-delay=<毫秒>] [--fix-type] [--verbose]

  --dry-run              只匹配与报告，不发写请求
  --only=<id,id>         只上传指定 Strava 活动 ID（也接受文件名里的编号）
  --expect-missing=<n>   缺失条数不等于 n 时中止
  --window=<分钟>        时间匹配窗口，默认 5
  --verify-delay=<毫秒>  上传后回查前的等待时间，默认 2000
  --fix-type             上传后 type 家族不一致时用 PUT 纠正
  --verbose              打印已匹配记录
  --help                 显示帮助`;

function parseArgs(argv) {
    const options = {
        exportDir: '',
        dryRun: false,
        only: null,
        expectMissing: null,
        windowMinutes: 5,
        verifyDelayMs: 2000,
        fixType: false,
        verbose: false,
        help: false
    };
    for (const arg of argv) {
        if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--fix-type') options.fixType = true;
        else if (arg === '--verbose') options.verbose = true;
        else if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg.startsWith('--only=')) {
            options.only = new Set(
                arg
                    .slice('--only='.length)
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
            );
        } else if (arg.startsWith('--expect-missing=')) {
            options.expectMissing = Number(arg.slice('--expect-missing='.length));
        } else if (arg.startsWith('--window=')) {
            options.windowMinutes = Number(arg.slice('--window='.length));
        } else if (arg.startsWith('--verify-delay=')) {
            options.verifyDelayMs = Number(arg.slice('--verify-delay='.length));
        } else if (arg.startsWith('-')) {
            throw new Error(`未知参数: ${arg}`);
        } else if (!options.exportDir) {
            options.exportDir = arg;
        } else {
            throw new Error(`多余的参数: ${arg}`);
        }
    }
    if (!options.help) {
        if (!options.exportDir) throw new Error('缺少导出目录参数');
        if (!Number.isFinite(options.windowMinutes) || options.windowMinutes <= 0) throw new Error('--window 必须是正数');
        if (!Number.isFinite(options.verifyDelayMs) || options.verifyDelayMs < 0) throw new Error('--verify-delay 必须是非负数');
        if (options.expectMissing !== null && !Number.isInteger(options.expectMissing)) throw new Error('--expect-missing 必须是整数');
    }
    return options;
}

// ---------- CSV 解析 ----------

/**
 * Strava 导出的 CSV：UTF-8 BOM、字段含引号与换行、并且有重名列（例如「距离」「全程耗时」各出现两次）。
 * 所以按「列位置」取值，不用对象键。
 */
function parseCsv(text) {
    let source = text;
    if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < source.length; i += 1) {
        const c = source[i];
        if (inQuotes) {
            if (c === '"') {
                if (source[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
            continue;
        }
        if (c === '"') inQuotes = true;
        else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (c !== '\r') {
            field += c;
        }
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

/**
 * 「活动日期」是 UTC 墙上时间，形如 `2024年3月11日 23:05:55`（不是本地时间，不加时区偏移）。
 */
function parseActivityDate(value) {
    const text = String(value || '').trim();
    const zh = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (zh) {
        const [y, mo, d, h, mi, se] = [zh[1], zh[2], zh[3], zh[4], zh[5], zh[6] || '0'].map(Number);
        return Date.UTC(y, mo - 1, d, h, mi, se);
    }
    // 兼容 ISO / `YYYY-MM-DD HH:mm:ss`（无时区视为 UTC）
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) {
        const [y, mo, d, h, mi, se] = [iso[1], iso[2], iso[3], iso[4] || '0', iso[5] || '0', iso[6] || '0'].map(Number);
        return Date.UTC(y, mo - 1, d, h, mi, se);
    }
    return null;
}

function readExportRecords(exportDir) {
    const csvPath = path.join(exportDir, 'activities.csv');
    if (!existsSync(csvPath)) throw new Error(`找不到 ${csvPath}，请确认导出目录`);
    const rows = parseCsv(readFileSync(csvPath, 'utf8'));
    const header = rows[0] || [];
    // 重名列取「第 N 次出现」的列位置
    const columnIndex = (name, occurrence = 0) => {
        let seen = 0;
        for (let i = 0; i < header.length; i += 1) {
            if (header[i] !== name) continue;
            if (seen === occurrence) return i;
            seen += 1;
        }
        return -1;
    };
    const idCol = columnIndex('活动 ID');
    const dateCol = columnIndex('活动日期');
    const nameCol = columnIndex('活动名称');
    const typeCol = columnIndex('活动类型');
    const fileCol = columnIndex('文件名');
    const distanceCol = columnIndex('距离', 1) >= 0 ? columnIndex('距离', 1) : columnIndex('距离', 0);
    for (const [label, index] of [
        ['活动 ID', idCol],
        ['活动日期', dateCol],
        ['活动类型', typeCol],
        ['文件名', fileCol]
    ]) {
        if (index < 0) throw new Error(`CSV 缺少「${label}」列，可能不是 Strava 导出`);
    }

    const records = [];
    for (let line = 1; line < rows.length; line += 1) {
        const row = rows[line];
        const id = String(row[idCol] || '').trim();
        if (!id) continue;
        const fileName = String(row[fileCol] || '').trim();
        const startUtc = parseActivityDate(row[dateCol]);
        const distanceRaw = String(row[distanceCol] || '').trim();
        records.push({
            id,
            // 「活动 ID」列是 Strava 活动 ID，文件名里的数字可能不同（例如由其它 App 上传的活动），
            // 两者都记下来，方便排查与 --only 匹配。
            fileId: (path.basename(fileName).match(/^(\d+)\./) || [])[1] || '',
            name: String(row[nameCol] || '').trim() || `Strava ${id}`,
            typeZh: String(row[typeCol] || '').trim(),
            startUtc,
            startIso: startUtc === null ? '' : new Date(startUtc).toISOString(),
            distance: distanceRaw === '' ? null : Number(distanceRaw),
            fileName,
            filePath: fileName ? path.join(exportDir, fileName) : '',
            rawDate: String(row[dateCol] || '').trim()
        });
    }
    return records;
}

// ---------- 运动类型映射 ----------

/** Strava 导出里的中文运动类型 → intervals.icu 的 type 值 */
const CSV_TYPE_MAP = {
    跑步: 'Run',
    骑行: 'Ride',
    健走: 'Walk',
    远足: 'Hike',
    徒步: 'Hike',
    锻炼: 'Workout',
    攀岩: 'RockClimbing',
    举重训练: 'WeightTraining',
    游泳: 'Swim',
    划船: 'Rowing',
    滑雪: 'AlpineSki',
    越野滑雪: 'NordicSki',
    单板滑雪: 'Snowboard',
    滑冰: 'IceSkate',
    椭圆机: 'Elliptical'
};

/** 运动家族：只用来判断「这是不是同一类运动」，避免把运行记录匹配到同时间点的骑行上 */
function sportFamily(type) {
    const value = String(type || '').toLowerCase();
    if (!value) return 'Other';
    if (/rockclimb|climb|boulder|攀岩/.test(value)) return 'Climb';
    if (/^(run|virtualrun|trailrun)$/.test(value) || /run|跑步/.test(value)) return 'Run';
    if (/ride|bike|cycling|骑行/.test(value)) return 'Ride';
    if (/^(hike|hiking)$/.test(value) || /hike|远足/.test(value)) return 'Hike';
    if (/^(walk|walking)$/.test(value) || /walk|健走/.test(value)) return 'Walk';
    return 'Other';
}

function toIntervalsType(csvType) {
    const key = String(csvType || '').trim();
    return CSV_TYPE_MAP[key] || key || 'Workout';
}

// ---------- intervals.icu API ----------

class HttpError extends Error {
    constructor(status, body, url) {
        super(`HTTP ${status} ${url}`);
        this.status = status;
        this.body = body;
    }
}

function createClient(env) {
    const apiKey = env.INTERVALS_ICU_API_KEY;
    if (!apiKey) throw new Error('缺少 INTERVALS_ICU_API_KEY（写在 .env 或进程环境变量里）');
    const athleteId = env.INTERVALS_ICU_ATHLETE_ID;
    if (!athleteId) throw new Error('缺少 INTERVALS_ICU_ATHLETE_ID（形如 i779222）');
    const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;

    async function request(url, init = {}) {
        const response = await fetch(url, {
            ...init,
            headers: { Authorization: authorization, ...(init.headers || {}) },
            signal: AbortSignal.timeout(120000)
        });
        const text = await response.text();
        return { status: response.status, ok: response.ok, headers: response.headers, text };
    }

    async function listActivities() {
        const params = new URLSearchParams({
            oldest: '2000-01-01',
            newest: '2030-01-01',
            limit: '500',
            fields: 'id,name,type,start_date,start_date_local,distance,external_id,source'
        });
        const url = `${API_BASE}/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?${params}`;
        const response = await request(url);
        if (!response.ok) throw new HttpError(response.status, response.text, url);
        const data = JSON.parse(response.text);
        if (!Array.isArray(data)) throw new Error('intervals.icu 返回了非数组活动列表');
        if (data.length >= 500) console.warn('[warn] 活动数达到 limit=500，列表可能被截断');
        return data;
    }

    /** 上传活动文件：multipart/form-data，文件字段名 file，名称与 external_id 走 query */
    async function uploadActivity({ filePath, fileName, name, externalId }) {
        const buffer = readFileSync(filePath);
        const form = new FormData();
        form.append('file', new Blob([buffer]), path.basename(fileName || filePath));
        const params = new URLSearchParams({ name, external_id: externalId });
        const url = `${API_BASE}/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?${params}`;
        return request(url, { method: 'POST', body: form });
    }

    async function getActivity(id) {
        const url = `${API_BASE}/api/v1/activity/${encodeURIComponent(id)}`;
        const response = await request(url);
        if (!response.ok) throw new HttpError(response.status, response.text, url);
        return JSON.parse(response.text);
    }

    async function updateActivity(id, activity) {
        const url = `${API_BASE}/api/v1/activity/${encodeURIComponent(id)}`;
        const response = await request(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(activity)
        });
        if (!response.ok) throw new HttpError(response.status, response.text, url);
        return response;
    }

    return { athleteId, listActivities, uploadActivity, getActivity, updateActivity };
}

// ---------- 输出 ----------

/** 中日韩字符按 2 个终端宽度计算，保证表格对齐 */
function displayWidth(text) {
    let width = 0;
    for (const char of String(text)) {
        const code = char.codePointAt(0);
        width +=
            code >= 0x1100 &&
            (code <= 0x115f ||
                (code >= 0x2e80 && code <= 0xa4cf) ||
                (code >= 0xac00 && code <= 0xd7a3) ||
                (code >= 0xf900 && code <= 0xfaff) ||
                (code >= 0xfe30 && code <= 0xfe6f) ||
                (code >= 0xff00 && code <= 0xff60) ||
                (code >= 0xffe0 && code <= 0xffe6))
                ? 2
                : 1;
    }
    return width;
}

function pad(text, width) {
    const value = String(text ?? '');
    return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

function printTable(headers, rows) {
    const widths = headers.map((header, index) => Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[index]))));
    console.log(widths.map((width, index) => pad(headers[index], width)).join('  '));
    console.log(widths.map((width) => '-'.repeat(width)).join('  '));
    for (const row of rows) console.log(widths.map((width, index) => pad(row[index], width)).join('  '));
}

function formatDistance(metres) {
    if (metres === null || metres === undefined || Number.isNaN(metres)) return '-';
    return `${(Number(metres) / 1000).toFixed(2)}km`;
}

function truncate(text, max = 400) {
    const value = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

// ---------- 匹配 ----------

/**
 * 把导出记录与 intervals.icu 现有活动对齐，分成四类：
 *   matched          时间与运动家族都命中：已经存在，跳过
 *   matchedTypeDiff  时间命中但家族不同（例如 CSV 记「攀岩」、intervals 记 Hike）：仍视为已存在，只报告
 *   ambiguous        时间窗口内有多条同家族候选：不猜，交给人工/--only
 *   missing          整个时间窗口都没有活动：需要导入
 */
function matchRecords(records, activities, windowMinutes) {
    const windowMs = windowMinutes * 60 * 1000;
    const byExternalId = new Map();
    for (const activity of activities) {
        const externalId = String(activity.external_id || '').trim();
        if (externalId) byExternalId.set(externalId, activity);
    }

    const matched = [];
    const matchedTypeDiff = [];
    const ambiguous = [];
    const missing = [];

    for (const record of records) {
        const item = { ...record, expectedType: toIntervalsType(record.typeZh) };
        if (record.startUtc === null) {
            ambiguous.push({ ...item, reason: '日期无法解析' });
            continue;
        }
        const imported = byExternalId.get(`strava:${record.id}`);
        if (imported) {
            matched.push({ ...item, activity: imported, note: 'external_id 已存在' });
            continue;
        }
        const candidates = activities.filter((activity) => {
            const started = Date.parse(activity.start_date || activity.start_date_local || '');
            return Number.isFinite(started) && Math.abs(started - record.startUtc) <= windowMs;
        });
        if (candidates.length === 0) {
            missing.push(item);
            continue;
        }
        const sameFamily = candidates.filter((activity) => sportFamily(activity.type) === sportFamily(item.expectedType));
        if (sameFamily.length === 1) {
            matched.push({ ...item, activity: sameFamily[0] });
        } else if (sameFamily.length > 1) {
            ambiguous.push({ ...item, reason: `${sameFamily.length} 条同家族候选`, candidates: sameFamily });
        } else if (candidates.length === 1) {
            matchedTypeDiff.push({ ...item, activity: candidates[0] });
        } else {
            ambiguous.push({ ...item, reason: `${candidates.length} 条候选但家族都不同`, candidates });
        }
    }

    return { matched, matchedTypeDiff, ambiguous, missing };
}

// ---------- 上传 ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(status) {
    return status === 429 || status >= 500;
}

/** 单条上传：429/5xx 退避后重试一次；其它错误直接抛 */
async function uploadWithRetry(client, record, attemptLimit = 2) {
    let last = null;
    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
        const startedAt = Date.now();
        let response;
        try {
            response = await client.uploadActivity({
                filePath: record.filePath,
                fileName: record.fileName,
                name: record.name,
                externalId: `strava:${record.id}`
            });
        } catch (error) {
            if (attempt >= attemptLimit) throw new Error(`上传 ${record.id} 网络错误: ${error.message}`);
            await sleep(2000 * attempt);
            continue;
        }
        last = { ...response, durationMs: Date.now() - startedAt };
        if (response.ok) return last;
        if (isRetryable(response.status) && attempt < attemptLimit) {
            const retryAfter = Number(response.headers.get('retry-after'));
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * attempt;
            console.log(`      ${record.id}: HTTP ${response.status}，${Math.round(waitMs / 1000)}s 后重试`);
            await sleep(waitMs);
            continue;
        }
        return last;
    }
    return last;
}

function parseUploadBody(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// ---------- 主流程 ----------

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(USAGE);
        return 0;
    }

    const exportDir = path.resolve(options.exportDir);
    if (!existsSync(exportDir)) throw new Error(`导出目录不存在: ${exportDir}`);

    const env = loadEnv();
    const client = createClient(env);

    const records = readExportRecords(exportDir);
    console.log(`[1/5] 读取导出: ${records.length} 条活动（${path.join(exportDir, 'activities.csv')}）`);
    const noDate = records.filter((record) => record.startUtc === null);
    const noFile = records.filter((record) => !record.filePath || !existsSync(record.filePath));
    if (noDate.length) console.warn(`[warn] ${noDate.length} 条记录日期无法解析，将列入 ambiguous`);
    if (noFile.length)
        console.warn(
            `[warn] ${noFile.length} 条记录找不到活动文件: ${noFile
                .slice(0, 5)
                .map((record) => record.fileName || record.id)
                .join(', ')}`
        );

    console.log(`[2/5] 拉取 intervals.icu 现有活动…`);
    const activities = await client.listActivities();
    console.log(
        `      athlete=${client.athleteId} 现有 ${activities.length} 条，类型: ${[...new Set(activities.map((activity) => activity.type))].sort().join(', ')}`
    );

    console.log(`[3/5] 按开始时间（UTC ±${options.windowMinutes} 分钟 + 运动家族）匹配…`);
    const result = matchRecords(records, activities, options.windowMinutes);

    // --only 同时接受 Strava 活动 ID（CSV「活动 ID」列）和导出文件名里的编号，避免两种 ID 混淆
    const matchesOnly = (record) => options.only.has(record.id) || (!!record.fileId && options.only.has(record.fileId));
    let uploadable = result.missing;
    if (options.only) uploadable = uploadable.filter(matchesOnly);
    if (options.only) {
        const knownIds = new Set(records.flatMap((record) => [record.id, record.fileId].filter(Boolean)));
        const unknown = [...options.only].filter((id) => !knownIds.has(id));
        if (unknown.length) console.warn(`[warn] --only 里的活动 ID 不在导出中: ${unknown.join(', ')}`);
    }

    console.log('');
    printTable(
        ['匹配结果', '条数', '说明'],
        [
            ['matched', result.matched.length, '已存在（时间 + 家族命中，或 external_id 已存在）'],
            ['matchedTypeDiff', result.matchedTypeDiff.length, '时间命中但运动家族不同，视为已存在、不上传'],
            ['ambiguous', result.ambiguous.length, '窗口内多条候选，不猜测'],
            ['missing', result.missing.length, 'intervals.icu 缺失，需要上传'],
            ['待上传', uploadable.length, options.only ? `受 --only 限制（${[...options.only].join(', ')}）` : options.dryRun ? 'dry-run 不写远端' : '']
        ]
    );

    if (result.matchedTypeDiff.length) {
        console.log('\n类型不同但时间一致的记录（已存在，不动它们）:');
        printTable(
            ['导出时间(UTC)', 'CSV 类型', '导出距离', 'intervals ID', 'intervals 类型'],
            result.matchedTypeDiff
                .sort((a, b) => a.startUtc - b.startUtc)
                .map((record) => [
                    record.startIso,
                    `${record.typeZh} → ${record.expectedType}`,
                    formatDistance(record.distance),
                    record.activity.id,
                    record.activity.type || '-'
                ])
        );
    }

    if (result.ambiguous.length) {
        console.log('\n存在歧义的记录（不处理，请人工确认）:');
        printTable(
            ['导出时间(UTC)', 'CSV 类型', '导出距离', '文件', '原因', '候选'],
            result.ambiguous.map((record) => [
                record.startIso || record.rawDate,
                `${record.typeZh} → ${record.expectedType}`,
                formatDistance(record.distance),
                record.fileName,
                record.reason,
                (record.candidates || []).map((activity) => `${activity.id}/${activity.type}`).join(' ')
            ])
        );
    }

    if (result.missing.length) {
        console.log('\n缺失的活动（按时间排序）:');
        printTable(
            ['#', '导出时间(UTC)', 'Strava ID', 'CSV 类型', '预期 type', '距离', '文件'],
            [...result.missing]
                .sort((a, b) => a.startUtc - b.startUtc)
                .map((record, index) => [
                    index + 1,
                    record.startIso,
                    record.id,
                    record.typeZh,
                    record.expectedType,
                    formatDistance(record.distance),
                    record.fileName
                ])
        );
    }

    if (options.verbose && result.matched.length) {
        console.log('\n已匹配（verbose）:');
        printTable(
            ['导出时间(UTC)', 'CSV 类型', 'intervals ID', 'intervals 类型', '名称'],
            [...result.matched]
                .sort((a, b) => a.startUtc - b.startUtc)
                .map((record) => [record.startIso, record.typeZh, record.activity.id, record.activity.type || '-', record.name])
        );
    }

    // 门禁：有歧义就不上传；--expect-missing 把关缺失条数
    if (result.ambiguous.length > 0) {
        console.error(`\n[中断] ${result.ambiguous.length} 条记录有歧义，拒绝上传。确认后用 --only=<活动ID,...> 精确指定再跑。`);
        return 2;
    }
    if (options.expectMissing !== null && result.missing.length !== options.expectMissing) {
        console.error(`\n[中断] 缺失 ${result.missing.length} 条，与 --expect-missing=${options.expectMissing} 不符，拒绝上传。`);
        return 2;
    }
    for (const record of uploadable) {
        if (!record.filePath || !existsSync(record.filePath)) {
            console.error(`\n[中断] 活动 ${record.id} 的文件不存在: ${record.filePath || '(CSV 为空)'}`);
            return 2;
        }
    }

    if (options.dryRun) {
        console.log(`\n[dry-run] 将上传 ${uploadable.length} 条，未发出任何写请求。`);
        return 0;
    }
    if (uploadable.length === 0) {
        console.log('\n没有需要上传的活动，结束。');
        return 0;
    }

    // 上传（串行）
    console.log(`\n[4/5] 开始串行上传 ${uploadable.length} 条…`);
    const results = [];
    let hardFailure = false;
    for (const [index, record] of [...uploadable].sort((a, b) => a.startUtc - b.startUtc).entries()) {
        const label = `      (${index + 1}/${uploadable.length}) ${record.startIso} ${record.expectedType} ${record.fileName}`;
        console.log(label);
        let response;
        try {
            response = await uploadWithRetry(client, record);
        } catch (error) {
            console.error(`      ✗ ${error.message}`);
            results.push({ record, ok: false, status: 'ERR', error: error.message });
            hardFailure = true;
            break;
        }
        const body = parseUploadBody(response.text);
        const newIds = (body?.activities || []).map((activity) => activity.id).filter(Boolean);
        const created = response.status === 201 && newIds.length > 0;
        if (response.status === 401 || response.status === 403) {
            console.error(`      ✗ 认证失败 HTTP ${response.status}，检查 INTERVALS_ICU_API_KEY 权限。响应: ${truncate(response.text)}`);
            results.push({ record, ok: false, status: response.status, error: response.text });
            hardFailure = true;
            break;
        }
        if (response.status === 200 && newIds.length === 0) {
            console.warn('      ! HTTP 200：文件已被去重（服务端已存在相同内容），未新建活动');
        } else if (!created) {
            console.error(`      ✗ 上传失败 HTTP ${response.status}: ${truncate(response.text)}`);
            results.push({ record, ok: false, status: response.status, error: response.text, body });
            hardFailure = true;
            break;
        }
        const activityId = newIds[0] || body?.id || '';
        console.log(`      ✓ HTTP ${response.status} → ${activityId || '(无 id)'}${newIds.length > 1 ? `（共 ${newIds.length} 条）` : ''}`);
        results.push({ record, ok: true, status: response.status, activityId, newIds, body });
    }

    if (hardFailure) {
        console.error('\n[中断] 上传过程中出错，已停止后续上传。请把上面的原始响应报给负责人。');
        return 3;
    }

    // 校验：重新拉列表
    console.log(`\n[5/5] ${options.verifyDelayMs}ms 后回查列表校验…`);
    await sleep(options.verifyDelayMs);
    const verifyRows = [];
    let verifyFailed = 0;
    let refreshed = await client.listActivities();
    const refreshedAt = new Map(refreshed.map((activity) => [String(activity.id), activity]));
    const refreshedByExternal = new Map();
    for (const activity of refreshed) {
        const externalId = String(activity.external_id || '').trim();
        if (externalId) refreshedByExternal.set(externalId, activity);
    }

    // 上传解析是异步的：type 可能短暂为 null，最多再等 3 轮
    for (let round = 0; round < 3; round += 1) {
        const pending = results.filter((item) => {
            if (!item.ok) return false;
            const found = refreshedAt.get(String(item.activityId)) || refreshedByExternal.get(`strava:${item.record.id}`);
            return !found || !found.type;
        });
        if (!pending.length) break;
        await sleep(2000);
        refreshed = await client.listActivities();
        refreshedAt.clear();
        for (const activity of refreshed) refreshedAt.set(String(activity.id), activity);
        refreshedByExternal.clear();
        for (const activity of refreshed) {
            const externalId = String(activity.external_id || '').trim();
            if (externalId) refreshedByExternal.set(externalId, activity);
        }
    }

    const typeFixes = [];
    for (const item of results) {
        const { record } = item;
        if (!item.ok) {
            verifyRows.push([record.startIso, record.expectedType, '-', '上传失败', '-', '-', '✗']);
            verifyFailed += 1;
            continue;
        }
        const found = refreshedAt.get(String(item.activityId)) || refreshedByExternal.get(`strava:${record.id}`);
        if (!found) {
            verifyRows.push([record.startIso, record.expectedType, item.activityId, '列表里找不到', '-', '-', '✗']);
            verifyFailed += 1;
            continue;
        }
        const started = Date.parse(found.start_date || found.start_date_local || '');
        const deltaMinutes = Number.isFinite(started) ? Math.round((started - record.startUtc) / 60000) : null;
        const familyOk = sportFamily(found.type) === sportFamily(record.expectedType);
        const distanceOk =
            record.distance === null ||
            !Number.isFinite(Number(found.distance)) ||
            record.distance === 0 ||
            Math.abs(Number(found.distance) - record.distance) <= Math.max(50, record.distance * 0.1);
        if (!familyOk) typeFixes.push({ item, found });
        if (deltaMinutes === null || Math.abs(deltaMinutes) > 5 || !familyOk) verifyFailed += 1;
        verifyRows.push([
            record.startIso,
            `${record.typeZh} → ${record.expectedType}`,
            found.id,
            found.type || '-',
            Number.isFinite(Number(found.distance)) ? formatDistance(found.distance) : '-',
            `${deltaMinutes === null ? '?' : `${deltaMinutes > 0 ? '+' : ''}${deltaMinutes}min`}${distanceOk ? '' : ' / 距离偏差'}`,
            familyOk ? (distanceOk ? '✓' : '⚠') : '⚠ 类型'
        ]);
    }

    console.log('');
    printTable(['导出时间(UTC)', 'CSV → 预期', '新 activity id', '最终 type', 'distance', '时间差', '结果'], verifyRows);

    if (typeFixes.length) {
        console.log(`\n类型与 CSV 映射不一致: ${typeFixes.map(({ found }) => `${found.id}=${found.type}`).join(', ')}`);
        if (options.fixType) {
            console.log('按 --fix-type 逐个 PUT 纠正…');
            for (const { item, found } of typeFixes) {
                try {
                    const before = await client.getActivity(found.id);
                    const updated = await client.updateActivity(found.id, { ...before, type: item.record.expectedType });
                    const after = await client.getActivity(found.id);
                    console.log(`      ${found.id}: ${found.type} → ${after.type} (HTTP ${updated.status})`);
                    // 只允许 type 变化，其它关键字段必须还在
                    for (const field of ['start_date', 'distance', 'name']) {
                        if (String(before[field] ?? '') !== String(after[field] ?? ''))
                            console.warn(`      [warn] ${found.id} 的 ${field} 被改动: ${before[field]} → ${after[field]}`);
                    }
                } catch (error) {
                    console.error(`      ✗ 纠正 ${found.id} 的 type 失败: ${error.message}`);
                    verifyFailed += 1;
                }
            }
        } else {
            console.log('（默认不改。确认要纠正时加 --fix-type 重跑，只会 PUT 这些 id。）');
        }
    }

    const createdCount = results.filter((item) => item.ok).length;
    console.log(`\n完成: 上传成功 ${createdCount}/${uploadable.length} 条，校验通过 ${verifyRows.length - verifyFailed}/${verifyRows.length} 条。`);

    if (verifyFailed > 0) {
        console.error('[警告] 有记录未通过校验，请检查上面的表格。');
        return 4;
    }
    return 0;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        if (error instanceof HttpError) {
            console.error(`[错误] ${error.message}`);
            if (error.body) console.error(`       响应: ${truncate(error.body)}`);
        } else {
            console.error(`[错误] ${error.message}`);
        }
        if (/缺少 INTERVALS_|未知参数|多余的参数|缺少导出目录/.test(error.message)) {
            console.error(USAGE);
            process.exitCode = 1;
        } else {
            process.exitCode = 1;
        }
    });
