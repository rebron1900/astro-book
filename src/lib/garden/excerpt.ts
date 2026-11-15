/**
 * 花园笔记的摘要提取（构建期用）。
 *
 * 两个公开 JSON（`/garden-meta.json`、`/garden-search-data.json`）都要摘要，
 * 这里统一一份口径并缓存，避免两处各写一遍正则。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = path.join(process.cwd(), '.garden', 'content');
const cache = new Map<string, string>();

export const plainTextOf = (markdown: string): string =>
    markdown
        .replace(/%%[\s\S]*?%%/g, ' ')
        // callout 标记不是正文：`> [!NOTE] 标题` 要把标记和标题一起去掉
        .replace(/\[![A-Za-z][\w-]*\][+-]?[ \t]*/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^[>#\s*\-+|]+$/gm, ' ')
        .replace(/[*_~`>#|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

/** 笔记正文的纯文本摘要；`.garden` 里没有该文件时返回空串 */
export function excerptFor(id: string, chars = 180): string {
    const key = `${chars}:${id}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const file = path.join(CONTENT_DIR, `${id}.md`);
    const text = existsSync(file) ? plainTextOf(readFileSync(file, 'utf8')).slice(0, chars) : '';
    cache.set(key, text);
    return text;
}
