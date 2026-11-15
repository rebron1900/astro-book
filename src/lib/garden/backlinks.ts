/**
 * 花园的反向链接索引。
 *
 * 数据来自 gitignored 的 `.garden/link-map.json`：同步时每篇笔记都记了 `links`（出链 id），
 * 这里反转一次得到「谁链到我」。和 Quartz 的 `allFiles.filter(f => f.links?.includes(slug))`
 * 同一思路，只是把全量扫描收到构建期做一次并缓存。
 *
 * 注意：只读 `.garden/`，不要把 vault 路径或正文带进任何公开产物。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface BacklinkEntry {
    id: string;
    title: string;
}

interface LinkMapNote {
    id: string;
    title?: string;
    links?: string[];
}

let cached: Map<string, BacklinkEntry[]> | null = null;

const LINK_MAP = path.join(process.cwd(), '.garden', 'link-map.json');

/** 构建期只读一次并反转成 inbound 表；`.garden/` 尚未同步时返回空表 */
export function getBacklinkIndex(): Map<string, BacklinkEntry[]> {
    if (cached) return cached;

    const index = new Map<string, BacklinkEntry[]>();
    if (!existsSync(LINK_MAP)) {
        cached = index;
        return cached;
    }

    const raw = JSON.parse(readFileSync(LINK_MAP, 'utf8')) as { notes?: LinkMapNote[] };
    const titles = new Map<string, string>();
    for (const note of raw.notes ?? []) titles.set(note.id, note.title || note.id);

    for (const note of raw.notes ?? []) {
        for (const target of note.links ?? []) {
            // 自链不算反链
            if (target === note.id) continue;
            const list = index.get(target) ?? [];
            if (!list.some((entry) => entry.id === note.id)) {
                list.push({ id: note.id, title: titles.get(note.id) ?? note.id });
            }
            index.set(target, list);
        }
    }

    for (const list of index.values()) {
        list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
    }

    cached = index;
    return cached;
}

/** 某一篇的反链；没有就是空数组（页面负责任何空态展示） */
export function backlinksOf(id: string): BacklinkEntry[] {
    return getBacklinkIndex().get(id) ?? [];
}
