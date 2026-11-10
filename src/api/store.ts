import type { Post, Page, Tag } from '@ts-ghost/content-api';
import type { Memo, FluxEntry, FluxLostFeed, NeoDBMark, NeoDBResponse } from './types';
import type { Settings } from './ghost';
import type { Activity } from '../lib/activity-types';

// 从本地同步的 JSON 读取数据（方案 B：GitHub Action 定时同步，构建零网络依赖）。
// JSON 由 scripts/sync-data.mjs 生成，提交进仓库。
// 静态 import JSON（Vite 打包），不用动态路径，避免构建时解析到 dist/。

import ghostJson from '../data/ghost.json';
import neodbJson from '../data/neodb.json';
import fluxJson from '../data/flux.json';
import fluxLostJson from '../data/flux-lost.json';
import memosJson from '../data/memos.json';
import activitiesJson from '../data/activities.json';

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
export const fluxLost = fluxLostJson as unknown as FluxLostFeed[];
export const stravaActivities = activitiesJson as unknown as Activity[];

// 首页 Now 组件需要最新一条 memo
const memosAll = memosJson as Memo[];
export const memos = memosAll.slice(0, 1);

// 整合内容源（文章 + 微博客），供时间线页使用
export const allContent = [...postsAll, ...memosAll].sort((a, b) => {
    const aTime = 'createdTs' in a ? (a as Memo).createdTs * 1000 : new Date((a as Post).created_at).getTime();
    const bTime = 'createdTs' in b ? (b as Memo).createdTs * 1000 : new Date((b as Post).created_at).getTime();
    return bTime - aTime;
});

// 首页信息流：聚合文章 / 微博客 / NeoDB 书影标记 / 运动记录，各取「发生时间」统一降序。
// ponytail: 每条用 discriminated union 区分类型，渲染端按 kind 分支；后续新增源只需加一个分支。
export type TimelineEntry =
    | { kind: 'post'; time: number; data: Post & { type: string } }
    | { kind: 'memo'; time: number; data: Memo }
    | { kind: 'neodb'; time: number; data: NeoDBMark }
    // 运动条目沿用 'strava' 这个 kind：/timeline/strava 路由和 strava-cards 样式是既有 UI 概念
    | { kind: 'strava'; time: number; data: Activity };

// neodb.visibility: 0=public 1=unlisted 2=private；只展示公开标记（值在 JSON 中是数字）
const neodbMarks = (neodbJson as unknown as NeoDBResponse).data.filter((m) => Number(m.visibility ?? 0) === 0);

export const timeline: TimelineEntry[] = [
    ...postsAll.map((p) => ({ kind: 'post' as const, time: new Date(p.published_at ?? p.created_at).getTime(), data: p })),
    ...memosAll.map((m) => ({ kind: 'memo' as const, time: m.createdTs * 1000, data: m })),
    ...neodbMarks.map((m) => ({ kind: 'neodb' as const, time: new Date(m.created_time).getTime(), data: m })),
    ...stravaActivities.map((a) => ({ kind: 'strava' as const, time: new Date(a.start_date_local.replace(' ', 'T')).getTime(), data: a }))
].sort((a, b) => b.time - a.time);
