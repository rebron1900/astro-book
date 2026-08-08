import {
    getSettings,
    getAllTags,
    getAllPages,
    getAllPosts,
    getNeodb,
    getFlux,
    getLatestMemo,
    getAllAuthors,
    getAllContent
} from './index';

// 并行拉取各独立数据源，避免顺序 await 拖慢构建。
// ponytail: 仍为模块加载时全量拉取；若某数据源变慢可改 per-page 按需加载。
const [settingsData, postsAllData, pagesData, neodbData, fluxData, latestMemo, authorsData] =
    await Promise.all([
        getSettings(),
        getAllPosts(),
        getAllPages(),
        getNeodb(),
        getFlux(),
        getLatestMemo(),
        getAllAuthors()
    ]);

export const settings = settingsData;
export const postsAll = postsAllData;
export const pages = pagesData;
export const neodb = neodbData;
export const flux = fluxData;
export const authors = authorsData;

// 首页 Now 组件只需最新一条 memo，不再全量拉取
export const memos = latestMemo ? [latestMemo] : [];

// 复用已拉取的文章构造标签，避免 getAllTags 内部重复请求 Ghost 全部文章。
export const tags = await getAllTags(postsAllData);

// 整合内容源（文章 + 微博客），供时间线页使用。复用已拉取的数据避免重复请求。
// 注意：memos 现在只有最新一条；时间线页如需全量微博客，应自行调用 getMemosPage。
export const allContent = await getAllContent(postsAllData, memos);
