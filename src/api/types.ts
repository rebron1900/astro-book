export interface DataSource<T = unknown> {
    name: string;
    fetch(): Promise<T>;
    transform?(raw: unknown): T;
}

/** Memos 微博客条目（按实际 API 响应字段） */
export interface Memo {
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
    feed_id: string;
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
    id: string;
    site_url: string;
    title?: string;
    [key: string]: unknown;
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
    cover_image_url?: string;
    [key: string]: unknown;
}

/** NeoDB 标记接口响应（{ data: NeoDBMark[] }） */
export interface NeoDBResponse {
    data: NeoDBMark[];
    [key: string]: unknown;
}
