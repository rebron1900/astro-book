# 架构重构 — Phase 2：TypeScript 化 + Vitest 测试

> **分支:** `refactor/architecture`
> **日期:** 2026-06-28
> **项目:** astro-book (dante-astro-theme)
> **前置:** Phase 1 已完成（目录分层、配置模块化、DataSource 接口、JS→TS 大部分迁移）

## 概述

Phase 1 把代码结构整理完毕，但 TypeScript 类型质量参差：`tsconfig.json` 已 extends `astro/tsconfigs/strict`，却从未跑过 `astro check`；源码中仍有 6 个 `.js`/`.jsx` 文件未迁移、约 15 处显式 `any`、外部数据源（Memos/NeoDB/Flux）无类型定义、Ghost 可选字段在全站裸访问。同时项目零测试覆盖。

Phase 2 的目标：让 `astro check` 在现有 strict 配置下零错误通过，消除显式 `any`，为外部数据补完整类型，并引入 Vitest 对纯函数与数据层建立测试安全网。质量与工作量平衡——不引入 zod 运行时校验，不做组件快照测试。

## 阶段范围

| 领域 | 动作 |
|------|------|
| 类型检查 | 安装并跑通 `astro check`，零错误 |
| JS→TS/TSX | 4 个 Solid islands `.jsx`→`.tsx`；2 个端点 `.js`→`.ts` |
| 外部数据类型 | 复用 Ghost 类型；为 Memos/NeoDB/Flux 手写 interface |
| strict-null | 修复全站 Ghost 可选字段裸访问 |
| 消除 any | 约 15 处显式 `any` 改为具名类型 |
| 环境类型 | `env.d.ts` 补全 `SITE`、修正 `CND_URL` 拼写 |
| 测试 | 引入 Vitest，覆盖 `lib/utils/*` 纯函数 + `api/` 层（mock fetch） |

## 验收标准

- `astro check` 零错误（`error 0 | warning 0`）。
- `yarn build` 仍零错误（1127 页面）。
- `yarn test` 全绿。
- 源码（`src/**`）中 `grep -r ": any\| as any\|<any>"` 无匹配（允许测试文件中 mock 类型必要的 `as`，但不用 `any`）。
- 6 个 `.js`/`.jsx` 文件全部转为 `.ts`/`.tsx`。

## 外部数据类型建模

### 策略：复用 + 手写

- **Ghost CMS**：直接复用 `@ts-ghost/content-api` 导出的 `Post` / `Page` / `Tag` / `Author` 类型与 `Settings`（已在 `ghost.ts` 中 `export type Settings = ...`）。**不重写**。`ExPost extends Post { type: string }` 保留。
- **Memos**：根据 `getMemos` 实际响应手写 `Memo` interface，放 `api/types.ts`。
- **NeoDB**：根据 `getNeodb` 响应手写 `NeoDBItem` interface，放 `api/types.ts`。
- **Flux**：根据 `getFlux` 响应手写 `FluxEntry` / `FluxFeed` interface，放 `api/types.ts`。

### 集中位置

所有数据源类型集中在 `src/api/types.ts`，与 `DataSource<T>` 接口并列。`src/lib/types.ts` 保留为跨层通用类型（目前为空占位）。

理由：`@ts-ghost/content-api` 已提供高质量类型库，重写是浪费且易失同步；其余三个数据源响应结构简单、字段少，手写 interface 足矣，无需 quicktype 等代码生成工具，也无需 zod 运行时校验。

## 工作面（按类型问题分类）

| 类别 | 内容 | 涉及文件 |
|------|------|---------|
| **JS/JSX → TS/TSX** | Solid islands 转 `.tsx`，补 props/返回类型 | `components/islands/{Map,MenuTheme,Relitu,StravaRelitu}.jsx` |
| **端点 JS → TS** | 补 `APIContext` 入参与 `Response` 返回类型 | `pages/rss.xml.js`、`pages/search-data.json.js` |
| **strict-null 修复** | 全站访问 Ghost 可选字段（`tags`/`feature_image`/`published_at`/`html`/`slug`）加守卫或非空断言——astro check 报错大头 | 散布于 `pages/*`、`components/*`、`layouts/*` |
| **消除 any** | `albums.ts`(7)、`tags.astro`(3)、`TocTagloop.astro`(3)、`MenuNav.astro`(1)、`memos.ts`(1) | 同左 |
| **env.d.ts** | 补 `SITE`、修正 `CND_URL`→`CDN_URL`（同步改引用） | `src/env.d.ts` + 引用处 |
| **ghost.ts 清理** | 移除自定义 `NonNullable` 重定义（与 TS 内建冲突），改用内建 | `api/ghost.ts` |
| **依赖调整** | 加 `vitest`、`@astrojs/check`（dev）；移除冗余 `@types/lodash`（保留 `@types/lodash-es`） | `package.json` |

## 测试策略

### 配置

- `vitest.config.ts`：`test.environment = 'node'`，`include = ['tests/**/*.test.ts']`。
- `package.json` scripts 增 `"test": "vitest run"`、`"test:watch": "vitest"`（CI 用 `run`，本地可 watch）。

### 覆盖范围

**纯函数（`lib/utils/help.ts` 等）**：
- `normalizeSlug`：null/undefined 输入、已是 `/` 前缀、普通字符串。
- `normalizeData`：时间戳、ISO 字符串、非法值。
- `getSvg`：已知图标名、未知图标名。
- `groupByDate` / `doubanGroupByDate`：空数组、跨年分组、同日多项。

**api 层（`api/*.ts`）**：
- 每个数据源一个测试文件 `tests/api/<source>.test.ts`。
- `global.fetch = vi.fn()` mock 响应体，断言调用 URL/参数与 transform 后的返回结构。
- Ghost：`vi.mock('@ts-ghost/content-api')` mock `TSGhostContentAPI` 的链式调用，避免真实请求。
- `getAllContent`：mock `getAllPosts` + `getMemos`，断言按时间合并排序。

### 文件位置

测试文件放根 `tests/` 目录（与 `src/` 平级），不污染源码树。`tests/api/`、`tests/lib/` 分子目录。

## 执行策略（增量、构建常绿）

- `astro build` 不做类型检查 → 全程站点保持可构建，每步提交后验证 `yarn build`。
- `astro check` 在里程碑节点跑（首次安装 `@astrojs/check` 后建立基线，分组修复后逐步收敛，最后一组提交后必须零错误）。
- 按逻辑分组提交：
  1. 依赖安装 + `astro check` 基线 + 测试骨架
  2. 数据源类型定义（`api/types.ts`）+ 消除 api 层 any
  3. JS/JSX → TS/TSX 迁移
  4. strict-null 全站修复 + env.d.ts + ghost.ts 清理
  5. Vitest 测试用例编写
- 验证门槛：每个提交组后 `yarn build` 通过；最终 `astro check` + `yarn test` + `yarn build` 三绿。

## 风险与应对

- **strict-null 修复面广**：Ghost 可选字段散布几十处，逐处加守卫工作量大。应对：优先用非空断言 `!`（字段在业务上必有的情况）或可选链 `?.` + 默认值，避免过度重构；以 `astro check` 报错清单为工作清单。
- **Solid JSX 类型**：`.jsx`→`.tsx` 需正确配置 `JSX.Element` 返回类型。`tsconfig` 已有 `jsxImportSource: solid-js`，迁移风险低。
- **测试 mock 复杂度**：Ghost 链式 API mock 较繁琐。应对：封装工厂函数返回 mock 链式对象，复用 across 测试。
- **`CND_URL` 重命名**：全局只有少数引用，重命名后须同步检查 `.env` 与构建产物。

## 不在范围内

- zod 运行时校验（未选）。
- 组件渲染/快照测试、E2E 测试（未选）。
- TailwindCSS 迁移、移除 SCSS（Phase 4）。
- 数据层缓存与请求去重（Phase 3）。
- `themes[i].info` / `footer` 内联 HTML 提取到组件（Phase 4）。
