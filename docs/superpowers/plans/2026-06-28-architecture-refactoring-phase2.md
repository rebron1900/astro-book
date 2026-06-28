# 架构重构 Phase 2 实施计划：TypeScript 化 + Vitest 测试

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在零行为变更的前提下，让 `astro check` 在现有 strict 配置下零错误通过，消除源码显式 `any`，为外部数据源补完整类型，并引入 Vitest 对纯函数与数据层建立测试安全网。

**Architecture:** 纯类型与测试增强——不改运行时行为。数据类型集中放 `api/types.ts`；Ghost 复用 `@ts-ghost/content-api` 类型，Memos/NeoDB/Flux 手写 interface；strict-null 修复以 `astro check` 报错清单为工作清单；测试用 `vi.fn` mock `fetch`。验证门槛为 `astro check` + `yarn build` + `yarn test` 三绿。

**Tech Stack:** Astro 5, SolidJS, TypeScript (strict), Vitest, `@astrojs/check`, yarn

**Spec:** `docs/superpowers/specs/2026-06-28-architecture-refactoring-phase2-design.md`

---

## 重要约定

1. **零行为变更**：本阶段只补类型、写测试、迁移文件扩展名，不改变任何运行时逻辑。`as` 断言与 `?.` 守卫只用于让类型收敛，不改变实际取值。
2. **验证门槛**：每个 Task 结束后跑 `yarn build`（不做类型检查，保证站点常绿）。`astro check` 在 Task 1 建立基线，Task 6 收敛到零错误。
3. **TDD**：测试先行。先写失败测试，再补类型让测试通过。
4. **频繁提交**：每个 Task 完成且验证通过后立即 commit。
5. **any 处理原则**：源码 `src/**`（不含 `tests/`）最终 `grep -rn ": any\| as any\|<any>"` 无匹配。

## 文件结构总览

**新增：**
- `vitest.config.ts`（根）
- `tests/lib/help.test.ts`、`tests/lib/data-utils.test.ts`（若 data-utils 有可测纯函数）
- `tests/api/ghost.test.ts`、`tests/api/memos.test.ts`、`tests/api/neodb.test.ts`、`tests/api/flux.test.ts`、`tests/api/index.test.ts`（getAllContent）
- `tests/helpers/mock-fetch.ts`（复用的 fetch mock 工厂）

**修改：**
- `src/api/types.ts`（补 Memos/NeoDB/Flux 类型）
- `src/api/{memos,neodb,flux,ghost}.ts`（应用类型、消除 any）
- `src/env.d.ts`（补 SITE、CND_URL→CDN_URL）
- `src/components/ui/RemotePicture.astro`（CND_URL→CDN_URL）
- `src/components/islands/{Map,MenuTheme,Relitu,StravaRelitu}.jsx` → `.tsx`
- `src/pages/rss.xml.js` → `rss.xml.ts`、`src/pages/search-data.json.js` → `search-data.json.ts`
- 全站 Ghost 可选字段访问处（strict-null 修复，以 `astro check` 清单为准）
- `src/lib/albums.ts`、`src/pages/tags.astro`、`src/components/islands/TocTagloop.astro`、`src/components/layout/MenuNav.astro`（消除 any）
- `package.json`（加 vitest/@astrojs/check，移除 @types/lodash）

---

## Task 1: 安装依赖 + astro check 基线 + Vitest 骨架

**Files:**
- Modify: `package.json`, `yarn.lock`
- Create: `vitest.config.ts`

- [ ] **Step 1: 安装 astro check 与 vitest**

```bash
yarn add -D @astrojs/check vitest
```

- [ ] **Step 2: 移除冗余 @types/lodash（源码只用 lodash-es，保留 @types/lodash-es）**

```bash
yarn remove @types/lodash
```

- [ ] **Step 3: 创建 `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts']
    }
});
```

- [ ] **Step 4: 在 package.json 增加 test 脚本**

在 `scripts` 中加入（保留现有脚本）：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: 建立 astro check 基线（记录当前错误数，不修复）**

Run: `yarn astro check`
Expected: 输出若干 error（预期），记录错误总数作为基线。此步不要求零错误。

- [ ] **Step 6: 验证 build 仍通过**

Run: `yarn build`
Expected: PASS（1127 页面零错误）

- [ ] **Step 7: 创建空测试目录占位 + 跑通空测试**

创建 `tests/.gitkeep`，运行 `yarn test`，预期「No test files found」或类似空跑成功。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: 安装 vitest 与 @astrojs/check，建立测试骨架"
```

---

## Task 2: 数据源类型定义 + 消除 api 层 any

**Files:**
- Modify: `src/api/types.ts`, `src/api/memos.ts`, `src/api/neodb.ts`, `src/api/flux.ts`, `src/api/ghost.ts`

- [ ] **Step 1: 在 `src/api/types.ts` 补充 Memos/NeoDB/Flux 类型**

在现有 `DataSource` 接口后追加（保留 `DataSource` 不动）：

```typescript
/** Memos 微博客条目（按实际 API 响应字段） */
export interface Memo {
    type: string;
    content: string;
    createdTs: number;
    updatedTs: number;
    creatorName: string;
    resourceList: Array<{
        type: string;
        filename: string;
        externalLink: string;
    }>;
    [key: string]: unknown;
}

/** Flux RSS 单条聚合结果 */
export interface FluxEntry {
    feed_id: string;
    feed: FluxFeed;
    update_timestamp: number;
    title?: string;
    url?: string;
    content?: string;
    published_at?: string;
    created_at?: string;
    [key: string]: unknown;
}

export interface FluxFeed {
    id: string;
    site_url: string;
    title?: string;
    [key: string]: unknown;
}

/** NeoDB 书影条目（响应为对象数组） */
export interface NeoDBItem {
    uuid: string;
    url: string;
    api_url: string;
    category: string;
    parent_uuid: string | null;
    display_title: string;
    external_resources: Array<{ url: string }>;
    [key: string]: unknown;
}
```

- [ ] **Step 2: 修改 `src/api/memos.ts` 消除 any**

将 `getMemos` 中的 `(memo: any)` 改为具名类型：

```typescript
import config from '../config';
import type { DataSource, Memo } from './types';

export async function getMemos(): Promise<Memo[]> {
    const memos = (await fetch(config.memos.url).then((res) => res.json())) as Memo[];
    return memos.map((memo) => ({
        ...memo,
        type: 'memo'
    }));
}

export const memosSource: DataSource<Memo[]> = {
    name: 'memos',
    fetch: getMemos
};
```

注意：移除原文件内的 `export interface Memo` 定义（已移到 `types.ts`）。检查是否有其它文件 `import { Memo } from './memos'`，改为 `from './types'` 或 `from './index'`。

- [ ] **Step 3: 修改 `src/api/neodb.ts` 补返回类型**

```typescript
import type { DataSource, NeoDBItem } from './types';

const neodbURL = import.meta.env.NEODB_URL;

export const getNeodb = async (): Promise<NeoDBItem[]> => {
    const res = await fetch(neodbURL);
    if (!res.ok) throw new Error(`NeoDB ${res.status} ${res.statusText}`);
    return (await res.json()) as NeoDBItem[];
};

export const neodbSource: DataSource<NeoDBItem[]> = {
    name: 'neodb',
    fetch: getNeodb
};
```

- [ ] **Step 4: 修改 `src/api/flux.ts` 消除 any + 补类型**

将 `getFlux` 内的 `(feed: any)`、`(a: any, b: any)` 改为具名类型，返回类型标注为 `Promise<FluxEntry[]>`：

```typescript
import type { DataSource, FluxEntry, FluxFeed } from './types';

const fluxURL = import.meta.env.FLUX_URL;
const fluxKey = import.meta.env.FLUX_KEY;

export async function getFlux(): Promise<FluxEntry[]> {
    try {
        const feedsResponse = await fetch(`${fluxURL}/categories/4/feeds`, {
            method: 'GET',
            headers: { 'X-Auth-Token': fluxKey }
        });
        if (!feedsResponse.ok) {
            throw new Error(`HTTP error! status: ${feedsResponse.status}`);
        }
        const feedsData = await feedsResponse.json();
        const feeds: FluxFeed[] = feedsData.feeds || feedsData;

        const feedPromises = feeds.map(async (feed): Promise<FluxEntry | null> => {
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
                    return {
                        ...latestEntry,
                        feed_id: feed.id,
                        feed: { ...feed, site_url: domain },
                        update_timestamp: updateTime
                    };
                }
                return null;
            } catch (error) {
                console.error(`获取feed ${feed.id} 数据时出错:`, error);
                return null;
            }
        });

        const results = await Promise.all(feedPromises);
        const validEntries = results.filter((entry): entry is FluxEntry => entry !== null);
        validEntries.sort((a, b) => (b.update_timestamp || 0) - (a.update_timestamp || 0));
        return validEntries;
    } catch (error) {
        console.error('请求错误:', error);
        return [];
    }
}

export const fluxSource: DataSource<FluxEntry[]> = {
    name: 'flux',
    fetch: getFlux
};
```

- [ ] **Step 5: 修改 `src/api/ghost.ts` 移除自定义 NonNullable 重定义**

删除 `export type NonNullable<T> = ...` 行（与 TS 内建冲突）。`Settings` 类型改用内建：

```typescript
export type Settings = NonNullable<Awaited<ReturnType<typeof getSettings>>>;
```

- [ ] **Step 6: 验证 build**

Run: `yarn build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): 为 Memos/NeoDB/Flux 补类型，消除 api 层 any"
```

---

## Task 3: env.d.ts 修正 + CND_URL 重命名

**Files:**
- Modify: `src/env.d.ts`, `src/components/ui/RemotePicture.astro`

- [ ] **Step 1: 修正 `src/env.d.ts`**

将 `CND_URL` 重命名为 `CDN_URL`，补充 `SITE`（Astro 内建 `import.meta.env.SITE`）：

```typescript
/// <reference path="../.astro/types.d.ts" />
interface ImportMetaEnv {
    readonly GHOST_API_URL: string;
    readonly GHOST_API_KEY: string;
    readonly GHOST_API_POST_LIMIT: number;
    readonly NEODB_URL: string;
    readonly FLUX_URL: string;
    readonly FLUX_KEY: string;
    readonly CDN_URL: string;
    readonly MAP_URL: string;
    readonly MAP_KEY: string;
    readonly SITE: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: 修改 `src/components/ui/RemotePicture.astro` 引用**

将 `import.meta.env.CND_URL` 改为 `import.meta.env.CDN_URL`（第 76 行附近）。

- [ ] **Step 3: 检查 .env 文件同步**

检查项目根 `.env` / `.env.example`（若存在）中是否有 `CND_URL`，同步改为 `CDN_URL`。

Run: `grep -rn "CND_URL" . --include='.env*'`
若匹配，编辑对应文件改名为 `CDN_URL`。

- [ ] **Step 4: 验证 build**

Run: `yarn build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: env.d.ts 修正 CND_URL 拼写并补充 SITE 类型"
```

---

## Task 4: JS/JSX → TS/TSX 迁移（4 islands + 2 endpoints）

**Files:**
- Rename: `src/components/islands/{Map,MenuTheme,Relitu,StravaRelitu}.jsx` → `.tsx`
- Rename: `src/pages/rss.xml.js` → `rss.xml.ts`、`src/pages/search-data.json.js` → `search-data.json.ts`
- Modify: 引用上述文件的 import 路径（去掉扩展名变体，TS 解析自动处理）

- [ ] **Step 1: 迁移 4 个 Solid islands 为 .tsx**

对每个文件用 `git mv`：
```bash
git mv src/components/islands/Map.jsx src/components/islands/Map.tsx
git mv src/components/islands/MenuTheme.jsx src/components/islands/MenuTheme.tsx
git mv src/components/islands/Relitu.jsx src/components/islands/Relitu.tsx
git mv src/components/islands/StravaRelitu.jsx src/components/islands/StravaRelitu.tsx
```

这 4 个组件均无 props（读 store/env），函数签名 `const X = () => {...}` 无需改类型。逐个打开补必要类型：
- `MenuTheme.tsx`：`changeTheme`/`initViewTrans` 的 `theme` 参数标注为 `ThemeConfig`（从 `../../config` 导入 type）。
- `Relitu.tsx` / `StravaRelitu.tsx`：`parseDate(str: string)`、`getThisSunday(date: Date)`、`dateBuild(activities: any[], today: Date)` —— `activities` 改为 `ExPost[]`（从 `../../api/ghost` 导入 type）或具名类型。
- `Map.tsx`：`createSignal('')` 已推断，无需改。

- [ ] **Step 2: 迁移 2 个端点为 .ts**

```bash
git mv src/pages/rss.xml.js src/pages/rss.xml.ts
git mv src/pages/search-data.json.js src/pages/search-data.json.ts
```

`rss.xml.ts`：补 `GET` 的入参与返回类型：
```typescript
import type { APIContext } from 'astro';
// ...
export async function GET(context: APIContext) {
    return rss({ /* 不变 */ });
}
```

`search-data.json.ts`：同样补 `APIContext`：
```typescript
import type { APIContext } from 'astro';
// ...
export async function GET(context: APIContext) {
    // ...
    return new Response(JSON.stringify(postsdata));
}
```

- [ ] **Step 3: 检查并修正引用路径**

Astro 端点路由由文件名决定，`rss.xml.ts` 仍映射 `/rss.xml`，引用处无需改。搜索是否有文件用带扩展名 import 引用这些（通常无）。

Run: `grep -rn "rss.xml.js\|search-data.json.js" src/`
Expected: 无匹配（Astro 端点不直接 import）。

- [ ] **Step 4: 验证 build**

Run: `yarn build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: 4 个 Solid islands 与 2 个端点迁移为 TS/TSX"
```

---

## Task 5: 消除剩余显式 any（albums / tags / TocTagloop / MenuNav）

**Files:**
- Modify: `src/lib/albums.ts`, `src/pages/tags.astro`, `src/components/islands/TocTagloop.astro`, `src/components/layout/MenuNav.astro`

- [ ] **Step 1: 修改 `src/lib/albums.ts`（7 处 any）**

`albums.ts` 操作 Ghost `Post[]` 与相册聚合结构。读取文件顶部确认 `Album` 结构后，将：
- `posts: any[]` → `posts: Post[]`（从 `@ts-ghost/content-api` 导入 `Post`）
- `tag: any` → `tag: Tag`（从 `@ts-ghost/content-api` 导入 `Tag`）
- `extractImagesFromPost(post: any)` → `(post: Post)`
- `getSolarTermGroups(album: any)` → 用 `Album` 接口（文件内已定义 `Album`，引用之）
- `yearlyGroups: any` → `yearlyGroups: Record<string, YearGroup>`（按实际结构定义或用 `Record<string, unknown>` 若结构复杂）
- `album.posts.forEach((post: any) =>` → `(post: Post)`
- `yearlySolarTermGroups: any[]` → 具名数组类型

若 `Album` 接口未在文件内定义，根据用法补一个：
```typescript
import type { Post, Tag } from '@ts-ghost/content-api';

interface Album {
    posts: Post[];
    tag: Tag;
}
```

- [ ] **Step 2: 修改 `src/pages/tags.astro`（3 处 any，均为 Tag 过滤/排序）**

`.filter((item: any) =>` / `.sort((a: any, b: any) =>` / `.map((item: any) =>` —— 这里 `item` 是 `Tag`（含 `count.posts`）。导入类型：

```typescript
import type { Tag } from '@ts-ghost/content-api';
```
将 `any` 改为 `Tag`。`tags` 变量本身若来自 `api/store` 的 `tags`，确认其类型已推导为 `Tag[]`（含 `posts` 扩展，见 `getAllTags` 返回）。

- [ ] **Step 3: 修改 `src/components/islands/TocTagloop.astro`（3 处 any，同 tags 模式）**

同 Step 2，导入 `Tag` 类型，将 3 处 `any` 改 `Tag`。

- [ ] **Step 4: 修改 `src/components/layout/MenuNav.astro`（icon/cleanLabel any）**

`const node: { icon?: any; item: typeof rawItem; cleanLabel?: any }` —— `icon` 是 SVG 字符串（`getSvg` 返回 `string`），`cleanLabel` 是字符串。改为：

```typescript
const node: { icon?: string; item: typeof rawItem; cleanLabel?: string } = { item: rawItem };
```

- [ ] **Step 5: 验证源码无 any**

Run: `grep -rn ": any\| as any\|<any>" src/`
Expected: 无匹配（测试文件不在 src/）。

- [ ] **Step 6: 验证 build**

Run: `yarn build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: 消除 albums/tags/TocTagloop/MenuNav 中的显式 any"
```

---

## Task 6: strict-null 全站修复（以 astro check 清单为准）

**Files:**
- Modify: `astro check` 报错的所有文件（主要在 `pages/`、`components/`、`layouts/`）

- [ ] **Step 1: 跑 astro check 导出完整错误清单**

Run: `yarn astro check 2>&1 | tee /tmp/astro-check.log`
预期：大量 `Object is possibly 'undefined'` / `Object is possibly 'null'`，集中在 Ghost 可选字段访问（`post.tags`、`item.feature_image`、`item.published_at`、`item.html`、`item.slug` 等）。

- [ ] **Step 2: 按文件分组修复**

对清单中每个报错文件，按以下优先级处理：
1. **可选链 `?.`**：当字段可能 undefined 但代码已隐式处理（如 `item.feature_image ? ... : ...`），用 `?.` 或保持三元但补非空。
2. **非空断言 `!`**：当字段在业务上必有（如已发表文章的 `published_at`、`slug`），用 `item.published_at!`。谨慎使用，每处确认业务必填。
3. **守卫加默认值**：`const tags = item.tags ?? [];` 处理 `tags` 可能 undefined。

逐文件修复，每修一组文件后跑 `yarn build` 确保不破坏运行时。

- [ ] **Step 3: 跑 astro check 收敛**

Run: `yarn astro check`
迭代 Step 2 直到 `error 0`。warning 可保留（Phase 2 不强制零 warning，但目标零 error）。

- [ ] **Step 4: 验证 build**

Run: `yarn build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: 修复全站 strict-null 报错，astro check 零错误"
```

---

## Task 7: Vitest 测试用例 — 纯函数

**Files:**
- Create: `tests/lib/help.test.ts`

- [ ] **Step 1: 写 normalizeSlug 测试（先失败）**

`tests/lib/help.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { normalizeSlug, normalizeData, getSvg, groupByDate, doubanGroupByDate } from '../../src/lib/utils/help';

describe('normalizeSlug', () => {
    it('adds leading slash if missing', () => {
        expect(normalizeSlug('post-title')).toBe('/post-title/');
    });
    it('adds trailing slash if missing', () => {
        expect(normalizeSlug('/post-title')).toBe('/post-title/');
    });
    it('preserves both slashes', () => {
        expect(normalizeSlug('/post-title/')).toBe('/post-title/');
    });
});
```

Run: `yarn test`
Expected: PASS（函数已存在，类型已修好）。

- [ ] **Step 2: 写 normalizeData 测试**

追加到同一文件：
```typescript
describe('normalizeData', () => {
    it('handles unix timestamp in seconds', () => {
        expect(normalizeData(1609459200)).toBe('2021-01-01');
    });
    it('handles unix timestamp in milliseconds', () => {
        expect(normalizeData(1609459200000)).toBe('2021-01-01');
    });
    it('handles ISO string', () => {
        expect(normalizeData('2021-01-01T00:00:00Z')).toBe('2021-01-01');
    });
    it('returns null for invalid date', () => {
        expect(normalizeData('not-a-date')).toBeNull();
    });
});
```

Run: `yarn test`
Expected: PASS

- [ ] **Step 3: 写 getSvg 测试**

```typescript
describe('getSvg', () => {
    it('returns svg with given name and default viewbox/classes', () => {
        const svg = getSvg('github');
        expect(svg).toContain('<svg');
        expect(svg).toContain('xlink:href="/icons.svg#github"');
        expect(svg).toContain('viewBox="0 0 24 24"');
        expect(svg).toContain('class="book-icon"');
    });
    it('respects custom viewbox and classes', () => {
        const svg = getSvg('theme', '0 0 30 30', 'custom-class');
        expect(svg).toContain('viewBox="0 0 30 30"');
        expect(svg).toContain('class="custom-class"');
    });
});
```

Run: `yarn test`
Expected: PASS

- [ ] **Step 4: 写 groupByDate / doubanGroupByDate 测试**

```typescript
describe('groupByDate', () => {
    it('groups posts by year then month, desc', () => {
        const data = [
            { published_at: '2021-03-01' },
            { published_at: '2021-01-15' },
            { published_at: '2020-12-20' }
        ];
        const result = groupByDate(data as any);
        expect(result[0].year).toBe('2021');
        expect(result[0].data[0].month).toBe('03');
        expect(result[1].year).toBe('2020');
    });
    it('returns empty for empty input', () => {
        expect(groupByDate([])).toEqual([]);
    });
});

describe('doubanGroupByDate', () => {
    it('groups by created_time year/month', () => {
        const data = [
            { created_time: '2021-03-01' },
            { created_time: '2021-01-15' }
        ];
        const result = doubanGroupByDate(data as any);
        expect(result[0].year).toBe('2021');
        expect(result[0].data[0].month).toBe('03');
    });
});
```

Run: `yarn test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: 新增 lib/utils/help 纯函数测试"
```

---

## Task 8: Vitest 测试用例 — api 层（mock fetch）

**Files:**
- Create: `tests/helpers/mock-fetch.ts`, `tests/api/memos.test.ts`, `tests/api/neodb.test.ts`, `tests/api/flux.test.ts`, `tests/api/index.test.ts`

- [ ] **Step 1: 创建 fetch mock 工厂**

`tests/helpers/mock-fetch.ts`：
```typescript
import { vi } from 'vitest';

export function mockFetchResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
    const response = {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        statusText: init.statusText ?? 'OK',
        json: async () => body
    };
    global.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
    return vi.mocked(global.fetch);
}

export function mockFetchResponses(...bodies: unknown[]) {
    const responses = bodies.map((body) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body
    }));
    global.fetch = vi.fn()
        .mockResolvedValueOnce(responses[0])
        .mockResolvedValueOnce(responses[1] ?? responses[0]) as unknown as typeof fetch;
    return vi.mocked(global.fetch);
}
```

- [ ] **Step 2: 写 memos 测试（先失败 → 通过）**

`tests/api/memos.test.ts`：
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockFetchResponse } from '../helpers/mock-fetch';
import { getMemos } from '../../src/api/memos';

describe('getMemos', () => {
    beforeEach(() => {
        mockFetchResponse([
            { content: 'hello', createdTs: 1609459200, updatedTs: 1609459200, creatorName: 'me', resourceList: [] }
        ]);
    });

    it('fetches memos and tags type=memo', async () => {
        const memos = await getMemos();
        expect(memos).toHaveLength(1);
        expect(memos[0].type).toBe('memo');
        expect(memos[0].content).toBe('hello');
    });

    it('calls the configured memos url', async () => {
        await getMemos();
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/memo'));
    });
});
```

Run: `yarn test tests/api/memos.test.ts`
Expected: PASS

- [ ] **Step 3: 写 neodb 测试**

`tests/api/neodb.test.ts`：
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockFetchResponse } from '../helpers/mock-fetch';
import { getNeodb } from '../../src/api/neodb';

describe('getNeodb', () => {
    beforeEach(() => {
        mockFetchResponse([
            { uuid: 'abc', url: 'https://neodb.social/m/abc', category: 'movie', display_title: 'Test' }
        ]);
    });

    it('returns parsed items', async () => {
        const items = await getNeodb();
        expect(items[0].uuid).toBe('abc');
        expect(items[0].category).toBe('movie');
    });

    it('throws on non-ok response', async () => {
        mockFetchResponse({}, { ok: false, status: 500, statusText: 'Server Error' });
        await expect(getNeodb()).rejects.toThrow('NeoDB 500');
    });
});
```

Run: `yarn test tests/api/neodb.test.ts`
Expected: PASS

- [ ] **Step 4: 写 flux 测试（多级 fetch mock）**

`tests/api/flux.test.ts`：
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockFetchResponses } from '../helpers/mock-fetch';
import { getFlux } from '../../src/api/flux';

describe('getFlux', () => {
    beforeEach(() => {
        // 第一次 fetch：feeds 列表；第二次：每个 feed 的 entries
        mockFetchResponses(
            { feeds: [{ id: '1', site_url: 'https://example.com', title: 'Example' }] },
            { entries: [{ title: 'Post', url: '/post', published_at: '2021-01-01T00:00:00Z' }] }
        );
    });

    it('returns flux entries with feed info', async () => {
        const entries = await getFlux();
        expect(entries).toHaveLength(1);
        expect(entries[0].feed_id).toBe('1');
        expect(entries[0].feed.site_url).toBe('https://example.com');
        expect(entries[0].update_timestamp).toBeGreaterThan(0);
    });

    it('returns empty array on fetch error', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
        const entries = await getFlux();
        expect(entries).toEqual([]);
    });
});
```

Run: `yarn test tests/api/flux.test.ts`
Expected: PASS

- [ ] **Step 5: 写 getAllContent 测试（mock store 依赖）**

`tests/api/index.test.ts`：
```typescript
import { describe, it, expect, vi } from 'vitest';

// mock getMemos 与 getAllPosts，验证 getAllContent 按时间合并排序
vi.mock('../../src/api/memos', () => ({
    getMemos: vi.fn().mockResolvedValue([
        { type: 'memo', createdTs: 1609459200 } // 2021-01-01
    ]),
    memosSource: { name: 'memos', fetch: () => Promise.resolve([]) }
}));

vi.mock('../../src/api/ghost', () => ({
    getAllPosts: vi.fn().mockResolvedValue([
        { type: 'post', created_at: '2022-01-01T00:00:00Z' }
    ]),
    getAllAuthors: vi.fn(),
    getPosts: vi.fn(),
    getAllPages: vi.fn(),
    getSettings: vi.fn(),
    getAllTags: vi.fn(),
    ghostSource: { name: 'ghost-posts', fetch: () => Promise.resolve([]) }
}));

const { getAllContent } = await import('../../src/api/index');

describe('getAllContent', () => {
    it('merges posts and memos sorted by time desc', async () => {
        const content = await getAllContent();
        expect(content).toHaveLength(2);
        // post (2022) 应在 memo (2021) 前
        expect(content[0].type).toBe('post');
        expect(content[1].type).toBe('memo');
    });
});
```

Run: `yarn test tests/api/index.test.ts`
Expected: PASS

- [ ] **Step 6: 跑全部测试**

Run: `yarn test`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: 新增 api 层数据源测试（mock fetch）"
```

---

## Task 9: 最终验证（三绿）+ 推送

**Files:**
- 无代码改动（仅验证）

- [ ] **Step 1: astro check 零错误**

Run: `yarn astro check`
Expected: `error 0`（warning 可保留）

- [ ] **Step 2: yarn build 零错误**

Run: `yarn build`
Expected: PASS，1127 页面

- [ ] **Step 3: yarn test 全绿**

Run: `yarn test`
Expected: 所有测试通过

- [ ] **Step 4: 源码 any 终检**

Run: `grep -rn ": any\| as any\|<any>" src/`
Expected: 无匹配

- [ ] **Step 5: 确认无残留 .js/.jsx**

Run: `find src -name '*.js' -o -name '*.jsx'`
Expected: 无输出

- [ ] **Step 6: 工作区干净 + 推送**

```bash
git status
git push origin refactor/architecture
```

---

## 验收标准

- [ ] `astro check` 零 error
- [ ] `yarn build` 零错误（1127 页面）
- [ ] `yarn test` 全绿
- [ ] `src/` 中无显式 `any`
- [ ] `src/` 中无 `.js`/`.jsx` 文件
- [ ] 所有改动已提交并推送至 `origin/refactor/architecture`
