import type { Post, Settings } from '@ts-ghost/content-api';

export type { Settings };

/** Ghost 文章/页面（带 type 标记），由本地 JSON 反序列化 */
export interface ExPost extends Post {
    type: string;
}
