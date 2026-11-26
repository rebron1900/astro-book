/**
 * 同步状态与并发锁：管理元信息单独放 .cache/（gitignore），不写进数据文件。
 *
 * - sync-state.json：每个源最近一次成功的 dataset 条数与时间；只有写盘成功后才更新。
 * - sync.lock：进程级互斥，防止两个定时任务同时写同一批文件。
 *
 * 纯文件操作，失败不抛（状态写不进去不应该让整轮同步失败），但会在日志里说明。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LOCK_STALE_MS = 30 * 60 * 1000;

export function cacheDir(projectRoot) {
    return path.join(projectRoot, '.cache');
}

export function statePath(projectRoot) {
    return path.join(cacheDir(projectRoot), 'sync-state.json');
}

export function lockPath(projectRoot) {
    return path.join(cacheDir(projectRoot), 'sync.lock');
}

export function readState(projectRoot) {
    const file = statePath(projectRoot);
    if (!existsSync(file)) return { version: 1, sources: {} };
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return { version: 1, sources: {}, ...parsed };
    } catch {
        return { version: 1, sources: {} };
    }
}

/** 原子写状态文件（临时文件 + rename），写完即生效。 */
export function writeState(projectRoot, state) {
    const file = statePath(projectRoot);
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(temp, file);
}

/** 记录一个源一次成功：lastSuccessAt + 每个 dataset 的条数。 */
export function recordSuccess(projectRoot, sourceName, datasets, now = Date.now()) {
    const state = readState(projectRoot);
    const previous = state.sources[sourceName] || {};
    state.sources[sourceName] = {
        ...previous,
        lastSuccessAt: new Date(now).toISOString(),
        lastRun: { ...(previous.lastRun || {}), ...datasets }
    };
    writeState(projectRoot, state);
    return state;
}

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM 说明进程存在但没权限，仍算活着；ESRCH 才是真的没了。
        return error?.code === 'EPERM';
    }
}

/**
 * 拿锁：成功返回 { ok: true, release }，失败返回 { ok: false, reason }。
 * 锁文件里写 PID；进程已退出或文件超过 30 分钟视为陈旧锁，直接接管。
 */
export function acquireLock(projectRoot) {
    const file = lockPath(projectRoot);
    mkdirSync(path.dirname(file), { recursive: true });
    const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            writeFileSync(file, payload, { encoding: 'utf8', flag: 'wx' });
            let released = false;
            return {
                ok: true,
                release() {
                    if (released) return;
                    released = true;
                    try {
                        rmSync(file, { force: true });
                    } catch {
                        // 释放失败不影响本轮结果
                    }
                }
            };
        } catch (error) {
            if (error?.code !== 'EEXIST') return { ok: false, reason: `无法创建锁文件：${error.message}` };
            let holder = null;
            let staleByAge = false;
            try {
                holder = JSON.parse(readFileSync(file, 'utf8'));
                staleByAge = Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS;
            } catch {
                staleByAge = true;
            }
            if (holder && isProcessAlive(Number(holder.pid)) && !staleByAge) {
                return { ok: false, reason: `另一个同步进程在跑（pid ${holder.pid}，${holder.startedAt || '时间未知'}）` };
            }
            // 陈旧锁：删掉重试一次
            try {
                rmSync(file, { force: true });
            } catch {
                return { ok: false, reason: '陈旧锁删除失败，放弃本轮' };
            }
        }
    }
    return { ok: false, reason: '拿锁失败（重试后仍被占用）' };
}

/** 读旧 dataset 文件（合并写入 / previous 注入用）；损坏时返回 null。 */
export function readDatasetFile(projectRoot, file) {
    const full = path.join(projectRoot, 'src', 'data', file);
    if (!existsSync(full)) return null;
    try {
        return JSON.parse(readFileSync(full, 'utf8'));
    } catch {
        return null;
    }
}
