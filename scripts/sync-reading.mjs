/**
 * modureader 阅读数据拉取：从用户自己的 WebDAV 只读分片记录库，合并 → 清洗 → 交给 sync-data.mjs 落盘。
 *
 * 真实布局（实测）：`<WebDAV 根>/modu/record-log-v1/<首字符 0-9a-f>/<sha256>.db`
 * ——不存在 database8.db；新书会新建分片，所以每次都必须枚举，不能写死路径。
 *
 * 契约：
 * - 环境变量 MODU_WEBDAV_URL / MODU_WEBDAV_USER / MODU_WEBDAV_PASS；URL 以 file:// 开头时按本地目录调试。
 * - 只 GET / PROPFIND，绝不 PUT / LOCK / DELETE。
 * - .db 只落在系统临时目录，读完即删；**绝不写进仓库、dist 或 workflow artifact**（公开仓库）。
 * - 任何失败都 throw：由 sync-data.mjs 的源级 try/catch 兜住，绝不写空文件覆盖已有 reading.json。
 * - 不打印、不落盘任何凭据；日志里的 URL 先抹掉 userinfo。
 * - 封面压成 240px webp 存 src/assets/reading-cover/<coverKey>.webp；压不了就跳过，不影响同步。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanBookTitle, cleanBookAuthor } from './lib/book-title.mjs';

const MODU_DIR = 'modu';
const LOG_DIR = 'record-log-v1';
const COVER_DIR = 'data/cover';
const SHARD_CHARS = '0123456789abcdef'.split('');
// 实测库没有 local_id 列（schema: kind,sync_id,clock,revision,deleted,payload,narration），带上它会 SQL logic error。
const SELECT_COLUMNS = 'kind, sync_id, clock, revision, deleted, payload';
const CONCURRENCY = 4;
const COVER_WIDTH = 240;
const COVER_QUALITY = 78;

/** 只拉需要的四类：time 统计、book 元信息、note 划线、position 进度（暂不输出）。 */
const RECORD_SQL = `SELECT ${SELECT_COLUMNS} FROM modu_sync_records WHERE kind IN ('time','book','note','position')`;

function requireEnv(env, key) {
    const value = env[key];
    if (!value) throw new Error(`缺少 ${key}，无法读取 modureader 的 WebDAV 数据`);
    return value;
}

/** 打日志用的安全 URL：抹掉 userinfo。 */
export function safeUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.username || u.password) {
            u.username = '';
            u.password = '';
        }
        return u.href;
    } catch {
        return '<无效 URL>';
    }
}

function authHeaders(rawUrl, env) {
    const u = new URL(rawUrl);
    let user = env.MODU_WEBDAV_USER;
    let pass = env.MODU_WEBDAV_PASS;
    if (u.username) {
        user = decodeURIComponent(u.username);
        pass = decodeURIComponent(u.password);
    }
    if (!user && !pass) return {};
    return { Authorization: `Basic ${Buffer.from(`${user ?? ''}:${pass ?? ''}`).toString('base64')}` };
}

async function dav(url, method, env, headers = {}, body) {
    return fetch(url, {
        method,
        headers: { ...authHeaders(url, env), ...headers },
        body,
        signal: AbortSignal.timeout(30000)
    });
}

/** PROPFIND Depth:1 → [{ name, href }]，只要文件。 */
async function listDir(url, env) {
    const res = await dav(url, 'PROPFIND', env, { Depth: '1', 'Content-Type': 'application/xml' }, '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><getcontentlength/></prop></propfind>');
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`PROPFIND ${safeUrl(url)} → HTTP ${res.status} ${res.statusText}`);
    const xml = await res.text();
    const out = [];
    for (const block of xml.split(/<[^>]*response>/i).slice(1)) {
        const href = (block.match(/<[^>]*href>([^<]+)<\/[^>]*href>/i) || [])[1]?.trim();
        if (!href || href.endsWith('/')) continue;
        out.push({ name: decodeURIComponent(href.split('/').filter(Boolean).pop() || ''), href });
    }
    return out;
}

async function getBinary(url, env) {
    const res = await dav(url, 'GET', env, { Accept: 'application/octet-stream' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${safeUrl(url)} → HTTP ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`GET ${safeUrl(url)} 返回空文件`);
    return buf;
}

function absoluteHref(root, href) {
    if (/^https?:/i.test(href)) return href;
    return `${root}${href.startsWith('/') ? '' : '/'}${href}`;
}

/**
 * WebDAV 返回的 href 是服务器绝对路径（含 /dav 前缀），不能拼在 root 后面，否则变成 /dav/dav/... → 404。
 * 用 URL 解析：绝对路径按同源解析，相对路径按 root 目录解析。
 */
function resolveHref(root, href) {
    if (/^https?:/i.test(href)) return href;
    return new URL(href, `${root}/`).href;
}

/** file:// 调试：把本地目录当 WebDAV 根，读 <root>/modu/record-log-v1/<首字符>/*.db。 */
function collectLocal(rootPath) {
    const logRoot = path.join(rootPath, MODU_DIR, LOG_DIR);
    if (!existsSync(logRoot)) throw new Error(`本地 ${logRoot} 不存在`);
    const files = [];
    for (const sub of readdirSync(logRoot, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        for (const name of readdirSync(path.join(logRoot, sub.name))) {
            if (!name.endsWith('.db')) continue;
            files.push({ name: `${sub.name}/${name}`, file: path.join(logRoot, sub.name, name) });
        }
    }
    if (files.length === 0) throw new Error(`本地 ${logRoot} 下没有 .db 分片`);
    return files;
}

async function downloadShards(env, workDir, log) {
    const root = requireEnv(env, 'MODU_WEBDAV_URL').replace(/\/+$/, '');
    if (root.startsWith('file://')) {
        const files = collectLocal(fileURLToPath(root));
        log(`[reading] file:// 模式：${files.length} 个本地分片`);
        return files;
    }

    const logRootUrl = `${root}/${MODU_DIR}/${LOG_DIR}/`;
    const files = [];
    for (const ch of SHARD_CHARS) {
        const dirUrl = `${logRootUrl}${ch}/`;
        const shards = (await listDir(dirUrl, env)).filter((e) => e.name.endsWith('.db'));
        if (shards.length === 0) continue;
        for (let i = 0; i < shards.length; i += CONCURRENCY) {
            const batch = shards.slice(i, i + CONCURRENCY);
            const got = await Promise.all(
                batch.map(async (entry) => {
                    const buf = await getBinary(resolveHref(root, entry.href), env);
                    if (!buf) return null;
                    const file = path.join(workDir, `${ch}_${entry.name}`);
                    writeFileSync(file, buf);
                    return { name: `${ch}/${entry.name}`, file };
                })
            );
            files.push(...got.filter(Boolean));
        }
    }
    if (files.length === 0) throw new Error(`${MODU_DIR}/${LOG_DIR} 下没有任何 .db 分片`);
    log(`[reading] 从 WebDAV 下载 ${files.length} 个分片（${safeUrl(root)}）`);
    return files;
}

/** 读库：优先系统 sqlite3 -json，回退 node:sqlite 子进程（Node 22 需 --experimental-sqlite）。 */
function queryDb(dbFile, log) {
    try {
        const out = execFileSync('sqlite3', ['-json', dbFile, RECORD_SQL], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        return out.trim() ? JSON.parse(out) : [];
    } catch (error) {
        log?.(`[reading] sqlite3 CLI 读 ${path.basename(dbFile)} 失败，回退 node:sqlite：${String(error.message).split('\n')[0]}`);
        const helper = fileURLToPath(new URL('./node-sqlite-read.mjs', import.meta.url));
        const out = execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', helper, dbFile], {
            encoding: 'utf8',
            input: RECORD_SQL,
            maxBuffer: 64 * 1024 * 1024
        });
        return out.trim() ? JSON.parse(out) : [];
    }
}

/** 读人工映射表（允许缺失）。 */
function readOverrides(rootDir) {
    const file = path.join(rootDir, 'src/data/book-title-overrides.json');
    if (!existsSync(file)) return { byTitle: {}, byMd5: {} };
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return { byTitle: parsed.byTitle ?? {}, byMd5: parsed.byMd5 ?? {} };
    } catch {
        return { byTitle: {}, byMd5: {} };
    }
}

/**
 * 简介表（允许缺失）：book-descriptions.json 由 scripts/sync-book-descriptions.mjs 从 NeoDB 取回，
 * book-meta.json 是人工定稿。人工优先——只按书名合并，人工写过的书名直接覆盖自动结果。
 * modureader 的 book 记录没有简介字段，也不该把 epub 原件搬进构建。
 */
function readBookMeta(rootDir) {
    const read = (name) => {
        const file = path.join(rootDir, 'src/data', name);
        if (!existsSync(file)) return {};
        try {
            const parsed = JSON.parse(readFileSync(file, 'utf8'));
            const books = parsed?.books ?? {};
            return books && typeof books === 'object' ? books : {};
        } catch {
            return {};
        }
    };
    return { ...read('book-descriptions.json'), ...read('book-meta.json') };
}

/** 把清洗规则 + 人工映射表合成 buildReadingData 需要的 override 表。 */
function buildOverrideTable(overrides) {
    return { ...overrides.byTitle, ...overrides.byMd5 };
}

/** 映射表里所有人工定稿的标题 / 作者；后处理据此跳过二次清洗（byTitle 与 byMd5 都算）。 */
export function overrideOutputs(overrides) {
    const titles = new Set();
    const authors = new Set();
    for (const o of [...Object.values(overrides.byTitle ?? {}), ...Object.values(overrides.byMd5 ?? {})]) {
        if (o?.title) titles.add(o.title);
        if (o?.author) authors.add(o.author);
    }
    return { titles, authors };
}

/**
 * 落盘前按规则清洗书名 / 作者（映射表优先，规则兜底）。
 * buildReadingData 已按 byTitle + byMd5 应用过映射，这里不能再按清洗后的书名去查表；
 * 直接看「当前值是否是某条映射的输出」，**逐字段**决定是否跳过，
 * 避免「只修了作者」连带把脏书名留着。
 */
export function cleanAppliedData(data, overrides) {
    const fixed = overrideOutputs(overrides);
    const applyClean = (book) => {
        const titleFixed = fixed.titles.has(book.title);
        const authorFixed = fixed.authors.has(book.author);
        if (titleFixed && authorFixed) return;
        const c = { title: cleanBookTitle(book.title) || book.title, author: cleanBookAuthor(book.author) };
        if (!titleFixed) book.title = c.title;
        if (authorFixed) return;
        if (c.author) book.author = c.author;
        else delete book.author;
    };
    for (const day of data.days ?? []) for (const book of day.books ?? []) applyClean(book);
    for (const book of data.books ?? []) applyClean(book);
    return data;
}

/**
 * 跟着 book 记录的 cover_path 抓封面并压成 webp。
 * 拉不到 / sharp 不可用 / 压缩失败一律跳过（返回空），绝不让同步失败。
 */
async function syncCovers(env, root, records, projectRoot, log) {
    let sharp;
    try {
        sharp = (await import('sharp')).default;
    } catch {
        log('[reading] 未安装 sharp，跳过封面压缩');
        return 0;
    }
    const outDir = path.join(projectRoot, 'src/assets/reading-cover');
    mkdirSync(outDir, { recursive: true });

    // file_md5 → cover_path（只用于取封面，不写进 JSON）
    const wanted = new Map();
    for (const record of records) {
        if (record.kind !== 'book' || String(record.deleted ?? '0') !== '0') continue;
        let payload;
        try {
            payload = JSON.parse(record.payload ?? '{}');
        } catch {
            continue;
        }
        const coverPath = String(payload.cover_path ?? '').trim();
        const md5 = String(payload.file_md5 ?? '').trim();
        if (coverPath && md5) wanted.set(md5, coverPath);
    }
    if (wanted.size === 0) return 0;

    const { coverKeyOf } = await import('../src/lib/reading.ts');
    let done = 0;
    let bytes = 0;
    for (const [md5, coverPath] of wanted) {
        // 实测 payload.cover_path 自带目录前缀（"cover/xxx.png"），服务器实际位于 <root>/modu/data/cover/<文件名>。
        const fileName = path.basename(coverPath);
        const url = /^https?:/i.test(coverPath) ? coverPath : absoluteHref(root, `/${MODU_DIR}/${COVER_DIR}/${encodeURIComponent(fileName)}`);
        try {
            const buf = await getBinary(url, env);
            if (!buf) continue;
            // 文件名必须等于 reading.json 里的 cover 键（coverKeyOf(file_md5)），否则页面找不到封面。
            const key = coverKeyOf(md5);
            const webp = await sharp(buf).resize({ width: COVER_WIDTH, withoutEnlargement: true }).webp({ quality: COVER_QUALITY }).toBuffer();
            writeFileSync(path.join(outDir, `${key}.webp`), webp);
            done += 1;
            bytes += webp.length;
        } catch (error) {
            log(`[reading] 封面跳过 ${coverPath}：${String(error.message).split('\n')[0]}`);
        }
    }
    if (done > 0) log(`[reading] 封面 ${done} 张，共 ${(bytes / 1024).toFixed(0)} KB`);
    return done;
}

/**
 * 同步入口。返回 reading.json 结构；抛错表示该源失败。
 * @param {Record<string,string>} env sync-data.mjs 合并后的 env
 */
export async function syncReading(env = process.env, options = {}) {
    const log = options.log ?? ((line) => console.log(line));
    const projectRoot = options.projectRoot ?? process.cwd();
    const { buildReadingData, mergeSyncRows } = await import('../src/lib/reading.ts');
    const workDir = mkdtempSync(path.join(tmpdir(), 'astro-book-modu-'));
    try {
        const files = await downloadShards(env, workDir, log);
        const rows = [];
        for (const meta of files) {
            for (const record of queryDb(meta.file, log)) rows.push({ db: meta.name, record });
        }
        log(`[reading] ${files.length} 个分片共 ${rows.length} 行`);

        const { records: merged, conflicts } = mergeSyncRows(rows, log);
        if (conflicts > 0) log(`[reading] 版本冲突 ${conflicts} 处（按 clock→revision→deleted 定序）`);
        if (merged.length === 0) throw new Error('分片里没有 time/book/note 记录，拒绝写入空阅读数据');

        const root = requireEnv(env, 'MODU_WEBDAV_URL').replace(/\/+$/, '');
        if (!root.startsWith('file://')) await syncCovers(env, root, merged, projectRoot, log);

        const overrides = readOverrides(projectRoot);
        // 同一本书被多次导入（file_md5 不同）会拆成多个 sync_id；聚合时就按清洗后的书名归并，
        // 否则同一天会出现两张同名卡片、books 总数也多算。
        const titleMerger = (title) => cleanBookTitle(title) || title;
        const data = buildReadingData(merged, { titleOverrides: buildOverrideTable(overrides), bookMeta: readBookMeta(projectRoot), titleMerger });
        cleanAppliedData(data, overrides);
        log(`[reading] 天数 ${data.totals.days}，书 ${data.totals.books} 本，合计 ${Math.round(data.totals.seconds / 60)} 分钟`);
        return data;
    } finally {
        // 公开仓库：分片只留在系统临时目录，用完立刻删
        rmSync(workDir, { recursive: true, force: true });
    }
}
