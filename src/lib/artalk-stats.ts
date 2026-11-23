/**
 * Artalk 页面统计（PV / 点赞）客户端工具。
 *
 * 评论组件与页脚的数量展示共用这里的接口与本地去重键，避免两处各写一套。
 * Artalk 服务端：页面 PV 走 /pages/pv（由 Artalk.init 的 PvCountWidget 触发），
 * 页面点赞走 /votes/page/{page_id}/up（Artalk 2.10+），点赞数与“我是否已赞”
 * 都从 /votes/page/{page_id} 读取，计数也可以从 /comments 的 page 字段读到。
 */

export const ARTALK_SERVER = 'https://artalk.1900.live';
export const ARTALK_SITE = "1900'Blog";

export interface ArtalkPageStats {
    /** Artalk 页面记录 id，0 表示页面尚未在 Artalk 中登记 */
    id: number;
    pv: number;
    voteUp: number;
    voteDown: number;
}

/** 与 Artalk.init 使用的 pageKey 完全一致：pathname 末尾补一个斜杠 */
export function artalkPageKey(pathname?: string): string {
    const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
    return path.replace(/\/?$/, '/');
}

/** 本地记录“这个浏览器是否给该页面点过赞”的 key */
export function artalkLikedKey(pageKey = artalkPageKey()): string {
    return `artalk_like:${ARTALK_SITE}:${pageKey}`;
}

/** 本地记录“这个浏览器是否已经给该页面贡献过 PV”的 key */
export function artalkPvSeenKey(pageKey = artalkPageKey()): string {
    return `artalk_pv:${ARTALK_SITE}:${pageKey}`;
}

function storage(): Storage | null {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        // 隐私模式 / 存储被禁用时可能抛错
        return null;
    }
}

export function hasLiked(pageKey = artalkPageKey()): boolean {
    try {
        return !!storage()?.getItem(artalkLikedKey(pageKey));
    } catch {
        return false;
    }
}

export function markLiked(pageKey = artalkPageKey()): void {
    try {
        storage()?.setItem(artalkLikedKey(pageKey), '1');
    } catch {
        // 忽略：存储不可用时只是无法记住状态，不影响点赞本身
    }
}

export function hasCountedPv(pageKey = artalkPageKey()): boolean {
    try {
        return !!storage()?.getItem(artalkPvSeenKey(pageKey));
    } catch {
        return false;
    }
}

export function markPvCounted(pageKey = artalkPageKey()): void {
    try {
        storage()?.setItem(artalkPvSeenKey(pageKey), String(Date.now()));
    } catch {
        // 同上，退化为每次访问都计 PV
    }
}

function artalkApiUrl(path: string): string {
    return `${ARTALK_SERVER}/api/v2${path}`;
}

/**
 * 读取页面统计：page id、PV、点赞数。
 *
 * Artalk 的 GET /pages 需要管理员权限，而公开的 /comments 响应里自带 page 数据，
 * 因此一次请求即可拿到 page id / pv / vote_up；页面未登记时会返回 id 为 0 的占位 page。
 */
export async function fetchArtalkPageStats(pageKey = artalkPageKey(), fetcher: typeof fetch = fetch): Promise<ArtalkPageStats> {
    const query = new URLSearchParams({
        page_key: pageKey,
        site_name: ARTALK_SITE,
        limit: '1'
    });

    const res = await fetcher(artalkApiUrl(`/comments?${query.toString()}`), {
        headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`Artalk comments API failed: ${res.status}`);

    const data = (await res.json()) as {
        page?: { id?: number; pv?: number; vote_up?: number; vote_down?: number };
    };
    const page = data.page;

    return {
        id: Number(page?.id ?? 0),
        pv: Number(page?.pv ?? 0),
        voteUp: Number(page?.vote_up ?? 0),
        voteDown: Number(page?.vote_down ?? 0)
    };
}

/**
 * 记录一次页面浏览（PV），返回该页最新 PV。
 *
 * 花园笔记很多没有评论区（短笔记不渲染 Artalk），评论组件也就不存在，
 * page 记录不会被创建、点赞拿不到 page id。这里主动登记页面并 +1。
 * 响应只有 `pv`，不含 page id；要 id 时再调 {@link fetchArtalkPageStats}。
 */
export async function logArtalkPagePv(pageKey = artalkPageKey(), pageTitle = '', fetcher: typeof fetch = fetch): Promise<number> {
    const res = await fetcher(artalkApiUrl('/pages/pv'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ page_key: pageKey, page_title: pageTitle, site_name: ARTALK_SITE })
    });
    if (!res.ok) throw new Error(`Artalk pv API failed: ${res.status}`);

    const data = (await res.json()) as { pv?: number };
    return Number(data.pv ?? 0);
}

export interface ArtalkPageVote {
    /** 页面点赞总数 */
    up: number;
    /** 页面点踩总数 */
    down: number;
    /** 当前浏览者是否已经点过赞（Artalk 按 IP 或登录身份判定） */
    isUp: boolean;
    /** 当前浏览者是否已经点过踩 */
    isDown: boolean;
}

function toVote(data: { up?: number; down?: number; is_up?: boolean; is_down?: boolean }): ArtalkPageVote {
    return {
        up: Number(data.up ?? 0),
        down: Number(data.down ?? 0),
        isUp: Boolean(data.is_up),
        isDown: Boolean(data.is_down)
    };
}

/**
 * 读取当前浏览者对某页面的投票状态。
 *
 * Artalk 2.10 起才提供 GET /votes/page/{id}（返回 up / down / is_up / is_down），
 * 用它替掉“用 localStorage 猜这个浏览器点没点过赞”的做法。
 */
export async function fetchArtalkPageVote(pageId: number, fetcher: typeof fetch = fetch): Promise<ArtalkPageVote> {
    const res = await fetcher(artalkApiUrl(`/votes/page/${pageId}`), {
        headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`Artalk vote API failed: ${res.status}`);

    return toVote((await res.json()) as { up?: number; down?: number; is_up?: boolean; is_down?: boolean });
}

/**
 * 给页面点“赞”。Artalk 2.10 起写接口是 POST /votes/page/{id}/up：
 * 同一 IP（或同一登录身份）再点一次就是取消，所以最终状态看返回值里的 is_up，
 * 不能再用“数字变小了”来判断。
 */
export async function voteArtalkPageUp(pageId: number, fetcher: typeof fetch = fetch): Promise<ArtalkPageVote> {
    const res = await fetcher(artalkApiUrl(`/votes/page/${pageId}/up`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}'
    });
    if (!res.ok) throw new Error(`Artalk vote API failed: ${res.status}`);

    return toVote((await res.json()) as { up?: number; down?: number; is_up?: boolean; is_down?: boolean });
}
