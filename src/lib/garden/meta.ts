/**
 * 花园笔记的元数据（标题 / 标签 / 日期）。
 *
 * 为什么不用 Astro collection 的 `data`：`sync-garden.mjs` 写 `.garden/content/` 时只写
 * 剥离后的正文，frontmatter 不进镜像，所以 collection 拿不到 title/tags。而 link-map 是
 * sync 的权威产物，标题规则（frontmatter → 文件名）它已经算好了，页面统一从这里取。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface GardenMeta {
    id: string;
    title: string;
    tags: string[];
    date?: string;
    relPath?: string;
}

interface LinkMapNote {
    id: string;
    title?: string;
    tags?: string[];
    date?: string | null;
    relPath?: string;
}

const LINK_MAP = path.join(process.cwd(), '.garden', 'link-map.json');
let cached: Map<string, GardenMeta> | null = null;

export function getGardenMetaIndex(): Map<string, GardenMeta> {
    if (cached) return cached;

    const index = new Map<string, GardenMeta>();
    if (existsSync(LINK_MAP)) {
        const raw = JSON.parse(readFileSync(LINK_MAP, 'utf8')) as { notes?: LinkMapNote[] };
        for (const note of raw.notes ?? []) {
            const fallback = note.id.split('/').pop() ?? note.id;
            index.set(note.id, {
                id: note.id,
                title: String(note.title ?? '').trim() || fallback,
                tags: note.tags ?? [],
                date: note.date ?? undefined,
                relPath: note.relPath
            });
        }
    }

    cached = index;
    return cached;
}

export function gardenMetaOf(id: string): GardenMeta | undefined {
    return getGardenMetaIndex().get(id);
}
