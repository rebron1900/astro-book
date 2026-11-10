# 样式组织约定

这个站的 CSS 分四层，选哪层取决于「谁需要这份样式、什么时候加载」。

## 1. 全局层：`src/styles/`（每个页面都会加载）

入口是 `src/styles/book.scss`，`BaseLayout.astro` 引入一次，产物是一份公共 CSS（约 165KB）：

- `_defaults.scss` / `_variables.scss` / `themes/`：设计令牌、主题变量
- `normalize.css` / `_main.scss` / `_markdown.scss` / `_shortcodes.scss`：基础重置、排版、文章正文
- `_fonts.scss` / `plugins/`：字体、第三方样式与覆盖（tippy、artalk、medium-zoom 等）
- `_custom.scss`：主题自有样式（书页框架、侧栏热力图、友邻/活动等**跨页面**的部分已陆续拆出，见下）

只放「几乎每个页面都用到」的东西。这里的每一行都会出现在所有页面的公共 CSS 里，新增前先确认它真的全局。

> 固定装饰渐变（`_defaults.scss` 的 `@mixin gradientback`）由 `BaseLayout.astro` 里的 `<div class="page-bg" aria-hidden="true">` 承载，它带 `view-transition-name: page-bg`，切页面时保持静止。不要把它改回 `body::before/::after`，也不要挪出 `body` 顶层，否则过渡里它会随整页快照淡出再淡回（表现为「背景色闪一下」）。

## 2. 页面层：`src/styles/pages/*.scss`（只随对应页面加载）

由页面（或页面内组件）在 frontmatter 里 `import`，只在用到它的页面产出 CSS chunk：

| 文件 | 引入位置 | 覆盖页面 |
| --- | --- | --- |
| `pages/timeline.scss` | `components/islands/List.astro` | 首页、时间线、分页 |
| `pages/timeline-month.scss` | `components/islands/TimelineMonthList.astro` | 时间线按月视图 |
| `pages/exercise.scss`（base/map/stats/footprint） | `pages/exercise.astro` | /exercise/（含足迹全屏层） |
| `pages/links.scss` | `pages/links.astro` | /links/ |
| `pages/tags.scss` | `pages/tags.astro` | /tags/ |
| `pages/archives.scss` | `components/islands/ArchiveTimeline.astro` | /archives/ |
| `pages/now.scss` | `pages/now/[...page].astro` | /now/ |

页面级样式约定：

- 用页面前缀避免冲突：运动页 `ex-`、友链页 `pv-`、标签页 `tags-`、相册页沿用 `astro-masonry-`。
- 页面级 scss **不经过 book.scss 的变量上下文**：不要直接写 `$font-size-12` 之类的 Sass 变量（会编译失败），需要时用字面量或单独 `@use`。
- 页面级 scss 允许用 Sass 嵌套，但现状大多是扁平 CSS，保持原样即可。

## 3. 共享块：`src/styles/blocks/*.scss`（被两个以上页面复用）

- `_filter-chips.scss`：类型筛选条（首页时间线 + 运动页），由页面级 scss `@import` 引入。
- `_metric-icons.scss`：指标小图标基础尺寸，全局引入（首页与运动页的卡片都要用）。
- `strava-embed.scss`：Strava 图表短代码样式，由 `components/shortcode/Strava.astro` 自己引入——组件没被用到时这份样式也不会进任何页面。
- `scroll-reveal.scss`：滚动进入动画，由 `ScrollReveal.astro` 引入。

规则：

- 被 scss `@import` 的块用下划线开头（`_filter-chips.scss`），Sass 会按 partial 解析。
- 被 Astro frontmatter `import '....scss'` 直接引入的块**不能**用下划线开头（`strava-embed.scss` / `scroll-reveal.scss`），因为 Vite 不走 Sass partial 解析。

## 4. 组件层：组件自己的 `<style>`

- 只服务该组件内部结构与样式、不会被别的页面复用时，直接写在组件里，Astro 默认加 scope（如 `AlbumCard.astro`、`ProfileCard.astro`、`pages/404.astro`）。
- 只有下面几种情况才用 `<style is:global>`：
  - 需要命中第三方 DOM（Mapbox 控件、artalk 评论区）；
  - 需要命中 Solid 岛渲染的节点；
  - 样式类由多个组件共同输出（如首页的 `.ledger-*`、`.memo-*` 卡片）。

## 迁移/维护提示

- 新增页面样式时优先放 `src/styles/pages/`，不要在组件里堆 500 行 `<style is:global>`；纯样式组件（只含 `<style>` 的 `.astro`）不再新增。
- 从一个页面搬到另一个页面之前，先 `grep` 内联类名确认消费方（`grep -rl 'class-name' dist --include=*.html` 最可靠，构建产物里没出现的类基本就是死代码）。
- 本项目开启了 `experimental.incrementalBuild`：Astro 会缓存已构建页面。**改完 CSS 本地验证前**先清掉 `node_modules/.astro/dist/` 和 `node_modules/.astro/incremental-build.json` 再 `yarn build`，否则可能看到旧页面引用旧 hash 的 CSS（CI 冷构建不受影响）。
