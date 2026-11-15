/**
 * 花园标签索引（构建期）。
 *
 * 数据来自 `.garden/link-map.json`：`tags` 是 sync 已做大小写合并的标签表，
 * `notes[].tags` 保留原始写法。这里再补一层 Quartz 的层级累加：
 * `privacy/email` 除了自己的页，也计入 `/garden/tags/privacy/`（旧站这两级都是 200）。
 *
 * 只读 `.garden/`，不碰 vault。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface GardenTag {
    key: string;
    display: string;
    count: number;
    variants: string[];
}

export interface TaggedNote {
    id: string;
    title: string;
}

interface LinkMapFile {
    tags?: Array<{ key: string; display: string; count: number; variants: string[] }>;
    notes?: Array<{ id: string; title?: string; tags?: string[] }>;
}

const LINK_MAP = path.join(process.cwd(), '.garden', 'link-map.json');

let cached: { tags: GardenTag[]; byTag: Map<string, TaggedNote[]> } | null = null;

const normalizeKey = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');

const load = () => {
    if (cached) return cached;

    const byTag = new Map<string, TaggedNote[]>();
    const displays = new Map<string, Map<string, number>>();
    const seenPerNote = new Map<string, Set<string>>();

    const add = (key: string, display: string, note: TaggedNote) => {
        const keySet = seenPerNote.get(note.id) ?? new Set<string>();
        if (keySet.has(key)) return;
        keySet.add(key);
        seenPerNote.set(note.id, keySet);

        const list = byTag.get(key) ?? [];
        list.push(note);
        byTag.set(key, list);

        const variants = displays.get(key) ?? new Map<string, number>();
        variants.set(display, (variants.get(display) ?? 0) + 1);
        displays.set(key, variants);
    };

    if (existsSync(LINK_MAP)) {
        const raw = JSON.parse(readFileSync(LINK_MAP, 'utf8')) as LinkMapFile;
        const titles = new Map<string, string>();
        for (const note of raw.notes ?? []) titles.set(note.id, note.title || note.id);

        for (const note of raw.notes ?? []) {
            const entry: TaggedNote = { id: note.id, title: titles.get(note.id) ?? note.id };
            for (const tag of note.tags ?? []) {
                const key = normalizeKey(tag);
                if (!key) continue;
                add(key, tag.trim(), entry);
                // 层级累加：`a/b/c` 计入 `a/b` 与 `a`
                const segments = key.split('/').filter(Boolean);
                for (let i = 1; i < segments.length; i += 1) {
                    add(segments.slice(0, i).join('/'), segments.slice(0, i).join('/'), entry);
                }
            }
        }

        // sync 的 tags 表带了官方 display 与去重后的 count，作为兜底补进来（例如没有笔记的标签）
        for (const tag of raw.tags ?? []) {
            const key = normalizeKey(tag.key);
            if (!byTag.has(key)) byTag.set(key, []);
            const variants = displays.get(key) ?? new Map<string, number>();
            variants.set(tag.display, Math.max(variants.get(tag.display) ?? 0, tag.count));
            displays.set(key, variants);
        }
    }

    const tags: GardenTag[] = [...byTag.entries()].map(([key, notes]) => {
        const variants = displays.get(key) ?? new Map<string, number>();
        const display =
            [...variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))[0]?.[0] ?? key;
        return {
            key,
            display,
            count: notes.length,
            variants: [...variants.keys()]
        };
    });

    tags.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    for (const notes of byTag.values()) {
        notes.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
    }

    cached = { tags, byTag };
    return cached;
};

export function listGardenTags(): GardenTag[] {
    return load().tags;
}

export function notesForTag(key: string): TaggedNote[] {
    return load().byTag.get(normalizeKey(key)) ?? [];
}

export function gardenTagCount(): number {
    return load().tags.length;
}
