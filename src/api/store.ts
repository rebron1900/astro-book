import type { Post, Page, Tag } from '@ts-ghost/content-api';
import type { Memo, FluxEntry, NeoDBResponse } from './types';
import type { Settings } from './ghost';

// 从本地同步的 JSON 读取数据（方案 B：GitHub Action 定时同步，构建零网络依赖）。
// JSON 由 scripts/sync-data.mjs 生成，提交进仓库。
// 静态 import JSON（Vite 打包），不用动态路径，避免构建时解析到 dist/。

import ghostJson from '../data/ghost.json';
import neodbJson from '../data/neodb.json';
import fluxJson from '../data/flux.json';
import memosJson from '../data/memos.json';

interface GhostAuthor {
    id: string;
    name: string;
    profile_image?: string;
    cover_image?: string;
    bio?: string;
    slug?: string;
    [key: string]: unknown;
}

interface GhostData {
    settings: Settings | null;
    posts: (Post & { type: string })[];
    pages: (Page & { type: string })[];
    authors: GhostAuthor[];
    tags: (Tag & { posts: Post[] })[];
}

const ghost = ghostJson as unknown as GhostData;

export const settings = ghost.settings;
export const postsAll = ghost.posts;
export const pages = ghost.pages;
export const authors = { authors: ghost.authors };
export const tags = ghost.tags;
export const neodb = neodbJson as unknown as NeoDBResponse;
export const flux = fluxJson as unknown as FluxEntry[];

// 首页 Now 组件需要最新一条 memo
const memosAll = memosJson as Memo[];
export const memos = memosAll.slice(0, 1);

// 整合内容源（文章 + 微博客），供时间线页使用
export const allContent = [...postsAll, ...memosAll].sort((a, b) => {
    const aTime = 'createdTs' in a ? (a as Memo).createdTs * 1000 : new Date((a as Post).created_at).getTime();
    const bTime = 'createdTs' in b ? (b as Memo).createdTs * 1000 : new Date((b as Post).created_at).getTime();
    return bTime - aTime;
});
