# 架构重构 — Phase 1：项目结构重组 & 依赖清理

> **分支:** `refactor/architecture`
> **日期:** 2026-06-28
> **项目:** astro-book (dante-astro-theme)

## 概述

基于 Astro 5 的博客站点，集成了多个数据源（Ghost CMS、Memos、NeoDB、Flux RSS、Strava、Mapbox、自建 API 网关），手写 SCSS 样式。代码库随功能增长而自然膨胀——JS/TS 混写、两套配置重叠、18+ 个工具函数文件散落各处、存在未使用/重复的依赖。

Phase 1 的目标是打好基础：清晰的目录分层、合并后的配置模块、精简的依赖清单。后续阶段（TypeScript 化、数据层抽象、TailwindCSS 迁移）都以此为基。

## 阶段范围

| 领域 | 动作 |
|------|------|
| 目录结构 | 按功能分层重新组织 |
| 配置 | 合并 2 个配置文件 → 5 个专注模块，把 UI 展示数据提取到组件 |
| 依赖 | 删除 7 个未使用的包，精简 devDependencies |
| API 层 | 插件式数据源架构（为 Phase 3 做准备） |
| 代码迁移 | 所有工具函数移到新位置，JS 转为 TS |

## 新目录结构

```
src/
├── api/                   # 数据层 —— 所有外部数据请求
│   ├── types.ts           # DataSource 接口、公共类型
│   ├── registry.ts        # 插件式数据源注册器
│   ├── ghost.ts           # Ghost CMS（文章、页面、标签、作者、设置）
│   ├── memos.ts           # Memos 微博客 API
│   ├── neodb.ts           # NeoDB 书影数据
│   ├── flux.ts            # Flux RSS 聚合
│   ├── strava.ts          # Strava 运动数据
│   ├── store.ts           # nanostores 数据仓库（从 ghost-store.ts 迁移）
│   └── index.ts           # 统一导出
├── components/
│   ├── ui/                # 通用 UI 组件
│   │   ├── Heading.astro
│   │   ├── Pagination.astro
│   │   ├── PostMeta.astro
│   │   ├── PostAction.astro
│   │   ├── RemotePicture.astro
│   │   ├── Top.astro
│   │   └── Brand.astro
│   ├── layout/            # 布局级组件
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── Menu.astro
│   │   ├── MenuNav.astro
│   │   ├── MenuOther.astro
│   │   ├── MenuSearch.astro
│   │   ├── MenuTaxonomy.astro
│   │   └── Hero.astro
│   ├── shortcode/         # 短代码组件（保持不变）
│   │   ├── button.astro
│   │   ├── Columns.astro
│   │   ├── Details.astro
│   │   ├── Link.astro
│   │   ├── Now.astro
│   │   ├── OGCard.astro
│   │   └── Strava.astro
│   └── islands/           # SolidJS 交互组件（从 components/ 拆出）
│       ├── Activitypub.astro
│       ├── AlbumCard.astro
│       ├── CodeSlot.astro
│       ├── Comments.astro
│       ├── Head.astro
│       ├── List.astro
│       ├── Toc.astro
│       └── TocTagloop.astro
├── config/                # 所有站点配置
│   ├── index.ts           # 站点基础信息：标题、描述、blogURL
│   ├── site.ts            # 功能配置：apiUrl、customPage、taxonomy、memos
│   ├── nav.ts             # 导航链接、社交链接、底部信息（纯数据，无 HTML）
│   ├── theme.ts           # 主题列表：name、type、desc（不含内联 HTML）
│   └── apps.ts            # 桌面应用状态数据
├── content/               # Astro 内容集合（保持不变）
│   └── Obsidian/
│       ├── blog/
│       └── projects/
├── layouts/               # 布局（保持不变）
│   ├── BaseLayout.astro
│   └── FullLayout.astro
├── lib/                   # 工具/辅助函数
│   ├── utils/             # 通用工具函数
│   │   ├── common-utils.ts
│   │   ├── help.ts
│   │   └── data-utils.ts
│   ├── search.ts          # Fuse.js 搜索（从 utils/search.js 迁移）
│   ├── toc.ts             # 目录生成（从 utils/toc.js 迁移）
│   ├── activitypub.ts     # ActivityPub 辅助（从 utils/acitivitypub.js 迁移）
│   ├── code.ts            # 代码高亮（从 utils/code.js 迁移）
│   ├── map.ts             # Mapbox 辅助（从 utils/map.js 迁移）
│   ├── og-cache.ts        # OG 图片缓存（从 utils/og-cache.js 迁移）
│   ├── image-cache.ts     # 图片缓存（从 utils/image-cache.js 迁移）
│   ├── cards.ts           # 卡片渲染（从 utils/cards.min.js 迁移）
│   ├── albums.ts          # 专辑数据（从 utils/albums.ts 迁移）
│   ├── coco-message.ts    # 消息提示（从 utils/coco-message.js 迁移）
│   └── types.ts           # 全局类型定义
├── pages/                 # 路由（保持不变）
├── styles/                # SCSS（暂留，Phase 4 替换为 Tailwind）
├── icons/                 # SVG 图标（保持不变）
├── assets/                # 静态资源（保持不变）
├── font/                  # 字体文件（保持不变）
├── plugins/               # Astro 插件（保持不变）
└── env.d.ts               # 类型声明
```

### 文件迁移对照表

| 旧路径 | 新路径 | 说明 |
|--------|--------|------|
| `utils/api.ts` | 拆分为 `api/ghost.ts`、`api/memos.ts`、`api/neodb.ts`、`api/flux.ts` | 每个数据源独立文件 |
| `utils/ghost-store.ts` | `api/store.ts` | 重命名，仍用 nanostores |
| `utils/strava.js` | `api/strava.ts` | 转为 TS |
| `utils/actives.js` | `api/actives.ts` | 转为 TS |
| `utils/albums.ts` | `lib/albums.ts` | 纯数据工具 |
| `utils/acitivitypub.js` | `lib/activitypub.ts` | 转为 TS |
| `utils/search.js` | `lib/search.ts` | 转为 TS |
| `utils/toc.js` | `lib/toc.ts` | 转为 TS |
| `utils/code.js` | `lib/code.ts` | 转为 TS |
| `utils/map.js` | `lib/map.ts` | 转为 TS |
| `utils/help.ts` | `lib/utils/help.ts` | |
| `utils/common-utils.ts` | `lib/utils/common-utils.ts` | |
| `utils/data-utils.ts` | `lib/utils/data-utils.ts` | |
| `utils/og-cache.js` | `lib/og-cache.ts` | 转为 TS |
| `utils/image-cache.js` | `lib/image-cache.ts` | 转为 TS |
| `utils/coco-message.js` | `lib/coco-message.ts` | 转为 TS |
| `utils/cards.min.js` | `lib/cards.ts` | 转为 TS（按需重写） |
| `types/*` | 合并至 `lib/types.ts` | 单文件类型定义 |
| `data/site-config.ts` | `config/site.ts` | 合并到配置模块 |
| `data/config.js` | 拆分为 `config/index.ts`、`config/site.ts`、`config/nav.ts`、`config/theme.ts`、`config/apps.ts` | 移除内联 HTML |
| `env.d.ts` | `src/env.d.ts` | 保留，扩展新类型 |

## 插件式数据源架构

为未来扩展而设计，采用注册器模式：

```typescript
// api/types.ts
export interface DataSource<T = unknown> {
  name: string
  fetch(): Promise<T>
  transform?(raw: unknown): T
}

// api/registry.ts
const sources = new Map<string, DataSource>()

export function register<T>(source: DataSource<T>): void {
  sources.set(source.name, source)
}

export function get<T>(name: string): DataSource<T> | undefined {
  return sources.get(name) as DataSource<T> | undefined
}

export function getAll(): DataSource[] {
  return Array.from(sources.values())
}
```

新增数据源只需创建 `src/api/xxx.ts` 实现 `DataSource` 接口并调用 `register()`，已有代码无需修改。

## 配置整合

### 当前问题
- 两个配置文件（`site-config.ts` + `config.js`）职责重叠
- `footer` 和 `themes[i].info` 中存在内联 HTML 字符串——无类型检查、无法转义
- `config.js` 单个文件 180 行，混合了 API URL、主题元数据、应用状态、社交链接

### 设计
将**真正配置**（API URL、功能开关、限流参数）与 **UI 展示数据**（主题描述、应用状态、底部链接）分离：

```typescript
// config/site.ts —— 真正配置
export const siteConfig = {
  blogURL: 'https://1900.live',
  apiUrl: 'https://hapi.190102.xyz:4433/blog',
  customPage: ['archives', 'memos', 'links', 'douban', 'albums', 'map', 'strava', 'tags'],
  taxonomy: [
    { name: '节气', slug: 'jie-qi', desc: '24节气是中国劳动人民的智慧和浪漫...', tags: ['jie-qi'] },
    // ...
  ],
} as const

// config/theme.ts —— 主题元数据（纯数据，无 HTML）
export const themes = [
  { name: 'light', desc: '月牙白', type: 'light' as const },
  { name: 'dark', desc: '极夜黑', type: 'dark' as const },
  { name: 'yayu', desc: '雅余黄', type: 'dark' as const },
  // ...
]

// config/nav.ts —— 导航和社交数据
export const headerNavLinks = [ ... ]
export const socialLinks = [ ... ]

// config/apps.ts —— 桌面应用状态
export const apps = { ... }
```

原有的内联 HTML（`themes[i].info`、`footer[i].html`）移到对应组件（`Footer.astro`、主题切换组件）中直接渲染。

## 依赖清理

### 删除（未使用或冗余）

| 包名 | 原因 |
|------|------|
| `cheerio` | 源码中无任何引用；`linkedom` + `node-html-parser` 已覆盖 HTML 解析需求 |
| `@sveltejs/svelte-virtual-list` | Svelte 组件，项目用 SolidJS |
| `bricks.js` | 源码中无引用 |
| `astro-lqip` | 无引用 |
| `@shikijs/transformers` | Shiki 已内置于 Astro |
| `astro-og-canvas` | ⚠️ 用户要求移除 — 当前 `src/pages/.og/[...image].ts` 依赖此包生成 OG 图片；移除后该路由失效，需后续替代方案 |
| `loadsh`（dev） | 拼写错误；如需 lodash 应使用 `lodash-es` |

### 保留（仍在使用）

| 包名 | 保留原因 |
|------|----------|
| `linkedom` | 用于 `CodeSlot.astro` 和 `toc.js` 的 DOM 解析 |
| `node-html-parser` | 用于 `OGCard.astro` 和 `[slug].astro` 的元素解析 |
| `html-parse-stringify` | 用于 `test.astro` |
| `sass`（dev） | Phase 4 前仍需编译 SCSS |
| 其余依赖 | 源码中均有引用 |

## 执行顺序

每步可独立通过 `astro build` 验证：

1. **依赖清理** — `yarn remove` 删除未使用的包
2. **创建新目录** — `api/`、`config/`、`lib/`、`components/layout/`、`components/islands/`
3. **配置模块** — 编写 `config/*.ts` 文件；从配置中移除内联 HTML，放入组件
4. **API 层** — 拆分 `api.ts` 为各数据源文件；实现 `DataSource` 接口
5. **Store** — 迁移 `ghost-store.ts` → `api/store.ts`
6. **Lib 工具函数** — 迁移 `utils/*` 到 `lib/*` 和 `api/*`；JS 转 TS
7. **组件重组** — 将组件移入 `layout/` 和 `islands/` 子目录
8. **更新所有 import** — 全局替换旧路径为新路径
9. **删除旧目录** — `data/`、`utils/`、`types/`
10. **构建验证** — `astro build` 零报错通过

## 后续阶段（不在本阶段范围）

| 阶段 | 范围 |
|------|------|
| **Phase 2** | 全面 TypeScript 化、类型安全、引入 Vitest 测试 |
| **Phase 3** | 数据层抽象：所有数据源实现 `DataSource`，加入缓存、请求去重 |
| **Phase 4** | TailwindCSS 迁移、移除 SCSS、页面结构优化 |

## 风险与应对

- **Import 路径断裂**: 增量创建目录 + 每批迁移后运行 `astro build` 验证
- **Obsidian 内容路径变更**: 如果将 `src/content/Obsidian/` 改为 git submodule，需同步更新 `astro:content` 集合路径
- **SolidJS islands 引用**: 确保移到 `islands/` 的组件仍正确使用 client 指令（`client:load`、`client:visible` 等）