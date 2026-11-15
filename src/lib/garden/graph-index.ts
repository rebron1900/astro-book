/**
 * 构建期图谱索引：读 `.garden/link-map.json` 构图并算好坐标，全站图端点与页面共用。
 * 坐标只算一次并缓存（构建期多个页面引用）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildGardenGraph, layoutGardenGraph, type GardenGraph } from './graph';

const LINK_MAP = path.join(process.cwd(), '.garden', 'link-map.json');

let cached: GardenGraph | null = null;

export function getGardenGraph(): GardenGraph {
    if (cached) return cached;

    if (!existsSync(LINK_MAP)) {
        cached = { nodes: [], edges: [] };
        return cached;
    }

    const raw = JSON.parse(readFileSync(LINK_MAP, 'utf8')) as {
        notes?: Array<{ id: string; title?: string; links?: string[] }>;
    };
    const notes = (raw.notes ?? []).map((note) => ({
        id: note.id,
        title: String(note.title ?? '').trim() || note.id,
        links: note.links ?? []
    }));

    const graph = buildGardenGraph(notes);
    layoutGardenGraph(graph);
    cached = graph;
    return cached;
}
