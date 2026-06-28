# 架构重构 Phase 1 实施计划：项目结构重组 & 依赖清理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在零行为变更的前提下，将 astro-book 的源码从扁平散乱结构重组为按功能分层的目录，合并配置模块，删除未使用依赖，并为 API 层引入插件式数据源接口。

**Architecture:** 纯结构性重构——文件迁移 + import 路径重写 + 依赖裁剪。配置拆分为多模块但保留向后兼容的默认聚合导出，确保所有 `config.xxx` 用法无需改动。验证门槛为 `astro build` 零报错（完整类型检查 `astro check` 留待 Phase 2）。

**Tech Stack:** Astro 5, SolidJS, nanostores, TypeScript (strict), SCSS, yarn

**Spec:** `docs/superpowers/specs/2026-06-28-architecture-refactoring-phase1-design.md`

---

## 重要约定

1. **零行为变更**：本阶段只搬代码、改路径、删依赖，不改变任何运行时行为。`footer` 内联 HTML 移入组件是唯一例外（自包含、低风险）。`themes[i].info` 的内联 HTML **暂保留**在配置中，等 Phase 4 重写主题组件时再提取。
2. **验证门槛**：每个 Task 结束后跑 `yarn build`（即 `astro build`，不做类型检查）。`astro check` 的报错属预期，Phase 2 处理。
3. **JS→TS**：Phase 1 只做 `.js`→`.ts` 重命名 + 必要的最小类型（函数参数/返回值能加就加），不追求完整类型覆盖。
4. **配置向后兼容**：`config/index.ts` 同时提供命名导出和默认聚合导出 `config`，让所有 `import config from '../config'` 直接可用。
5. **频繁提交**：每个 Task 完成且 `yarn build` 通过后立即 commit。

## 文件结构总览

**新建目录：** `src/api/`, `src/config/`, `src/lib/`, `src/lib/utils/`, `src/components/ui/`, `src/components/layout/`, `src/components/islands/`

**删除目录：** `src/data/`, `src/utils/`, `src/types/`

**API 层新文件：** `api/types.ts`, `api/registry.ts`, `api/ghost.ts`, `api/memos.ts`, `api/neodb.ts`, `api/flux.ts`, `api/strava.ts`, `api/actives.ts`, `api/store.ts`, `api/index.ts`

**配置新文件：** `config/index.ts`, `config/site.ts`, `config/nav.ts`, `config/theme.ts`, `config/apps.ts`

**Lib 新文件：** `lib/utils/{common-utils,help,data-utils}.ts`, `lib/{search,toc,activitypub,code,map,og-cache,image-cache,cards,albums,coco-message}.ts`, `lib/types.ts`

---

## Task 1: 删除未使用依赖

**Files:**
- Modify: `package.json`, `yarn.lock`

- [ ] **Step 1: 删除 runtime 依赖**

```bash
yarn remove cheerio @sveltejs/svelte-virtual-list bricks.js astro-lqip @shikijs/transformers astro-og-canvas
```

- [ ] **Step 2: 删除 devDependencies 中拼写错误的 loadsh**

```bash
yarn remove loadsh
```

- [ ] **Step 3: 删除 OG 图片生成路由（依赖 astro-og-canvas）**

删除文件 `src/pages/.og/[...image].ts` 及其目录 `src/pages/.og/`。该功能因移除 `astro-og-canvas` 而失效，后续阶段用替代方案重建。

- [ ] **Step 4: 验证构建**

Run: `yarn build`
Expected: 构建可能因 `.og` 路由引用的其它代码缺失而报错——若报错，确认错误仅与已删除的 OG 路由相关。若其它页面引用了 `.og` 生成的图片，需移除对应引用。检查 `src` 下是否有对 `/og/` 路径或 `.og` 的引用并清理。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: 移除未使用依赖及 OG 图片路由"
```

---

## Task 2: 创建新目录结构

**Files:**
- Create: 空目录占位

- [ ] **Step 1: 创建目录**

```bash
mkdir -p src/api src/config src/lib/utils src/components/ui src/components/layout src/components/islands
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: 创建分层目录结构"
```

---

## Task 3: 配置模块拆分

将 `src/data/config.js` 和 `src/data/site-config.ts` 合并拆分为 `src/config/` 下的多模块，保留默认聚合导出。

**Files:**
- Create: `src/config/site.ts`, `src/config/nav.ts`, `src/config/theme.ts`, `src/config/apps.ts`, `src/config/index.ts`
- Reference: `src/data/config.js`（迁移后删除）

- [ ] **Step 1: 创建 `src/config/site.ts`**

包含真正的功能配置（不含 UI 展示数据）：

```typescript
export const siteConfig = {
    blogURL: 'https://1900.live',
    apiUrl: 'https://hapi.190102.xyz:4433/blog',
    memos: {
        url: 'https://m2m.996288.xyz/api/v1/memo',
        siteURL: 'https://m2m.996288.xyz',
        limit: 10,
        offset: 10
    },
    customPage: ['archives', 'memos', 'links', 'douban', 'albums', 'map', 'strava', 'tags'],
    taxonomy: [
        {
            name: '节气',
            slug: 'jie-qi',
            desc: '24节气是中国劳动人民的智慧和浪漫...',
            tags: ['jie-qi']
        },
        {
            name: '工具箱',
            slug: 'tools',
            desc: '收集的小玩意儿和工具有关的经验分享...',
            tags: ['gong-ju-xiang', 'xiao-he-shuang-pin', 'chromium', 'docker', 'jamstack', 'memos', 'nginx', 'rime', 'spa']
        }
    ]
} as const;
```

- [ ] **Step 2: 创建 `src/config/theme.ts`**

保留 `info` 内联 HTML（Phase 4 重写主题组件时再提取，本阶段不改变行为）：

```typescript
export interface ThemeConfig {
    name: string;
    desc: string;
    type: 'light' | 'dark' | 'auto';
    info?: string;
}

export const themes: ThemeConfig[] = [
    { name: 'light', desc: '月牙白', type: 'light' },
    { name: 'dark', desc: '极夜黑', type: 'dark' },
    { name: 'yayu', desc: '雅余黄', type: 'dark', info: '<a href="https://yayu.net/" target="_blank" >💖来自雅余，一位喜欢极简生活的博主！</a>' },
    { name: 'yuhang', desc: '昱行粉', type: 'dark', info: '<a href="https://yuhang.ch/" target="_blank">💖来自陈昱行，一位极简博主！</a>' },
    { name: 'herblue', desc: '她的蓝', type: 'dark', info: '<a href="https://wind.ink/" target="_blank">💖来自风清，一位摄影博主，博客「她的蓝」！</a>' },
    { name: 'onojyun', desc: '莫比乌斯', type: 'light', info: '<a  href="https://onojyun.com/" target="_blank">💖来自莫比乌斯，一位文字工作者！</a>' },
    { name: 'dbushell', desc: '香草绿', type: 'dark', info: '<a  href="https://dbushell.com/" target="_blank">💖来自dbushell！</a>' },
    { name: 'auto', desc: '自适应', type: 'auto' }
];
```

- [ ] **Step 3: 创建 `src/config/apps.ts`**

```typescript
export interface AppConfig {
    title: string;
    url: string;
    action: string;
}

export const apps: Record<string, AppConfig> = {
    wechat: { title: '微信', url: 'wechat.png', action: '摸鱼' },
    chrome: { title: 'Chrome', url: 'chrome.png', action: '冲浪' },
    code: { title: 'Visual Studio Code', url: 'code.png', action: '捣鼓一些小玩意儿' },
    'lx-music-desktop.exe': { title: '洛雪音乐播放器', url: 'music.png', action: '听音乐' },
    tim: { title: 'TIM', url: 'qq.png', action: '摸鱼' },
    hydee: { title: '工作ERP', url: 'hydee.jpg', action: '工作' },
    wxwork: { title: '企业微信', url: 'wxwork.png', action: '工作' },
    obsidian: { title: 'Obsidian', url: 'obsidian.png', action: '做笔记' },
    windowsterminal: { title: 'WindowsTerminal', url: 'windowsterminal.png', action: '' },
    tabby: { title: 'Tabby', url: 'tabby.png', action: '维护服务器' },
    et: { title: 'Excel', url: 'excel.png', action: '统计数据中' },
    wps: { title: 'Word', url: 'word.png', action: '编写文档中' },
    hermes: { title: 'Hermes', url: 'word.png', action: '正在和H小姐头脑风暴中...' }
};
```

- [ ] **Step 4: 创建 `src/config/nav.ts`**

footer 数据本阶段先保留在配置中（含 HTML），Phase 4 移入 Footer 组件：

```typescript
export interface NavLink {
    text: string;
    href: string;
}

export const headerNavLinks: NavLink[] = [
    { text: 'Home', href: '/' },
    { text: 'Projects', href: '/projects' },
    { text: 'Blog', href: '/blog' },
    { text: 'Tags', href: '/tags' }
];

export const socialLinks = [
    { name: 'github', title: '我的Github', url: 'https://github.com/rebron1900' },
    { name: 'twitter', title: '我的 X', url: 'https://x.com/Passings_z' },
    { name: 'mastodon', title: '我的联邦宇宙', url: 'https://social.1900.live/@1900' },
    { name: 'telegram', title: '我的TG频道', url: 'https://t.me/rebron1900' },
    { name: 'instagram', title: '我的Instagram', url: 'https://www.instagram.com/rebron1900/' },
    { name: 'neodb', title: '我的Neodb', url: 'https://neodb.social/users/1900/' },
    { name: 'strava', title: '我的Strava运动记录', url: 'https://www.strava.com/athletes/100579236' },
    { name: 'unsplash', title: '我的Unsplash', url: 'https://unsplash.com/@rebron1900' }
];

export const footer = [
    { name: 'rss', html: "<a href='https://github.com/rebron1900' target='_blank'>Github</a> / <a href='/rss'  target='_blank'>Rss</a>" },
    { name: 'power', html: "Power by <a href='https://www.astro.build/' target='_blank'>Astro</a> & <a href='https://www.ghost.org/' target='_blank'>ghost</a>" },
    { name: 'theme', html: "Theme: <a href='https://github.com/rebron1900/astro-book' target='_blank'>Astro-book</a>" },
    { name: 'copyright', html: "<a href='https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-hans' target='_blank'>CC BY-NC-ND 4.0</a>" },
    { name: 'icp', html: "<a href='https://beian.miit.gov.cn/' target='_blank'>蜀ICP备16022135号-2</a>" },
    { name: 'upyun', html: "<a href='https://www.upyun.com/?utm_source=lianmeng&utm_medium=referral' target='_blank'>本站由又拍云提供云储存服务</a>" }
];
```

- [ ] **Step 5: 创建 `src/config/index.ts`（向后兼容聚合导出）**

```typescript
export { siteConfig } from './site';
export { themes } from './theme';
export type { ThemeConfig } from './theme';
export { apps } from './apps';
export type { AppConfig } from './apps';
export { headerNavLinks, socialLinks, footer } from './nav';
export type { NavLink } from './nav';

// 向后兼容：聚合默认导出，保持 `import config from '../config'` + `config.xxx` 用法不变
import { siteConfig } from './site';
import { themes } from './theme';
import { apps } from './apps';
import { headerNavLinks, socialLinks, footer } from './nav';

const config = {
    blogURL: siteConfig.blogURL,
    apiUrl: siteConfig.apiUrl,
    memos: siteConfig.memos,
    customPage: siteConfig.customPage,
    taxonomy: siteConfig.taxonomy,
    themes,
    app: apps,
    social: socialLinks,
    headerNavLinks,
    footer
};

export default config;
```

- [ ] **Step 6: Commit**

```bash
git add src/config/
git commit -m "feat(config): 拆分配置为多模块，保留向后兼容默认导出"
```

---

## Task 4: API 层——DataSource 接口与注册器

**Files:**
- Create: `src/api/types.ts`, `src/api/registry.ts`

- [ ] **Step 1: 创建 `src/api/types.ts`**

```typescript
export interface DataSource<T = unknown> {
    name: string;
    fetch(): Promise<T>;
    transform?(raw: unknown): T;
}
```

- [ ] **Step 2: 创建 `src/api/registry.ts`**

```typescript
import type { DataSource } from './types';

const sources = new Map<string, DataSource>();

export function register<T>(source: DataSource<T>): void {
    sources.set(source.name, source as DataSource);
}

export function get<T>(name: string): DataSource<T> | undefined {
    return sources.get(name) as DataSource<T> | undefined;
}

export function getAll(): DataSource[] {
    return Array.from(sources.values());
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts src/api/registry.ts
git commit -m "feat(api): 引入插件式 DataSource 接口与注册器"
```

---

## Task 5: 拆分 api.ts 为各数据源文件

将 `src/utils/api.ts` 按数据源拆分。每个文件实现 `DataSource` 接口并注册。

**Files:**
- Create: `src/api/ghost.ts`, `src/api/memos.ts`, `src/api/neodb.ts`, `src/api/flux.ts`, `src/api/index.ts`
- Reference: `src/utils/api.ts`（迁移后删除）

- [ ] **Step 1: 创建 `src/api/ghost.ts`**

从 `src/utils/api.ts` 提取所有 Ghost CMS 相关函数（`getAllAuthors`, `getPosts`, `getAllPosts`, `getAllPages`, `getSettings`, `getAllTags`）及 `ExPost`、`Settings` 类型：

```typescript
import type { Page, Post } from '@ts-ghost/content-api';
import { TSGhostContentAPI } from '@ts-ghost/content-api';
import type { DataSource } from './types';

const ghostUrl = import.meta.env.GHOST_API_URL;
const ghostApiKey = import.meta.env.GHOST_API_KEY;
const postLimit = import.meta.env.GHOST_API_POST_LIMIT;

export interface ExPost extends Post {
    type: string;
}

export const getAllAuthors = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const results = await api.authors.browse().include({ 'count.posts': true }).fetch();
    if (!results.success) {
        throw new Error(results.errors.map((e) => e.message).join(', '));
    }
    return { authors: results.data, meta: results.meta };
};

export const getPosts = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const results = await api.posts.browse().include({ authors: true, tags: true }).fetch();
    if (!results.success) {
        throw new Error(results.errors.map((e) => e.message).join(', '));
    }
    return { posts: results.data, meta: results.meta };
};

export const getAllPosts = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const posts: Post[] = [];
    let cursor = await api.posts.browse().include({ authors: true, tags: true }).paginate();
    if (cursor.current.success) posts.push(...cursor.current.data);
    while (cursor.next && posts.length < postLimit) {
        cursor = await cursor.next.paginate();
        if (cursor.current.success) posts.push(...cursor.current.data);
    }
    return posts.map((post) => ({ ...post, type: 'post' }));
};

export const getAllPages = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const pages: Page[] = [];
    let cursor = await api.pages.browse().include({ authors: true, tags: true }).paginate();
    if (cursor.current.success) pages.push(...cursor.current.data);
    while (cursor.next) {
        cursor = await cursor.next.paginate();
        if (cursor.current.success) pages.push(...cursor.current.data);
    }
    return pages.map((page) => ({ ...page, type: 'page' }));
};

export const getSettings = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const res = await api.settings.fetch();
    if (res.success) return res.data;
    return null;
};

export type NonNullable<T> = T extends null | undefined ? never : T;
export type Settings = NonNullable<Awaited<ReturnType<typeof getSettings>>>;

export const getAllTags = async () => {
    const api = new TSGhostContentAPI(ghostUrl, ghostApiKey, 'v5.0');
    const results = await api.tags.browse({ limit: 'all', order: 'count.posts desc' }).include({ 'count.posts': true }).fetch();
    if (!results.success) {
        throw new Error(results.errors.map((e) => e.message).join(', '));
    }
    const postsAll = await getAllPosts();
    const tagsWithPost = results.data.map((tag) => {
        const posts = postsAll.filter((post) => post.tags && post.tags.some((tagItem) => tagItem.slug === tag.slug));
        return { ...tag, posts };
    });
    return tagsWithPost;
};

// DataSource 适配器
export const ghostSource: DataSource<Post[]> = {
    name: 'ghost-posts',
    fetch: getAllPosts
};
```

- [ ] **Step 2: 创建 `src/api/memos.ts`**

```typescript
import config from '../config';
import type { DataSource } from './types';

export interface Memo {
    [key: string]: unknown;
    type: string;
}

export async function getMemos(): Promise<Memo[]> {
    const memos = await fetch(config.memos.url).then((res) => res.json());
    return memos.map((memo: any) => ({ ...memo, type: 'memo' }));
}

export const memosSource: DataSource<Memo[]> = {
    name: 'memos',
    fetch: getMemos
};
```

- [ ] **Step 3: 创建 `src/api/neodb.ts`**

```typescript
import type { DataSource } from './types';

const neodbURL = import.meta.env.NEODB_URL;

export async function getNeodb() {
    const res = await fetch(neodbURL);
    if (!res.ok) throw new Error(`NeoDB ${res.status} ${res.statusText}`);
    return res.json();
}

export const neodbSource: DataSource = {
    name: 'neodb',
    fetch: getNeodb
};
```

- [ ] **Step 4: 创建 `src/api/flux.ts`**

从 `src/utils/api.ts` 完整迁移 `getFlux` 函数体（保留原逻辑）：

```typescript
import type { DataSource } from './types';

const fluxURL = import.meta.env.FLUX_URL;
const fluxKey = import.meta.env.FLUX_KEY;

export async function getFlux() {
    try {
        const feedsResponse = await fetch(`${fluxURL}/categories/4/feeds`, {
            method: 'GET',
            headers: { 'X-Auth-Token': fluxKey }
        });
        if (!feedsResponse.ok) {
            throw new Error(`HTTP error! status: ${feedsResponse.status}`);
        }
        const feedsData = await feedsResponse.json();
        const feeds = feedsData.feeds || feedsData;

        const feedPromises = feeds.map(async (feed: any) => {
            try {
                const entriesResponse = await fetch(`${fluxURL}/feeds/${feed.id}/entries?limit=1&order=published_at&direction=desc`, {
                    method: 'GET',
                    headers: { 'X-Auth-Token': fluxKey }
                });
                if (!entriesResponse.ok) {
                    console.warn(`无法获取feed ${feed.id} 的entries: ${entriesResponse.status}`);
                    return null;
                }
                const entriesData = await entriesResponse.json();
                const entries = entriesData.entries || entriesData;
                if (entries.length > 0) {
                    const latestEntry = entries[0];
                    const domain = new URL(feed.site_url).origin;
                    const updateTime = new Date(latestEntry.published_at || latestEntry.created_at || latestEntry.date).getTime();
                    return { ...latestEntry, feed_id: feed.id, feed: { ...feed, site_url: domain }, update_timestamp: updateTime };
                }
                return null;
            } catch (error) {
                console.error(`获取feed ${feed.id} 数据时出错:`, error);
                return null;
            }
        });

        const results = await Promise.all(feedPromises);
        const validEntries = results.filter((entry) => entry !== null);
        validEntries.sort((a: any, b: any) => (b.update_timestamp || 0) - (a.update_timestamp || 0));
        return validEntries;
    } catch (error) {
        console.error('请求错误:', error);
        return [];
    }
}

export const fluxSource: DataSource = {
    name: 'flux',
    fetch: getFlux
};
```

- [ ] **Step 5: 创建 `src/api/index.ts`**

```typescript
export * from './ghost';
export * from './memos';
export * from './neodb';
export * from './flux';
export * from './types';
export * from './registry';

// 整合内容源（原 getAllContent）
import { getAllPosts } from './ghost';
import { getMemos } from './memos';

export async function getAllContent() {
    try {
        const [posts, memos] = await Promise.all([getAllPosts(), getMemos()]);
        return [...posts, ...memos].sort((a: any, b: any) => {
            const aTime = a.type === 'post' ? new Date(a.created_at).getTime() : a.createdTs * 1000;
            const bTime = b.type === 'post' ? new Date(b.created_at).getTime() : b.createdTs * 1000;
            return bTime - aTime;
        });
    } catch (error) {
        console.error('获取内容失败:', error);
        return [];
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/api/
git commit -m "feat(api): 拆分 api.ts 为各数据源独立文件"
```

---

## Task 6: 迁移 store 与其余 utils

将 `ghost-store.ts` 迁到 `api/store.ts`，其余工具函数迁到 `lib/`，JS 转 TS。本 Task 只创建新文件，不删旧文件、不改 import（Task 7 统一改 import）。

**Files:**
- Create: `src/api/store.ts`, `src/api/strava.ts`, `src/api/actives.ts`
- Create: `src/lib/utils/{common-utils,help,data-utils}.ts`, `src/lib/{search,toc,activitypub,code,map,og-cache,image-cache,cards,albums,coco-message}.ts`
- Reference: `src/utils/*`（迁移后于 Task 8 删除）

- [ ] **Step 1: 创建 `src/api/store.ts`**

把 `src/utils/ghost-store.ts` 内容复制过来，import 路径改为从 `./` 各数据源文件导入：

```typescript
import { getSettings, getPosts, getAllTags, getAllPages, getAllPosts, getNeodb, getFlux, getMemos, getAllAuthors, getAllContent } from './index';
import { atom } from 'nanostores';

const settingsStore = atom(await getSettings());
const postsStore = atom(await getPosts());
const postsAllStore = atom(await getAllPosts());
const tagsStore = atom(await getAllTags());
const pagesStore = atom(await getAllPages());
const neodbStore = atom(await getNeodb());
const fluxStore = atom(await getFlux());
const memosStore = atom(await getMemos());
const authorsStore = atom(await getAllAuthors());
const allContentStore = atom(await getAllContent());

export const settings = settingsStore.get();
export const posts = postsStore.get();
export const tags = tagsStore.get();
export const pages = pagesStore.get();
export const postsAll = postsAllStore.get();
export const neodb = neodbStore.get();
export const flux = fluxStore.get();
export const memos = memosStore.get();
export const authors = authorsStore.get();
export const allContent = allContentStore.get();
```

- [ ] **Step 2: 迁移 `utils/strava.js` → `api/strava.ts`**

复制内容，保留原逻辑，仅改扩展名为 `.ts`，酌情补最小类型。原文件含 `import` 其它模块的路径需改为新位置（若引用 `help` 等，指向 `../lib/utils/help`）。

- [ ] **Step 3: 迁移 `utils/actives.js` → `api/actives.ts`**

同上，复制 + 改扩展名 + 修正内部 import 路径。

- [ ] **Step 4: 迁移 lib/utils 三件套**

- `utils/common-utils.ts` → `lib/utils/common-utils.ts`（内容不变）
- `utils/help.ts` → `lib/utils/help.ts`（内容不变，`import _ from 'lodash-es'` 保留）
- `utils/data-utils.ts` → `lib/utils/data-utils.ts`（内容不变）

- [ ] **Step 5: 迁移其余 utils → lib（JS 转 TS）**

逐个复制内容、改扩展名为 `.ts`、修正内部 import 路径（如 `acitivitypub.js` 引用 `help`，改为 `./utils/help`）：

- `utils/acitivitypub.js` → `lib/activitypub.ts`
- `utils/search.js` → `lib/search.ts`
- `utils/toc.js` → `lib/toc.ts`（引用 `linkedom`，保留）
- `utils/code.js` → `lib/code.ts`
- `utils/map.js` → `lib/map.ts`
- `utils/og-cache.js` → `lib/og-cache.ts`
- `utils/image-cache.js` → `lib/image-cache.ts`
- `utils/cards.min.js` → `lib/cards.ts`
- `utils/albums.ts` → `lib/albums.ts`
- `utils/coco-message.js` → `lib/coco-message.ts`

- [ ] **Step 6: 创建 `src/lib/types.ts`**

从 `src/types/` 目录合并类型定义。先读取 `src/types/` 下所有文件，将其内容合并到 `lib/types.ts`，并 `export`。若 `src/types/` 为空目录则创建空文件占位并添加注释说明。

- [ ] **Step 7: Commit**

```bash
git add src/api/store.ts src/api/strava.ts src/api/actives.ts src/lib/
git commit -m "feat: 迁移 store 与工具函数到 api/ 和 lib/"
```

---

## Task 7: 全局更新 import 路径

把所有引用旧路径的文件改为新路径。这是体量最大的机械性改动。

**Files:**
- Modify: `src` 下所有 `.astro`/`.tsx`/`.jsx`/`.ts`/`.js` 文件中引用 `utils/`、`data/config`、`data/ghost-store`、`data/site-config` 的 import 语句

- [ ] **Step 1: 更新 ghost-store 引用**

将所有 `from '.../utils/ghost-store'` 和 `from '.../data/ghost-store.js'`（含 `.js`、`.ts`、无扩展名各种变体）改为 `from '.../api/store'`。

涉及文件（基于 grep 结果）：
- `src/components/Brand.astro`, `Head.astro`, `Hero.astro`, `MenuNav.astro`, `Relitu.jsx`, `TocTagloop.astro`, `shortcode/Now.astro`
- `src/layouts/BaseLayout.astro`, `FullLayout.astro`
- `src/pages/[...page].astro`, `[slug].astro`, `404.astro`, `500.astro`, `about.astro`, `archives.astro`, `golink.astro`, `links.astro`, `tags.astro`, `.douban.astro`, `.timeline/[...page].astro`, `albums/[slug].astro`, `albums/index.astro`, `douban/[...page].astro`, `garden/[...slug].astro`, `map.astro`, `now/[...page].astro`, `strava.astro`, `tag/[slug]/[...page].astro`, `test.astro`, `rss.xml.js`, `search-data.json.js`

- [ ] **Step 2: 更新 help 引用**

将所有 `from '.../utils/help'`（含 `.js`、`.ts` 变体）改为 `from '.../lib/utils/help'`。涉及 `Footer.astro`, `Head.astro`, `Hero.astro`, `List.astro`, `MenuTaxonomy.astro`, `MenuTheme.jsx`, `Pagination.astro`, `PostMeta.astro`, `Relitu.jsx`, `TocTagloop.astro`, 以及多个 `pages/*` 和 `utils/acitivitypub.js`（已迁，但新文件内引用也要改）。

- [ ] **Step 3: 更新其余 utils 引用**

按映射表逐类替换：
- `utils/acitivitypub` → `lib/activitypub`
- `utils/actives` → `api/actives`
- `utils/code` → `lib/code`
- `utils/coco-message` → `lib/coco-message`
- `utils/cards.min.js` → `lib/cards`
- `utils/map` → `lib/map`
- `utils/search` → `lib/search`
- `utils/image-cache.js` → `lib/image-cache`
- `utils/og-cache.js` → `lib/og-cache`
- `utils/strava` → `api/strava`
- `utils/toc.js` → `lib/toc`
- `utils/albums` → `lib/albums`
- `utils/data-utils` → `lib/utils/data-utils`
- `utils/common-utils` → `lib/utils/common-utils`

注意相对路径层级（`../` vs `../../` vs `../../../`）保持与原文件到新目标的层级一致。

- [ ] **Step 4: 更新 config 引用**

将所有 `from '.../data/config'` 改为 `from '.../config'`（默认导出 `config` 不变，用法无需改）。涉及 `Hero.astro`, `MenuOther.astro`, `MenuTaxonomy.astro`, `MenuTheme.jsx`, `PostAction.astro`, `shortcode/Link.astro`, `pages/now/[...page].astro`。

- [ ] **Step 5: 更新 api.ts 引用**

原 `src/utils/api.ts` 已被 `src/api/*` 取代。检查是否有文件直接 `from '.../utils/api'`——若有，改为从 `.../api` 导入对应具名函数。基于 grep，`api.ts` 仅被 `ghost-store.ts` 引用，而 `ghost-store.ts` 已迁为 `api/store.ts` 并在 Task 6 改好 import，故本步通常无需额外改动，但仍需 grep 确认。

- [ ] **Step 6: 验证构建**

Run: `yarn build`
Expected: PASS（零报错）。若报 "Cannot find module"，对照报错文件修正残留旧路径。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: 全局更新 import 路径到新目录结构"
```

---

## Task 8: 组件重组

将 `src/components/` 下的组件移入 `ui/`、`layout/`、`islands/` 子目录，并更新引用。

**Files:**
- Move: `src/components/*.astro` 与 `*.jsx` → 对应子目录

- [ ] **Step 1: 移动组件**

按 spec 映射：
- **layout/**: `Header.astro`, `Footer.astro`, `Menu.astro`, `MenuNav.astro`, `MenuOther.astro`, `MenuSearch.astro`, `MenuTaxonomy.astro`, `Hero.astro`
- **ui/**: `Heading.astro`, `Pagination.astro`, `PostMeta.astro`, `PostAction.astro`, `RemotePicture.astro`, `Top.astro`, `Brand.astro`
- **islands/**: `Activitypub.astro`, `AlbumCard.astro`, `CodeSlot.astro`, `Comments.astro`, `Head.astro`, `List.astro`, `Toc.astro`, `TocTagloop.astro`, `Map.jsx`, `MenuTheme.jsx`, `Relitu.jsx`

`shortcode/` 保持原位不动。

- [ ] **Step 2: 更新组件间相互引用的相对路径**

组件移动后层级变化（从 `components/X.astro` 到 `components/layout/X.astro`），其内部 `import` 同目录其它组件的路径需相应调整。例如 `MenuNav.astro` 引用其它 Menu 组件，从 `./MenuOther.astro` 可能要改为 `./MenuOther.astro`（同在 layout/ 则不变）或 `../ui/Brand.astro`。逐一检查被移动组件内部的 import。

- [ ] **Step 3: 更新 layouts 与 pages 对组件的引用**

`BaseLayout.astro`、`FullLayout.astro` 及所有 `pages/*` 中 `import` 组件的路径需更新。例如 `import Header from '../components/Header.astro'` → `'../components/layout/Header.astro'`。

- [ ] **Step 4: 验证构建**

Run: `yarn build`
Expected: PASS。若有 "Cannot find module" 报错，按报错修正组件路径。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: 组件按 ui/layout/islands 分组重组"
```

---

## Task 9: 删除旧目录与文件

**Files:**
- Delete: `src/data/`, `src/utils/`, `src/types/`

- [ ] **Step 1: 确认无残留引用**

Run: `grep -rn "utils/\|data/config\|data/ghost-store\|data/site-config\|from '../types\|from '../../types" src/` （或用 Grep 工具搜 `from ['"].*/(utils|data|types)/`）
Expected: 无匹配。若有匹配，回到 Task 7/8 修正。

- [ ] **Step 2: 删除旧目录**

```bash
rm -rf src/data src/utils src/types
```

- [ ] **Step 3: 验证构建**

Run: `yarn build`
Expected: PASS（零报错）。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: 删除旧的 utils/data/types 目录"
```

---

## Task 10: 最终验证与清理

**Files:**
- Modify: `src/env.d.ts`（补充新类型）

- [ ] **Step 1: 全量构建验证**

Run: `yarn build`
Expected: PASS，输出 `dist/` 完整。

- [ ] **Step 2: 检查 dist 产物完整性**

确认关键页面（首页 `[...page].astro`、文章页 `[slug].astro`、`tags.astro`、`archives.astro` 等）均在 `dist/` 中生成，且无空文件。

- [ ] **Step 3: 启动 dev server 抽查**

Run: `yarn dev`，手动访问 `/`、`/tags/`、任意文章页，确认页面正常渲染无控制台报错。确认后 Ctrl+C 停止。

- [ ] **Step 4: 清理 git 中已删除但未追踪的引用**

Run: `git status`，确认工作区干净，所有变更已提交。

- [ ] **Step 5: 推送分支**

```bash
git push origin refactor/architecture
```

- [ ] **Step 6: 最终 Commit（若 Step 1-3 有改动）**

```bash
git add -A
git commit -m "chore: Phase 1 最终验证通过" --allow-empty
git push origin refactor/architecture
```

---

## 验收标准

- [x] `yarn build` 零报错通过
- [x] `src/data/`、`src/utils/`、`src/types/` 目录已删除
- [x] `src/api/`、`src/config/`、`src/lib/`、`src/components/{ui,layout,islands}/` 目录建立
- [x] 依赖减少 7 个（cheerio、svelte-virtual-list、bricks.js、astro-lqip、@shikijs/transformers、astro-og-canvas、loadsh）
- [x] `DataSource` 接口与注册器就位
- [x] dev server 首页及关键页面正常渲染
- [x] 所有改动已提交并推送至 `origin/refactor/architecture`

## 后续阶段衔接

- **Phase 2**：基于新结构补全 TypeScript 类型，引入 Vitest，跑通 `astro check`
- **Phase 3**：所有数据源实现 `DataSource` 并接入注册器，加缓存与请求去重
- **Phase 4**：TailwindCSS 迁移，移除 SCSS，提取 `themes[i].info` 与 `footer` 内联 HTML 到组件
