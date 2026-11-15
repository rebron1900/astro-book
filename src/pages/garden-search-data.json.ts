/**
 * 花园搜索索引：`/garden-search-data.json`。
 *
 * 字段与博客的 `/search-data.json` 保持同一形状（`title` / `section` / `content` / `href`），
 * 前端 Fuse 配置不必分叉；只收已发布笔记（link-map 与发布清单同源）。
 */
import type { APIContext } from 'astro';

import { getGardenMetaIndex } from '../lib/garden/meta';
import { excerptFor } from '../lib/garden/excerpt';
import { gardenHrefOf } from '../lib/garden/path';

export async function GET(_context: APIContext) {
    const entries = [...getGardenMetaIndex().values()].map((meta, index) => {
        const content = excerptFor(meta.id);
        return {
            id: index,
            // 根笔记 index.md 的页面 URL 是 `/garden/`
            href: gardenHrefOf(meta.id),
            date: meta.date ?? '',
            title: meta.title,
            section: meta.tags.slice(0, 3).join(','),
            published: meta.date ?? '',
            word_count: content.length,
            content
        };
    });

    return new Response(JSON.stringify(entries), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}
