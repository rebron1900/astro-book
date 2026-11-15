/**
 * 花园站内链预览的数据源：`/garden-meta.json`。
 *
 * 构建期从 `.garden/link-map.json` + `.garden/content/` 生成，只含已发布集合
 * （link-map 本身就是 sync 的产物，清单的 notes 与它同源）。
 * 客户端 hover 时只查这张表，不去 fetch 目标页 HTML。
 */
import type { APIContext } from 'astro';

import { getGardenMetaIndex } from '../lib/garden/meta';
import { getBacklinkIndex } from '../lib/garden/backlinks';
import { excerptFor } from '../lib/garden/excerpt';

export async function GET(_context: APIContext) {
    const metaIndex = getGardenMetaIndex();
    const inbound = getBacklinkIndex();

    const payload: Record<string, { title: string; excerpt: string; section: string; backlinks: number }> = {};

    for (const [id, meta] of metaIndex) {
        payload[id] = {
            title: meta.title,
            excerpt: excerptFor(id),
            section: meta.tags.slice(0, 3).join(' · '),
            backlinks: (inbound.get(id) ?? []).length
        };
    }

    return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}
