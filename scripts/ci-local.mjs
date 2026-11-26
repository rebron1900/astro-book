#!/usr/bin/env node
/**
 * CI 本地等价检查：把 .github/workflows/ci.yml 里「构建侧」的闸门在本地按同一顺序跑一遍。
 *
 * 为什么需要：Actions 只在 push/定时触发时跑，本地改完代码无法证明「CI 会绿」。
 * 这个脚本不联网（除了 npm 已经装好的依赖），产出的结论与 CI 的同一批闸门等价；
 * 但它不替代 CI：CI 还会跑 garden vault 拉取（要 GARDEN_VAULT_TOKEN）和定时取数。
 *
 * 用法：
 *   node scripts/ci-local.mjs            # 全量：类型 → 测试 → 构建 → 隐私闸门 → 泄露闸门
 *   node scripts/ci-local.mjs --fast     # 跳过构建（只跑类型 + 测试 + 已有 dist 的两个闸门）
 *   node scripts/ci-local.mjs --offline  # 构建阶段屏蔽一切出站网络（断网等价验证）
 *
 * 退出码：任一步失败即 1，并打印是哪一步；全部通过打印 PASS 汇总。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const fast = args.has('--fast');
const offline = args.has('--offline');

/** 断网等价的 preload：任何出站网络调用记录并抛错。只在 --offline 时注入构建。 */
const NO_NET_PRELOAD = `
import { appendFileSync } from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
const LOG = process.env.CI_OFFLINE_LOG || '/tmp/ci-offline-net.log';
const note = (w, d) => { try { appendFileSync(LOG, w + '\\t' + String(d).slice(0, 200) + '\\n'); } catch {} };
const boom = (w, d) => { note(w, d); throw new Error('[net-blocked] ' + w + ' ' + d); };
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (/^file:/.test(url)) return origFetch(input, init);
    boom('fetch', url);
};
net.Socket.prototype.connect = function (...a) { boom('socket.connect', JSON.stringify(a[0])); return this; };
net.connect = net.createConnection = (...a) => boom('net.connect', JSON.stringify(a[0]));
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
    if (typeof dns[name] === 'function') dns[name] = (...a) => boom('dns.' + name, JSON.stringify(a[0]));
    if (dns.promises && typeof dns.promises[name] === 'function') dns.promises[name] = (...a) => boom('dns.promises.' + name, JSON.stringify(a[0]));
}
for (const mod of [http, https]) {
    mod.request = (...a) => boom('http.request', JSON.stringify(a[0]?.host ?? a[0]));
    mod.get = (...a) => boom('http.get', JSON.stringify(a[0]?.host ?? a[0]));
}
`;

const steps = [];
function step(name, command, argv, env = {}) {
    steps.push({ name, command, argv, env });
}

step('类型检查 astro check', 'npx', ['astro', 'check']);
step('单元测试 vitest', 'npx', ['vitest', 'run']);
if (!fast) {
    const env = { ASTRO_TELEMETRY_DISABLED: '1' };
    if (offline) env.NODE_OPTIONS = `--import=data:text/javascript,${encodeURIComponent(NO_NET_PRELOAD)}`;
    step(offline ? '构建 astro build（断网等价）' : '构建 astro build', 'npx', ['astro', 'build'], env);
}
step('隐私闸门 check-public-data', 'node', ['scripts/check-public-data.mjs']);
step('泄露闸门 check-no-modu-db', 'node', ['scripts/check-no-modu-db.mjs']);

const results = [];
let failed = 0;
for (const s of steps) {
    if (s.name.includes('构建') && !existsSync(path.join(ROOT, 'dist')) && fast) continue;
    process.stdout.write(`\n=== ${s.name}\n`);
    const started = Date.now();
    const r = spawnSync(s.command, s.argv, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...s.env }, shell: false });
    const ok = r.status === 0;
    if (!ok) failed += 1;
    results.push({ name: s.name, ok, ms: Date.now() - started, status: r.status });
}

console.log('\n=== 汇总');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(1)}s, exit ${r.status})`);
if (failed > 0) {
    console.error(`\n${failed} 步失败：这是本地等价结论，CI 未运行。`);
    process.exit(1);
}
console.log('\n全部通过（本地等价；CI 未运行，不能据此宣称已上线或已发布）。');
