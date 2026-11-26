import type { Post, Page, Tag } from '@ts-ghost/content-api';
import type { Memo, FluxEntry, FluxLostFeed, NeoDBMark, NeoDBResponse } from './types';
import type { Settings } from './ghost';
import type { Activity } from '../lib/activity-types';
import type { ReadingData, ReadingDay } from '../lib/reading';
import type { EmbyEntry } from '../lib/emby';
import { filterPublishableMemos, parseMemoVisibilities } from '../lib/privacy';
import { buildTimeline, readingDayTime } from '../lib/timeline';

// 从本地同步的 JSON 读取数据（方案 B：GitHub Action 定时同步，构建零网络依赖）。
// JSON 由 scripts/sync-data.mjs 生成，提交进仓库。
// 静态 import JSON（Vite 打包），不用动态路径，避免构建时解析到 dist/。

import ghostJson from '../data/ghost.json';
import neodbJson from '../data/neodb.json';
import fluxJson from '../data/flux.json';
import fluxLostJson from '../data/flux-lost.json';
import memosJson from '../data/memos.json';
import activitiesJson from '../data/activities.json';
import readingJson from '../data/reading.json';
import embyJson from '../data/emby.json';

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

// 隐私边界（M1）：来源侧（scripts/sync-data.mjs）落地前已过滤，这里再滤一次做双保险。
// 即使有人手工把非公开条目塞回 memos.json，时间线 / 搜索 / RSS / /now 也拿不到。
// 放开范围只能通过 MEMOS_PUBLISH_VISIBILITIES 显式配置，默认仅 PUBLIC。
const memoVisibilities = parseMemoVisibilities(import.meta.env.MEMOS_PUBLISH_VISIBILITIES);
export const publicMemos: Memo[] = filterPublishableMemos(memosJson as Memo[], memoVisibilities);

// 首页 Now 组件需要最新一条 memo
const memosAll = publicMemos;
export const memos = memosAll.slice(0, 1);

// 整合内容源（文章 + 微博客），供时间线页使用
export const allContent = [...postsAll, ...memosAll].sort((a, b) => {
    const aTime = 'createdTs' in a ? (a as Memo).createdTs * 1000 : new Date((a as Post).created_at).getTime();
    const bTime = 'createdTs' in b ? (b as Memo).createdTs * 1000 : new Date((b as Post).created_at).getTime();
    return bTime - aTime;
});

const readingData = readingJson as unknown as ReadingData;
const embyEntries = embyJson as unknown as EmbyEntry[];
/** 阅读汇总（已按 MIN_DAY_SECONDS 过滤后的口径）：页头总览用。 */
export const reading = readingData;

// 时间线是否收录 NeoDB 书影音条目。老板 2026-11-25 要求时间线暂不展示书影音，
// 数据与 /douban/ 页面全部保留；改回 true 即可恢复「全部」时间线里的 neodb、
// 筛选条的「书影音」按钮，以及 /timeline/neodb/ 路由（三处都读这个常量）。
export const TIMELINE_INCLUDE_NEODB = false;

// 首页信息流：聚合文章 / 微博客 / NeoDB 书影标记 / 运动记录，各取「发生时间」统一降序。
// ponytail: 每条用 discriminated union 区分类型，渲染端按 kind 分支；后续新增源只需加一个分支。
export type TimelineEntry =
    | { kind: 'post'; time: number; data: Post & { type: string } }
    | { kind: 'memo'; time: number; data: Memo }
    | { kind: 'neodb'; time: number; data: NeoDBMark }
    // 运动条目沿用 'strava' 这个 kind：/timeline/strava 路由和 strava-cards 样式是既有 UI 概念
    | { kind: 'strava'; time: number; data: Activity }
    // 阅读：一本书一天一条，data 是当天的书目明细（见 src/lib/reading.ts 的白名单输出）
    | { kind: 'reading'; time: number; data: ReadingDay }
    // 影视：Emby 观看记录（一部电影 / 一集剧），与阅读合并成「阅读与影视」。
    | { kind: 'media'; time: number; data: EmbyEntry };

// neodb.visibility: 0=public 1=unlisted 2=private；只展示明确标为公开（0）的标记。
// 与 Memos 同一原则：缺字段/非法值一律当非公开，不兜底成 public（兜底公开等于默认泄露）。
export function isPublishableNeodbMark(mark: { visibility?: unknown } | null | undefined): boolean {
    if (!mark) return false;
    const raw = mark.visibility;
    // 只认数字 0 或纯数字字符串 '0'；null/布尔/数组/对象/空白串一律不发布
    if (typeof raw === 'number') return raw === 0;
    if (typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    return trimmed !== '' && Number(trimmed) === 0;
}

const neodbMarks = (neodbJson as unknown as NeoDBResponse).data.filter((m) => isPublishableNeodbMark(m));

export const timeline: TimelineEntry[] = buildTimeline([
    ...postsAll.map((p) => ({ kind: 'post' as const, time: new Date(p.published_at ?? p.created_at).getTime(), data: p })),
    ...memosAll.map((m) => ({ kind: 'memo' as const, time: m.createdTs * 1000, data: m })),
    ...neodbMarks.map((m) => ({ kind: 'neodb' as const, time: new Date(m.created_time).getTime(), data: m })),
    ...stravaActivities.map((a) => ({ kind: 'strava' as const, time: new Date(a.start_date_local.replace(' ', 'T')).getTime(), data: a })),
    // 阅读按「北京时间当天 00:00」入时间线（只用于排序/分页，不反推成时刻），一天一条
    ...(readingData.days ?? []).map((day) => ({
        kind: 'reading' as const,
        time: readingDayTime(day.date),
        data: day
    })),
    // 影视：同步脚本只写入有观看时间的条目；按最后观看时间入时间线。
    ...embyEntries
        .filter((entry) => typeof entry.lastPlayedAt === 'number')
        .map((entry) => ({ kind: 'media' as const, time: entry.lastPlayedAt as number, data: entry }))
]);

/**
 * 时间线展示用数据源：按 TIMELINE_INCLUDE_NEODB 决定是否剔除 neodb。
 * `timeline` 保持完整（/douban/ 直接依赖它，条数与改前一致）。
 */
export const timelineVisible: TimelineEntry[] = TIMELINE_INCLUDE_NEODB
    ? timeline
    : timeline.filter((entry) => entry.kind !== 'neodb');
