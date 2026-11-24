#!/usr/bin/env node
/**
 * 只读诊断：看 modureader 的 WebDAV 里到底有什么，不改任何东西。
 *
 * 用法（本地）：
 *   export MODU_WEBDAV_URL='https://<host>/<路径>'   # WebDAV 根，不带 /modu
 *   export MODU_WEBDAV_USER='...' MODU_WEBDAV_PASS='...'
 *   node scripts/modu-probe.mjs
 *   node scripts/modu-probe.mjs --json > probe.json      # 机器可读，便于贴回
 *
 * file:// 调试（无需凭据）：MODU_WEBDAV_URL=file:///tmp/modu-fixture node scripts/modu-probe.mjs
 *
 * 只做 PROPFIND / GET；绝不 PUT / LOCK / DELETE。凭据只用于请求头，不打印、不写盘、
 * 不进输出（URL 里的 userinfo 也会被改写掉）。
 *
 * 输出三部分：
 *   (a) 表清单与行数
 *   (b) kind=time/book/position/link 各一条记录的 payload 键名与示例值（脱敏到前 80 字符）
 *   (c) 时间戳最小值 / 最大值、行数分布
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const MODU_DIR = 'modu';
const MAIN_DB = 'database8.db';
const LOG_DIR = 'record-log-v1';
const KINDS = ['time', 'book', 'position', 'link', 'round', 'note'];

const lines = [];
const say = (line = '') => {
    lines.push(line);
    if (!JSON_OUT) console.log(line);
};

/** 凭据不出现在任何输出里：URL 打出来前先把 userinfo 抹掉。 */
function safeUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.username || u.password) {
            u.username = '';
            u.password = '';
        }
        return u.href;
    } catch {
        return '<无法解析的 URL>';
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

async function dav(rawUrl, method, env, headers = {}, body) {
    const res = await fetch(rawUrl, { method, headers: { ...authHeaders(rawUrl, env), ...headers }, body, signal: AbortSignal.timeout(30000) });
    return res;
}

/** PROPFIND 列出目录下的文件（含相对路径），返回 [{name, href, size, lastModified}]。 */
async function listDir(rawUrl, env) {
    const res = await dav(rawUrl, 'PROPFIND', env, { Depth: '1', 'Content-Type': 'application/xml' }, '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><getcontentlength/><getlastmodified/></prop></propfind>');
    if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`PROPFIND ${safeUrl(rawUrl)} → HTTP ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();
    const entries = [];
    for (const block of xml.split(/<[^>]*response>/i).slice(1)) {
        const href = (block.match(/<[^>]*href>([^<]+)<\/[^>]*href>/i) || [])[1]?.trim();
        if (!href) continue;
        const name = decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
        const size = Number((block.match(/<[^>]*getcontentlength>(\d+)</i) || [])[1] || '');
        const lastModified = (block.match(/<[^>]*getlastmodified>([^<]+)</i) || [])[1]?.trim() || null;
        if (href.endsWith('/')) continue;
        entries.push({ name, href, size: Number.isFinite(size) ? size : null, lastModified });
    }
    return entries;
}

/** 读一个库文件：优先系统 sqlite3 -json，回退 node:sqlite 子进程（Node22 需 --experimental-sqlite）。 */
function queryDb(dbFile, sql) {
    try {
        const out = execFileSync('sqlite3', ['-json', dbFile, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        return out.trim() ? JSON.parse(out) : [];
    } catch {
        const helper = fileURLToPath(new URL('./node-sqlite-read.mjs', import.meta.url));
        const out = execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', helper, dbFile], {
            encoding: 'utf8',
            input: sql,
            maxBuffer: 64 * 1024 * 1024
        });
        return out.trim() ? JSON.parse(out) : [];
    }
}

function scalar(dbFile, sql) {
    try {
        return queryDb(dbFile, sql)[0] ?? {};
    } catch {
        return null;
    }
}

/** payload 只留键名 + 截断示例，书城/文件路径这类长值也截断。 */
function summarizePayload(raw) {
    const text = typeof raw === 'string' ? raw : String(raw ?? '');
    if (!text.trim()) return { keys: [], sample: {} };
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { keys: [], parseError: true, sample: { _raw: text.slice(0, 80) } };
    }
    if (!parsed || typeof parsed !== 'object') return { keys: [], sample: { _raw: text.slice(0, 80) } };
    const sample = {};
    for (const [k, v] of Object.entries(parsed)) {
        if (v === null) sample[k] = null;
        else if (typeof v === 'object') sample[k] = Array.isArray(v) ? `[${v.length} items]` : '{object}';
        else sample[k] = String(v).length > 80 ? `${String(v).slice(0, 80)}…` : v;
    }
    return { keys: Object.keys(parsed), sample };
}

async function fetchDbs(env) {
    const rawRoot = env.MODU_WEBDAV_URL;
    if (!rawRoot) throw new Error('缺少 MODU_WEBDAV_URL（WebDAV 根，不带 /modu）');
    const root = rawRoot.replace(/\/+$/, '');
    const dir = mkdtempSync(path.join(tmpdir(), 'modu-probe-'));

    if (root.startsWith('file://')) {
        const rootPath = fileURLToPath(root);
        const found = [];
        const mainPath = path.join(rootPath, MODU_DIR, MAIN_DB);
        if (existsSync(mainPath)) found.push({ name: MAIN_DB, file: mainPath, size: statSync(mainPath).size, lastModified: statSync(mainPath).mtime.toISOString() });
        else {
            const logRoot = path.join(rootPath, MODU_DIR, LOG_DIR);
            if (existsSync(logRoot)) {
                for (const sub of readdirSync(logRoot, { withFileTypes: true })) {
                    if (!sub.isDirectory()) continue;
                    for (const f of readdirSync(path.join(logRoot, sub.name))) {
                        if (!f.endsWith('.db')) continue;
                        const full = path.join(logRoot, sub.name, f);
                        found.push({ name: `${sub.name}/${f}`, file: full, size: statSync(full).size, lastModified: statSync(full).mtime.toISOString() });
                    }
                }
            }
        }
        if (found.length === 0) throw new Error(`本地 ${rootPath} 下既没有 ${MODU_DIR}/${MAIN_DB} 也没有 ${MODU_DIR}/${LOG_DIR}/**/*.db`);
        return { mode: 'file://', root: rootPath, dirs: [], files: found };
    }

    const dirs = [];
    for (const rel of [`${MODU_DIR}/${MAIN_DB}`, `${MODU_DIR}/${LOG_DIR}/`]) {
        try {
            const listed = await listDir(`${root}/${rel}`, env);
            dirs.push({ path: rel, entries: listed.length });
        } catch (error) {
            dirs.push({ path: rel, error: String(error.message || error) });
        }
    }

    const files = [];
    const mainUrl = `${root}/${MODU_DIR}/${MAIN_DB}`;
    try {
        const res = await dav(mainUrl, 'GET', env);
        if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const file = path.join(dir, MAIN_DB);
            writeFileSync(file, buf);
            files.push({ name: MAIN_DB, file, size: buf.length, lastModified: res.headers.get('last-modified') });
        } else if (res.status !== 404) {
            throw new Error(`GET ${MODU_DIR}/${MAIN_DB} → HTTP ${res.status} ${res.statusText}`);
        }
    } catch (error) {
        if (files.length === 0 && !String(error.message).includes('404')) {
            say(`主库 GET 异常：${String(error.message).split('\n')[0]}（继续尝试增量库）`);
        }
    }

    if (files.length === 0) {
        // 无强 ETag 的服务端只写增量库；modu/record-log-v1/<首位>/<sha256>.db
        const logRootUrl = `${root}/${MODU_DIR}/${LOG_DIR}/`;
        const tops = await listDir(logRootUrl, env).catch(() => []);
        for (const top of tops) {
            const subUrl = top.href.startsWith('http') ? top.href : `${root}${top.href.startsWith('/') ? top.href : `/${top.href}`}`;
            const subs = await listDir(subUrl.endsWith('/') ? subUrl : `${subUrl}/`, env).catch(() => []);
            for (const sub of subs.filter((s) => s.name.endsWith('.db'))) {
                const url = sub.href.startsWith('http') ? sub.href : `${root}${sub.href.startsWith('/') ? sub.href : `/${sub.href}`}`;
                const res = await dav(url, 'GET', env);
                if (!res.ok) continue;
                const buf = Buffer.from(await res.arrayBuffer());
                const file = path.join(dir, `${top.name}_${sub.name}`);
                writeFileSync(file, buf);
                files.push({ name: `${top.name}/${sub.name}`, file, size: buf.length, lastModified: sub.lastModified });
            }
        }
    }
    return { mode: 'webdav', root: safeUrl(root), dirs, files };
}

async function main() {
    const env = process.env;
    const report = { at: new Date().toISOString(), root: null, mode: null, dirs: [], files: [], tables: [], kinds: {}, timestamps: {}, notes: [] };
    const src = await fetchDbs(env);
    report.mode = src.mode;
    report.root = src.root;
    report.dirs = src.dirs ?? [];
    report.files = src.files.map((f) => ({ name: f.name, bytes: f.size, lastModified: f.lastModified }));

    say(`== modureader 诊断 == ${report.at}`);
    say(`来源：${src.mode} ${src.root}`);
    for (const d of report.dirs) say(`  目录 ${d.path}: ${d.error ? `读取失败 ${d.error}` : `${d.entries} 项`}`);
    say(`  可读库文件 ${src.files.length} 个`);
    for (const f of src.files) say(`    ${f.name}  ${f.size} 字节  ${f.lastModified ?? '未知时间'}`);

    say('');
    say('(a) 表清单与行数');
    for (const f of src.files) {
        const tables = scalar(f.file, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        let names = [];
        try {
            names = queryDb(f.file, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);
        } catch (error) {
            say(`  ${f.name}: 读表清单失败（${String(error.message).split('\n')[0]}）`);
            report.notes.push(`${f.name} 读表清单失败`);
            continue;
        }
        report.tables.push({ file: f.name, tables: names });
        say(`  ${f.name}: ${names.join(', ') || '（无表）'}`);
        if (names.includes('modu_sync_records')) {
            const counts = queryDb(f.file, 'SELECT kind, COUNT(*) AS n, SUM(CASE WHEN deleted<>0 THEN 1 ELSE 0 END) AS tomb FROM modu_sync_records GROUP BY kind ORDER BY kind');
            for (const row of counts) say(`     ${row.kind}: ${row.n} 行（墓碑 ${row.tomb ?? 0}）`);
            const ctl = scalar(f.file, 'SELECT clock FROM modu_sync_control LIMIT 1');
            if (ctl && ctl.clock !== undefined) say(`     modu_sync_control.clock = ${ctl.clock}`);
            const secrets = scalar(f.file, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='tb_sync_secrets'");
            if (secrets?.n) say(`     tb_sync_secrets: 存在（内容不读取）`);
        }
    }

    say('');
    say('(b) 各类记录一条样例（payload 键名 + 截断示例）');
    for (const kind of KINDS) {
        for (const f of src.files) {
            let rows = [];
            try {
                rows = queryDb(f.file, `SELECT kind, sync_id, clock, revision, deleted, payload FROM modu_sync_records WHERE kind = '${kind}' ORDER BY clock DESC LIMIT 1`);
            } catch {
                continue;
            }
            if (!rows.length) continue;
            const r = rows[0];
            const sum = summarizePayload(r.payload);
            report.kinds[kind] = report.kinds[kind] ?? {};
            report.kinds[kind][f.name] = { keys: sum.keys, sample: sum.sample, clock: r.clock, revision: r.revision, deleted: r.deleted, parseError: sum.parseError ?? false };
            say(`  kind=${kind}  [${f.name}] sync_id=${r.sync_id} clock=${r.clock} deleted=${r.deleted}`);
            say(`    键: ${sum.keys.join(', ') || '（payload 无法解析）'}`);
            say(`    示例: ${JSON.stringify(sum.sample)}`);
        }
        if (!report.kinds[kind]) say(`  kind=${kind}: 无记录`);
    }

    say('');
    say('(c) 时间戳范围');
    for (const f of src.files) {
        try {
            const r = scalar(f.file, "SELECT MIN(CAST(clock AS INTEGER)) AS clock_min, MAX(CAST(clock AS INTEGER)) AS clock_max, MIN(kind) AS k FROM modu_sync_records");
            if (r && r.clock_min !== undefined) {
                say(`  ${f.name}: clock ${r.clock_min ?? '—'} … ${r.clock_max ?? '—'}`);
                report.timestamps[f.name] = { clock_min: r.clock_min, clock_max: r.clock_max };
            }
            const d = queryDb(f.file, "SELECT json_extract(payload,'$.date') AS date, COUNT(*) AS n FROM modu_sync_records WHERE kind='time' GROUP BY date ORDER BY date DESC LIMIT 5");
            if (d.length) {
                say(`    最近 5 个阅读日: ${d.map((x) => `${x.date}(${x.n})`).join('  ')}`);
                report.timestamps[f.name] = { ...(report.timestamps[f.name] ?? {}), recent_days: d };
            }
        } catch (error) {
            say(`  ${f.name}: 时间戳统计失败（${String(error.message).split('\n')[0]}）`);
        }
    }

    const positionKeys = Object.values(report.kinds.position ?? {}).map((v) => (v.keys ?? []).includes('book_id'));
    say('');
    say(`position 记录是否带 book_id: ${positionKeys.length === 0 ? '无 position 记录' : positionKeys.some(Boolean) ? '带（可安全按 book_id 关联）' : '不带（实现里会回退 record.local_id）'}`);
    say('只读诊断结束：本次没有向 WebDAV 写入任何内容。');

    if (JSON_OUT) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
    console.error(`诊断失败：${String(error.message || error).split('\n')[0]}`);
    process.exit(1);
});