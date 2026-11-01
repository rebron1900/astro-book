/** Memos 微博客条目（按实际 API 响应字段） */
export interface Memo {
    id: string;
    type: string;
    content: string;
    createdTs: number;
    updatedTs: number;
    creatorName: string;
    resourceList: Array<{
        type: string;
        filename: string;
        externalLink: string;
    }>;
    [key: string]: unknown;
}

/** Flux RSS 单条聚合结果 */
export interface FluxEntry {
    feed_id: number;
    feed: FluxFeed;
    update_timestamp: number;
    title?: string;
    url?: string;
    content?: string;
    published_at?: string;
    created_at?: string;
    [key: string]: unknown;
}

export interface FluxFeed {
    id: number;
    site_url: string;
    title?: string;
    [key: string]: unknown;
}

/** Flux 中暂时无法获取最新文章的订阅（友邻页「失联订阅」分组） */
export interface FluxLostFeed {
    id: number;
    title: string;
    site_url: string;
    feed_url?: string;
    /** error = 抓取失败 / empty = 暂无文章 / disabled = 已被 Miniflux 停用 */
    reason: 'error' | 'empty' | 'disabled';
    /** Miniflux 返回的最近一次错误信息，用于悬停提示 */
    error?: string;
    /** 最后一次成功抓到文章的时间（缓存继承，可能为空） */
    last_entry_at?: string;
    /** 首次被判定为失联的时间，后续同步保持不变 */
    first_seen_at: string;
}

/** NeoDB 书影条目（标记数据，来自 doumark-action 输出） */
export interface NeoDBMark {
    shelf: string;
    visibility: string;
    title: string;
    comment_text: string;
    rating_grade: number;
    type: string;
    item: NeoDBItem;
    created_time: string;
    [key: string]: unknown;
}

/** NeoDB 书影作品本体 */
export interface NeoDBItem {
    uuid: string;
    url: string;
    api_url: string;
    category: string;
    parent_uuid: string | null;
    display_title: string;
    external_resources: Array<{ url: string }>;
    id?: string;
    title?: string;
    title_cn?: string;
    cover_image_url?: string;
    [key: string]: unknown;
}

/** NeoDB 标记接口响应（{ data: NeoDBMark[] }） */
export interface NeoDBResponse {
    data: NeoDBMark[];
    [key: string]: unknown;
}
