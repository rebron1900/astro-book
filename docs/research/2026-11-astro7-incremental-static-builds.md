# Astro 7.x 增量静态构建（incremental static builds）调研

> **日期:** 2026-11 · **分支:** refactor/architecture · **项目:** astro-book（当前 Astro 5.11.0）
> **问题:** 静态站点构建时能否增量/持久化编译，如何配置、缓存在哪里、能否在 CI 复用、与「外部数据→本地 JSON→构建读取」模式如何配合、5→7 迁移注意点。

## 结论摘要

Astro **7.2.0** 引入了**实验性**的 `experimental.incrementalBuild`（官方页面标注为 "Experimental"，type: boolean, default: false, added in astro@7.2.0）。它不是「内容集合级」的通用构建缓存，而是**只对 `getStaticPaths()` 返回且带 `cacheKey` 的动态路由页面**生效：当页面的数据 `cacheKey` 与模块依赖图哈希都未变时，跳过重新渲染，从缓存目录拷贝上一次的输出。它目前是 experimental flag，**不是稳定功能**。

- **配置:** `astro.config.mjs` 设 `experimental: { incrementalBuild: true }`，并在 `getStaticPaths()` 返回项里加 `cacheKey`。
- **缓存位置:** `cacheDir`，默认 `node_modules/.astro/`（含 build manifest + 已渲染页面的可复用输出）。
- **CI 复用:** 在 `astro build` 前缓存/恢复**这一个目录**即可；输出目录每次构建先清空，跳过的页面从 cacheDir 恢复。`astro build --force` 可忽略缓存全量重渲染。
- **与「本地 JSON → 构建读取」模式:** 完全可配合。对每个 JSON 条目提供一个会随数据变化而变化的 `cacheKey`（如内容哈希 / `updatedAt` / loader 提供的 `digest`），则只有数据变化的页面被重建；依赖图未变的页面被跳过。
- **当前限制:** `build.concurrency > 1` 时禁用；服务端 islands 需固定 `ASTRO_KEY`；middleware 改动不会失效缓存（需 `--force`）。

## 配置方式（astro.config.mjs）

```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  experimental: { incrementalBuild: true },
});
```

`getStaticPaths()` 返回项带 `cacheKey`（一个字符串，内容变化时改变——内容哈希、版本号、`updatedAt` 或 loader 的 `digest` 均可）：

```js
export async function getStaticPaths() {
  const posts = await fetchPosts();
  return posts.map((post) => ({
    params: { slug: post.slug },
    props: { post },
    cacheKey: post.updatedAt,   // 或 post.digest
  }));
}
```

用内容集合时，loader 可为每条记录提供 `digest`（条目变化即变，7.2.0 新增的 `CollectionEntry.digest`），可直接作为 `cacheKey: String(entry.digest)`。

## 缓存位置与失效机制

- 增量缓存存在项目的 `cacheDir`（默认 `node_modules/.astro/`），含 build manifest 与已渲染页面输出。每次构建先清空 `dist`（输出目录），再从 cacheDir 恢复跳过的页面。
- 失效条件：`cacheKey` 与上次不同 → 重渲染；页面**模块依赖图**（layout、组件、import 文件内容）哈希变化 → 重渲染；`astro.config` 或项目依赖变化 → **整个缓存失效**；从 `getStaticPaths()` 移除的页面自动清理。

## CI（GitHub Actions）复用方式

官方文档明确：**只需缓存/恢复 `node_modules/.astro/` 这一个目录**，无需其它持久化。缺失时全部重渲染。可用 `actions/cache` 对该目录做缓存，并在 `astro build` 前 restore。`astro build --force` 用于强制全量重建但仍写新缓存。

## 与「定时同步外部数据 → 本地 JSON → 构建读取」的配合

配合方式：定时任务把 Memos/NeoDB/Flux 等外部数据写入本地 JSON；构建时 loader 读取这些 JSON。对每个条目生成随内容变化的 `cacheKey`（如对 JSON 内容取哈希，或 loader 提供的 `digest`），那么**只有内容变化的条目对应页面被重建**；数据未变且依赖图未变的页面直接拷贝上一次输出，大幅缩短构建。关键前提是该页面走 `getStaticPaths()` 且返回 `cacheKey`——纯静态（非 `getStaticPaths`）页面每次仍会渲染。

## 从 5.x 迁移注意点（重点：content collections / content layer）

- **Node 版本:** Astro 7.2.0 要求 `node >=22.12.0`（npm registry engines 字段）。当前环境 `v24.18.1` 满足。
- **Content Collections 强制走 Content Layer（5.x 已引入，6.0 移除旧 API）:**
  - Astro **6.0** 彻底移除旧的 Content Collections API 与 `legacy.collections` flag，所有集合必须用 Content Layer API（v5.0 引入）。
  - 需把配置从 `src/content/config.ts` 移到 `src/content.config.ts`；不再有 `type: 'content'` / `type: 'data'` 区分；必须给集合定义 `loader`（如 `glob({ pattern, base })`）；`getDataEntryById()` / `getEntryBySlug()` → `getEntry()`；`entry.render()` → `import { render } from 'astro:content'` 的 `render(entry)`；`CollectionEntry` 的 `id` 现在是 slug（原 `slug` 字段），文件名为 `filePath`。
- **v7.0 其它 breaking changes（迁移 v6→v7）:** 升级到 Vite 8；移除多个 experimental flag（`logger`、`queuedRendering`、`rustCompiler`、`advancedRouting`、`cache`/`routeRules` 转正为顶层配置）；默认编译器改为 Rust（对非法 HTML 更严格：未闭合标签报错）；`src/fetch.ts` 成为保留文件名；默认 Markdown 处理器改为 Sätteri；`compressHTML: 'jsx'` 成为新的默认空白处理。
- 建议用 `npx @astrojs/upgrade` 升级。

## 证据（全部来自官方一级来源）

- **功能来源:** Astro `CHANGELOG.md` v7.2.0 条目（PR #17084 `961bbe5`，作者 matthewp）：「Adds experimental support for incremental static builds with `experimental.incrementalBuild`」及配置示例、CI 需保留 cache 目录说明、`digest` 属性说明。
  - https://raw.githubusercontent.com/withastro/astro/main/packages/astro/CHANGELOG.md
- **功能文档（页面标题即 "Experimental incremental static builds"）:** Overview / Providing a cache key / How pages are invalidated / Preserving the cache between builds / Limitations（`build.concurrency > 1`、server islands 需 `ASTRO_KEY`、middleware 不改缓存）。
  - https://docs.astro.build/en/reference/experimental-flags/incremental-build/
- **配置参考**（experimental flags 总览，含 incremental build 类型/默认值/版本）：https://docs.astro.build/en/reference/configuration-reference/
- **Node engines:** npm registry `astro@7.2.0` 的 `engines` 字段：`node >=22.12.0`。
  - https://registry.npmjs.org/astro/7.2.0
- **v6 迁移指南（content collections→Content Layer，含 `legacy.collections` 移除、`src/content.config.ts`、`getEntry()`、`render(entry)`、`id` 语义）：** https://docs.astro.build/en/guides/upgrade-to/v6/
- **v7 迁移指南（Vite 8、Rust 编译器、experimental flags 移除、`src/fetch.ts` 保留名、Sätteri）：** https://docs.astro.build/en/guides/upgrade-to/v7/

## 不确定性 / 待决策

- **功能为 experimental，可能随版本调整**，升级前需复查 changelog 与 experimental flags 文档。
- 本调研基于 **7.2.0（npm latest，2026 时点）**；更早/更晚版本行为可能不同。
- 未确认官方博客（astro.build/blog）有专门介绍该 incremental build 的长文——本次取证主要依据 changelog + docs，二者已明确给出功能名、配置与缓存机制。
- 本项目当前为 **Astro 5.11.0**，落地需先走 5→6→7 迁移（重点 content collections → Content Layer），且 `astro.config.mjs` 尚未设置任何 experimental flags。
