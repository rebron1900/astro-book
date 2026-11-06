/**
 * Artalk 页面统计（PV / 点赞）客户端工具。
 *
 * 评论组件与页脚的数量展示共用这里的接口与本地去重键，避免两处各写一套。
 * Artalk 服务端：页面 PV 走 /pages/pv（由 Artalk.init 的 PvCountWidget 触发），
 * 页面点赞走 /votes/page_up/{page_id}，计数从 /comments 的 page 字段读取。
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
 * 给页面点“赞”（page_up）。Artalk 按 IP 去重，同一 IP 重复调用等于取消。
 *
 * 注意：如果 Artalk 前面有 CDN / 反向代理，需要在 Artalk 配置里设置
 * `http.trusted_proxies` 与 `http.proxy_header`，否则所有访客会共用代理 IP，
 * 点赞会互相取消。
 *
 * 2.9.x 只有 POST /votes/page_up/{id} 和 comments 里的 vote_up 计数，
 * 没有 GET 投票状态；2.10+ 才有 GET /votes/page/{id}（is_up / is_down）。
 * 所以在 2.9.x 上由页面组件用 localStorage 记住本浏览器是否点过赞。
 */
export async function voteArtalkPageUp(pageId: number, fetcher: typeof fetch = fetch): Promise<{ up: number; down: number }> {
    const res = await fetcher(artalkApiUrl(`/votes/page_up/${pageId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}'
    });
    if (!res.ok) throw new Error(`Artalk vote API failed: ${res.status}`);

    const data = (await res.json()) as { up?: number; down?: number };
    return {
        up: Number(data.up ?? 0),
        down: Number(data.down ?? 0)
    };
}
