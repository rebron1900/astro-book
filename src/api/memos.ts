import config from '../config';
import type { Memo } from './types';

// 兜底超时，避免外部源挂起时卡住整个构建
async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function toMemos(raw: unknown[]): Memo[] {
    return (raw as Memo[]).map((memo) => ({ ...memo, type: 'memo' }));
}

/**
 * 获取 memos 总数。
 * 优先读 Worker 返回的 X-Total-Count 头；若 Worker 不支持分页（无此头），
 * 回退到拉取全量再计数。
 */
export async function getMemosCount(): Promise<number> {
    try {
        const url = `${config.memos.url}?limit=1&offset=0`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) return 0;
        const total = res.headers.get('X-Total-Count');
        if (total) return parseInt(total, 10);
        // 回退：Worker 不支持分页，拉全量计数
        const data = (await res.json()) as unknown[];
        return Array.isArray(data) ? data.length : 0;
    } catch (error) {
        console.error('获取 Memos 总数失败:', error);
        return 0;
    }
}

/**
 * 按页获取 memos。
 * Worker 支持 ?limit=N&offset=M 时只返回一页；
 * 不支持时（返回全量），在本地切片。
 */
export async function getMemosPage(limit: number, offset: number): Promise<Memo[]> {
    try {
        const url = `${config.memos.url}?limit=${limit}&offset=${offset}`;
        const res = await fetchWithTimeout(url, 20000);
        if (!res.ok) {
            console.warn(`Memos ${res.status} ${res.statusText}`);
            return [];
        }
        const data = (await res.json()) as unknown[];
        const arr = Array.isArray(data) ? data : [];
        const total = res.headers.get('X-Total-Count');
        // 有 X-Total-Count 说明 Worker 已分页，直接返回；否则本地切片
        if (total) {
            return toMemos(arr);
        }
        return toMemos(arr.slice(offset, offset + limit));
    } catch (error) {
        console.error('获取 Memos 分页失败:', error);
        return [];
    }
}

/** 获取最新一条 memo（首页 Now 组件用） */
export async function getLatestMemo(): Promise<Memo | null> {
    const page = await getMemosPage(1, 0);
    return page[0] ?? null;
}

/** 全量获取（向后兼容，rss 等场景用）。超时放宽到 20s，覆盖 Worker 首次拉全量（约 10s）。 */
export async function getMemos(): Promise<Memo[]> {
    try {
        const res = await fetchWithTimeout(config.memos.url, 20000);
        if (!res.ok) {
            console.warn(`Memos ${res.status} ${res.statusText}`);
            return [];
        }
        const memos = (await res.json()) as Memo[];
        return toMemos(memos);
    } catch (error) {
        console.error('获取 Memos 失败:', error);
        return [];
    }
}
