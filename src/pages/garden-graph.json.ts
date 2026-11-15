/**
 * 全站关系图数据：`/garden-graph.json`。
 *
 * 只含已发布笔记（link-map 与发布清单同源）；坐标在构建期算好，客户端不跑长模拟。
 * 孤立点保留在数据里（`degree === 0`），由页面默认隐藏而不是删掉。
 */
import type { APIContext } from 'astro';

import { getGardenGraph } from '../lib/garden/graph-index';

export async function GET(_context: APIContext) {
    const graph = getGardenGraph();
    return new Response(
        JSON.stringify({
            nodes: graph.nodes.map(({ id, title, folder, degree, x, y }) => ({ id, title, folder, degree, x, y })),
            edges: graph.edges
        }),
        { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
}
