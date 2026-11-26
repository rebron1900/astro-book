/**
 * 执行器：唯一写盘者。
 *
 * 职责（见 docs/specs/2026-11-26-data-ingest-spec.md §7）：
 *  1. 按 registry 解析来源，加载模块（动态 import，登记表本身无副作用）；
 *  2. 按 meta.credentials 只注入声明的凭据；
 *  3. 调 collect（带超时、dryRun）；
 *  4. 契约校验（版本 / 字段类型 / 主键唯一 / 排序后置条件）；
 *  5. 多输出全部通过后，临时文件 + rename 原子写；失败保留旧数据；
 *  6. 写成功后更新 .cache/sync-state.json；
 *  7. .cache/sync.lock 并发保护；
 *  8. --dry-run 不落盘。
 *
 * 执行器不认识任何具体来源；新增来源只加模块 + registry 一行 + 契约。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { contracts as defaultContracts, getContract } from './contracts.mjs';
import { sources as defaultRegistry } from './registry.mjs';
import { acquireLock, readDatasetFile, readState, recordSuccess } from './state.mjs';
import { declaredSensitiveHeaders, stripSensitiveHeaders } from './sensitive-headers.mjs';
import { validateDataset } from './validate.mjs';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const CREDENTIAL_HINT = /(KEY|TOKEN|PASS|SECRET|COOKIE)/i;
const SENSITIVE_PARAM = /\b(api_key|apikey|token|access_token|X-Emby-Token|Authorization|password|passwd|secret)=([^&\s"']+)/gi;

/** 最多跟随 5 跳；第 6 跳按 upstream 失败（不无限重定向、不静默停在中转地址）。 */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/**
 * 跨源跳转必须剥掉的认证类头。
 * undici 默认只在跨域时丢 Authorization/Cookie，自定义认证头会原样带到新源 ——
 * 所以这里自己跟随跳转并显式判断。判定规则在 sensitive-headers.mjs：
 * 通用模式（含 token/secret/session/api-key 等）> 内置基线 > 来源声明的 meta.sensitiveHeaders。
 */
// 兼容旧导出：历史上执行器只认这几个名字。实际判定走 sensitive-headers 的通用规则。
export const AUTH_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'x-emby-token'];

function makeError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

/** 超时文案：≥ 1s 显示秒，不足 1s 显示毫秒（400ms 不再打印成「0s」）。行为不变，只改文案。 */
function formatTimeout(timeoutMs) {
    return timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${Math.round(timeoutMs)}ms`;
}

/** 日志脱敏：已知密钥值、常见敏感 query 参数一律替换为 ***。 */
export function sanitize(message, secrets = []) {
    let text = String(message ?? '');
    for (const secret of secrets) {
        if (typeof secret === 'string' && secret.length >= 4) text = text.split(secret).join('***');
    }
    return text.replace(SENSITIVE_PARAM, (_match, name) => `${name}=***`);
}

function collectSecrets(env) {
    return Object.entries(env)
        .filter(([key, value]) => CREDENTIAL_HINT.test(key) && typeof value === 'string' && value.length >= 4)
        .map(([, value]) => value);
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, declaredSensitive = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let currentUrl = String(url);
    let headers = headerPairs(options.headers);
    let method = String(options.method || 'GET').toUpperCase();
    let body = options.body;
    try {
        for (let hop = 0; ; hop += 1) {
            // redirect: 'manual' —— 自己跟随，才能逐跳判断是否跨源
            const response = await fetchImpl(currentUrl, { ...options, method, body, headers, redirect: 'manual', signal: controller.signal });
            if (!REDIRECT_STATUS.has(response.status)) return response;
            const location = response.headers?.get?.('location');
            if (!location) return response;
            if (hop >= MAX_REDIRECTS) {
                throw makeError(`重定向超过 ${MAX_REDIRECTS} 跳（${String(currentUrl).split('?')[0]}）`, 'upstream');
            }
            const nextUrl = new URL(location, currentUrl).href;
            // 跨源：剥掉认证类头，其它头（Accept 等）保留 —— 跨域 CDN 跳转取图仍需可用
            if (originOf(nextUrl) !== originOf(currentUrl)) headers = withoutAuthHeaders(headers, declaredSensitive);
            // 303（以及 301/302 下的非 GET/HEAD）改成 GET 并丢弃请求体
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== 'GET' && method !== 'HEAD')) {
                method = 'GET';
                body = undefined;
                headers = headers.filter(([name]) => !/^content-(type|length)$/i.test(name));
            }
            currentUrl = nextUrl;
        }
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 头入参归一成 `[name, value]` 二维数组：同时支持 `Headers` 实例、二维数组、普通对象。
 * 注意先判 Array：数组自带 `entries()`，但返回的是 `[下标, 元素]`，不能当头名用。
 */
export function headerPairs(headers) {
    if (!headers) return [];
    if (Array.isArray(headers)) return headers.map((pair) => [String(pair?.[0]), String(pair?.[1])]);
    if (typeof headers.entries === 'function') return [...headers.entries()].map(([name, value]) => [String(name), String(value)]);
    return Object.entries(headers).map(([name, value]) => [String(name), String(value)]);
}

function originOf(url) {
    try {
        return new URL(String(url)).origin;
    } catch {
        return '';
    }
}

function withoutAuthHeaders(pairs, declared = []) {
    return stripSensitiveHeaders(pairs, declared);
}

function isEmptyData(data, contract) {
    if (data === null || data === undefined) return true;
    // map / object 型都是对象：无键才是空（object 型字段全缺也当空）
    if (contract.shape === 'map' || contract.shape === 'object') return typeof data !== 'object' || Object.keys(data).length === 0;
    return Array.isArray(data) && data.length === 0;
}

/** 合并写入（merge/append）：按 key 覆盖旧值，旧记录保留。 */
function mergeByKey(previous, incoming, key) {
    const map = new Map();
    for (const record of Array.isArray(previous) ? previous : []) map.set(String(record?.[key]), record);
    for (const record of Array.isArray(incoming) ? incoming : []) map.set(String(record?.[key]), record);
    return [...map.values()];
}

function serialize(data) {
    return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * 加载一个来源模块并做登记表 / meta 一致性检查。
 * @returns {{ meta: object, collect: Function }}
 */
export async function loadSource(name, registry = defaultRegistry, contracts = defaultContracts) {
    const entry = registry[name];
    if (!entry) throw makeError(`未登记的来源「${name}」`, 'registry');
    const moduleUrl = new URL(entry.module, import.meta.url);
    const mod = await import(moduleUrl.href);
    const meta = mod.meta;
    if (!meta || typeof meta !== 'object') throw makeError(`来源「${name}」缺少 meta 导出`, 'registry');
    if (meta.id !== name) throw makeError(`来源「${name}」的 meta.id 是「${meta.id}」，与 registry 键不一致`, 'registry');
    if (Boolean(meta.optional) !== Boolean(entry.optional)) {
        throw makeError(`来源「${name}」的 meta.optional（${meta.optional}）与 registry（${entry.optional}）不一致`, 'registry');
    }
    if (typeof mod.collect !== 'function') throw makeError(`来源「${name}」缺少 collect 导出`, 'registry');
    if (!Array.isArray(meta.datasets) || meta.datasets.length === 0) throw makeError(`来源「${name}」未声明 datasets`, 'registry');
    // 登记时就把契约问题暴露出来，不要等拉到数据才发现
    for (const datasetId of meta.datasets) getContract(datasetId, contracts);
    for (const [datasetId, version] of Object.entries(meta.datasetVersions || {})) {
        if (!meta.datasets.includes(datasetId)) throw makeError(`来源「${name}」的 datasetVersions 声明了未登记的 dataset「${datasetId}」`, 'contract');
        const contract = getContract(datasetId, contracts);
        if (Number(version) !== Number(contract.version)) {
            throw makeError(`契约版本不匹配：${datasetId} 契约为 v${contract.version}，来源声明 v${version}`, 'contract');
        }
    }
    return { meta, collect: mod.collect };
}

function buildContext({ name, meta, env, log, projectRoot, dataDir, dryRun, timeoutMs, fetchImpl, artifacts, contracts }) {
    const declared = [...(meta.credentials || []), ...(meta.optionalCredentials || [])];
    const injected = {};
    for (const key of declared) {
        if (env[key] !== undefined && env[key] !== '') injected[key] = env[key];
    }
    const secrets = collectSecrets(injected);
    const declaredSensitive = declaredSensitiveHeaders(meta);
    const safeLog = (level) => (message) => log[level](sanitize(message, secrets));
    const artifactDirs = (meta.artifacts || []).map((artifact) => String(artifact.dir || '').replace(/^public\//, '').replace(/\/+$/, ''));

    const fetchJson = async (url, options = {}, timeout = 20000) => {
        let response;
        try {
            response = await fetchWithTimeout(fetchImpl, url, options, timeout, declaredSensitive);
        } catch (error) {
            const wrapped = makeError(sanitize(`请求失败：${url.split('?')[0]}（${error.message}）`, secrets), 'upstream');
            throw wrapped;
        }
        if (!response.ok) {
            const error = makeError(`HTTP ${response.status} ${response.statusText || ''}`.trim() + ` (${String(url).split('?')[0]})`);
            // 401/403 是凭据问题，429/5xx 是上游问题：分类交给调用方（optional → 告警，非可选 → 失败）
            if (response.status === 401 || response.status === 403) error.code = 'auth';
            else if (response.status === 429 || response.status >= 500) error.code = 'upstream';
            throw error;
        }
        return response.json();
    };

    const fetchBinary = async (url, options = {}, timeout = 20000) => {
        const response = await fetchWithTimeout(fetchImpl, url, options, timeout, declaredSensitive);
        // statusText 一并返回：调用方要按旧的错误文案拼「HTTP 404 Not Found」，少了它测试与线上日志都会变
        if (!response.ok) return { ok: false, status: response.status, statusText: response.statusText || '', bytes: null };
        const bytes = Buffer.from(await response.arrayBuffer());
        return { ok: bytes.length > 0, status: response.status, statusText: response.statusText || '', bytes };
    };

    const writeArtifact = (relativePath, bytes) => {
        const normalized = String(relativePath).replace(/^public\//, '').replace(/^\/+/, '');
        if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
            throw makeError(`非法的附属产物路径「${relativePath}」`, 'artifact');
        }
        const dir = normalized.split('/').slice(0, -1).join('/');
        if (!artifactDirs.includes(dir)) {
            throw makeError(`附属产物目录「${dir}」未在 meta.artifacts 声明`, 'artifact');
        }
        const file = path.join(projectRoot, 'public', normalized);
        if (dryRun) {
            artifacts.push(normalized);
            return { written: false, dryRun: true, path: `/public/${normalized}` };
        }
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, bytes);
        artifacts.push(normalized);
        return { written: true, path: `/public/${normalized}` };
    };

    return {
        ctx: {
            env: injected,
            log: Object.assign(safeLog('log'), {
                warn: safeLog('warn'),
                error: safeLog('error')
            }),
            fetchJson,
            fetchBinary,
            previous: (datasetId) => {
                const contract = getContract(datasetId, contracts);
                return readDatasetFile(projectRoot, contract.file);
            },
            readData: (file) => readDatasetFile(projectRoot, file),
            /**
             * 产物的只读文件信息：{ mtime, mtimeMs, size }，文件不存在返回 null。
             * 给「上游支持条件请求」的源用（map 的 If-Modified-Since），模块因此不许 import fs。
             * mtime 是 ISO 字符串（new Date(mtime).toUTCString() 可直接当请求头）。
             */
            fileStat: (file) => {
                const full = path.join(dataDir, String(file));
                if (!existsSync(full)) return null;
                const stat = statSync(full);
                return { mtime: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs, size: stat.size };
            },
            writeArtifact,
            dryRun,
            now: () => Date.now(),
            state: readState(projectRoot).sources[name] || {}
        },
        secrets
    };
}

/**
 * 跑一个来源。返回 { changed, outputs, report }；失败抛错（带 code: auth|upstream|contract|lock|incomplete）。
 */
export async function runIngestSource(name, options = {}) {
    const {
        env = {},
        log = console,
        projectRoot = process.cwd(),
        dryRun = false,
        registry = defaultRegistry,
        contracts = defaultContracts,
        fetchImpl = globalThis.fetch,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        lock = true
    } = options;
    const dataDir = path.join(projectRoot, 'src', 'data');

    const { meta, collect } = await loadSource(name, registry, contracts);

    // 缺必需凭据：按 optional 由调用方决定告警/失败；这里只负责分类成 auth
    const missing = (meta.credentials || []).filter((key) => !env[key]);
    if (missing.length > 0) {
        throw makeError(`缺少凭据 ${missing.join(', ')}，保留已有数据`, 'auth');
    }

    const lockHandle = lock ? acquireLock(projectRoot) : { ok: true, release() {} };
    if (!lockHandle.ok) throw makeError(`拿不到同步锁：${lockHandle.reason}`, 'lock');

    try {
        const artifacts = [];
        const { ctx, secrets } = buildContext({ name, meta, env, log, projectRoot, dataDir, dryRun, fetchImpl, artifacts, contracts });
        const startedAt = Date.now();

        let result;
        let timeoutTimer;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutTimer = setTimeout(() => reject(makeError(`collect 超时（${formatTimeout(timeoutMs)}）`, 'upstream')), timeoutMs);
            });
            result = await Promise.race([collect(ctx), timeoutPromise]);
        } catch (error) {
            if (error?.code) throw error;
            throw makeError(sanitize(error?.message || String(error), secrets), 'upstream');
        } finally {
            // 定时器必须清掉，否则脚本/单测会被这个 5 分钟的 timer 挂着不退出
            if (timeoutTimer) clearTimeout(timeoutTimer);
        }

        const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
        if (outputs.length === 0) throw makeError('collect 没有返回任何输出', 'contract');

        // 1) 声明与契约检查（多输出一起，任一失败整源不写）
        const planned = [];
        for (const output of outputs) {
            const datasetId = output?.dataset;
            if (!meta.datasets.includes(datasetId)) {
                throw makeError(`输出了未在 meta.datasets 声明的 dataset「${datasetId}」`, 'contract');
            }
            const contract = getContract(datasetId, contracts);
            if (output.complete === false) {
                throw makeError(`${datasetId} 未拉完（complete=false，${output.progress || '无进度信息'}），保留旧数据`, 'incomplete');
            }
            let data = output.data;
            if (contract.writeMode === 'merge' || contract.writeMode === 'append') {
                const previous = readDatasetFile(projectRoot, contract.file);
                data = mergeByKey(previous, data, contract.key || 'id');
            }
            const empty = isEmptyData(data, contract);
            if (empty && !contract.allowEmpty) {
                throw makeError(`${datasetId} 结果为空且契约不允许空输出，保留旧数据`, 'empty');
            }
            const validation = validateDataset(datasetId, data, contract);
            if (!validation.ok) {
                const preview = validation.errors.slice(0, 3).join('；');
                throw makeError(`${datasetId} 契约校验失败（${validation.errors.length} 处）：${preview}`, 'contract');
            }
            planned.push({ datasetId, contract, data, count: validation.count, file: contract.file });
        }

        // 2) 全部通过后再写：先写临时文件，再逐个 rename
        const written = [];
        for (const item of planned) {
            const file = path.join(dataDir, item.file);
            const json = serialize(item.data);
            const previous = existsSync(file) ? readFileSync(file, 'utf8') : null;
            item.unchanged = previous === json;
            item.json = json;
            written.push(item);
        }

        let changed = 0;
        if (!dryRun) {
            const temps = [];
            try {
                for (const item of written) {
                    if (item.unchanged) continue;
                    mkdirSync(dataDir, { recursive: true });
                    const temp = path.join(dataDir, `.${item.file}.tmp-${process.pid}`);
                    writeFileSync(temp, item.json, 'utf8');
                    temps.push({ temp, target: path.join(dataDir, item.file), item });
                }
                for (const { temp, target } of temps) {
                    renameSync(temp, target);
                    changed += 1;
                }
            } catch (error) {
                for (const { temp } of temps) {
                    try {
                        rmSync(temp, { force: true });
                    } catch {
                        // 清理失败不掩盖原始错误
                    }
                }
                throw makeError(`写盘失败：${sanitize(error.message, secrets)}`, 'write');
            }
        }

        const datasets = Object.fromEntries(written.map((item) => [item.datasetId, item.count]));
        if (!dryRun) recordSuccess(projectRoot, name, datasets, startedAt);

        const report = written.map((item) => {
            const verb = dryRun ? 'dry-run 将写入' : item.unchanged ? '无变化' : '已写入';
            return `[ingest] ${name} → src/data/${item.file} ${item.count} 条（${verb}）`;
        });
        if (artifacts.length) report.push(`[ingest] ${name} 附属产物 ${artifacts.length} 个（public/）`);
        for (const line of report) log.log(sanitize(line, secrets));

        return {
            changed,
            outputs: written.map((item) => ({
                dataset: item.datasetId,
                file: item.file,
                data: item.data,
                count: item.count,
                allowEmpty: item.contract.allowEmpty,
                wrote: !dryRun && !item.unchanged
            })),
            report
        };
    } finally {
        lockHandle.release();
    }
}
