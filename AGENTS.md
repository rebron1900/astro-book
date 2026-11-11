# AGENTS.md — 开发与协作规则

本文件是给后续开发（含 AI Agent）的项目规则。修改代码前先读完；与旧习惯冲突时以本文件为准。
更细的专题文档：

- 样式分层：[src/styles/README.md](src/styles/README.md)
- 客户端脚本：[src/lib/client/README.md](src/lib/client/README.md)

---

## 0. 环境与常用命令

- Node.js **22**（CI 使用 22），包管理器必须是 **Yarn 1.22**（`packageManager` 已锁定；不要用 npm/pnpm，会出现 lockfile 冲突）。
- 本地环境变量放在 `.env`（已被 gitignore，不要提交）。需要 Ghost / NeoDB / Miniflux / intervals.icu / Mapbox 等密钥。
- 格式化：Prettier，`printWidth: 160`、`tabWidth: 4`（md/yaml 为 2）、单引号、无尾逗号。项目没有 ESLint，靠 `astro check` + 测试兜底。

| 命令                        | 用途                                   |
| --------------------------- | -------------------------------------- |
| `yarn dev`                  | 本地开发（Astro dev server）           |
| `yarn build`                | 生产构建到 `dist/`                     |
| `yarn preview`              | 预览构建产物                           |
| `yarn astro check`          | TypeScript / Astro 类型检查            |
| `yarn test`                 | Vitest 单测（`tests/`）                |
| `yarn sync:data`            | 拉取外部数据到 `src/data/*.json`       |
| `yarn import:strava-export` | 导入 Strava 导出文件（历史数据迁移用） |

**提交前至少跑：`yarn astro check`、`yarn test`、`yarn build`。** 改了 CSS/JS 分块或共享样式时，还必须用「冷构建」验证（见第 6 节）。

---

## 1. 项目结构

- `src/pages/` — 路由页面；`[slug].astro` 文章、`[...page].astro` 首页分页、`timeline/`、`exercise.astro`、`map.astro`、`now/`、`albums/` 等。
- `src/components/islands/` — 有交互的岛/组件：`List.astro`（时间线）、`Head.astro`（全局 head/挂载入口）、`Comments.astro`、`Exercise*`、`Ledger*`、`Relitu.tsx` 等。
- `src/components/layout/` — 站点骨架（Header/Menu/Footer/ProfileCard）。
- `src/components/ui/` — 小型 UI（Brand、PostAction、MetricIcon）。
- `src/components/shortcode/` — 文章内 Markdown 短代码渲染（OGCard、Columns、Link 等）。
- `src/api/store.ts` — 构建期读取 `src/data/*.json` 并聚合成页面数据。
- `src/lib/` — 纯函数与数据层（`exercise.ts`、`strava-preview.ts`、`metric-icons.ts`、`activity-types.ts`…），**不得访问 `document`/`window`**。
- `src/lib/client/` — 浏览器专用脚本（见第 4 节）；`exercise-map/` 子目录是运动地图的常量/类型/轨迹/几何/图层，主控制器在 `exercise-map.ts`；足迹地图是独立的 `footprint-map.ts`。
- `src/styles/` — 分层样式（见第 3 节）。
- `scripts/sync-data.mjs` — 外部数据同步脚本；`src/data/*.json` 全部由它生成。
- `tests/` — Vitest：`tests/lib`（纯函数）、`tests/api`（store/sync）、`tests/helpers`。

---

## 2. 数据层规则

1. **不要手改 `src/data/*.json`**：它们由 `yarn sync:data` 生成（ghost、memos、neodb、flux、activities、geojson、rank、image-meta）。需要改数据 → 改同步脚本或数据源。
2. 数据源在 `scripts/sync-data.mjs` 的 `SOURCES` 表里：`ghost / neodb / flux / memos / intervals / map / rank / imagemeta`；可按源同步：`node scripts/sync-data.mjs ghost,intervals`，`--full` 忽略增量缓存，`--dry-run` 只预览。
3. 定时任务会同步数据并自动提交 `chore(data): … [skip ci]`（防止循环触发 CI）。不要手动提交数据文件除非确实需要。
4. **运动数据契约是 `src/lib/activity-types.ts`**（intervals.icu 的 `Activity`，扁平字段）。改字段时同步更新：`src/lib/exercise.ts`（`buildRecords` 等）、`src/lib/intervals.ts`、`src/lib/strava-preview.ts`、`src/api/store.ts`、`exercise.astro`/`exercise-routes.json.ts` 以及测试。旧的 `StravaActivity` 只在历史迁移/测试里保留，不要在新代码里使用。
5. 运动轨迹不进页面 HTML：`/exercise-routes.json` 只输出 `{ id: polyline }`，地图按需拉取。不要在服务端把 `polyline` 塞进列表数据。
6. 构建期零网络依赖：页面只读本地 JSON；新增外部源必须走 `sync-data.mjs` 落地文件。
7. **足迹（走过的地方）数据也在构建期拼**：标点来自 `src/data/geojson.json`，游记按 Ghost 的 `#地点-<标点名>` 标签匹配（`src/lib/footprint.ts`）。不要再把 geojson 的 `description` 当游记来源；标签地名和标点名的匹配规则（完全一致 / 双向前缀）改动时同步 `tests/lib/footprint.test.ts`。

---

## 3. 样式规则

四层结构，选哪层取决于「谁需要、什么时候加载」：

1. **全局**：`src/styles/book.scss`（由 `BaseLayout` 引入，每个页面都会加载，约 168KB）。
   - 只放设计令牌、基础排版、跨页面复用的全局样式、第三方覆盖。
   - `_custom.scss` 只保留真正全局的内容；页面专用样式**不要**往里加。
2. **页面级**：`src/styles/pages/*.scss`，由页面/页面内组件在 frontmatter `import`，只随该页加载：
   - `timeline.scss`、`timeline-month.scss`、`exercise.scss`（`exercise/` 子目录）、`links.scss`、`tags.scss`、`archives.scss`、`now.scss`、`albums.scss`。
3. **共享块**：`src/styles/blocks/*.scss`，被两个以上页面复用（`_filter-chips.scss`、`_strava-card.scss`、`_metric-icons.scss`、`scroll-reveal.scss`）。被 scss `@import` 的块用下划线开头；被 Astro `import` 的块**不能**用下划线（Vite 不做 Sass partial 解析）。
4. **组件内 `<style>`**：只服务该组件自身、不会复用时才用（默认 scoped）。只有要命中第三方 DOM（Mapbox/artalk）或多个组件共同输出同一套类名时，才用 `<style is:global>`。**不要再新增「只含样式」的 `.astro` 组件。**

约定：

- 页面前缀避免冲突：运动页 `ex-`、友链 `pv-`、标签 `tags-`；首页时间线用 `ledger-*/memo-*/strava-*`。
- 页面级 scss **拿不到** `book.scss` 里的 Sass 变量（如 `$font-size-12`），用字面量或 `@use`。
- 新增页面样式优先放 `src/styles/pages/`，不要回到组件里堆上千行 `<style is:global>`。
- 改共享样式后确认页面 chunk 体积没有异常增长（`ls -la dist/_astro/*.css`）。

---

## 4. 客户端脚本规则

**挂载：一律用 `onPageLoad()`**，不要再手写 `document.addEventListener('astro:page-load', init)` + `if (document.readyState !== 'loading') init()` 的双重初始化。

```ts
import { onPageLoad } from '../../lib/client/mount';

onPageLoad(() => {
  const onClick = () => {};
  window.addEventListener('click', onClick, { passive: true });
  return () => window.removeEventListener('click', onClick); // 导航前自动执行
});
```

- 页面通过 `Head.astro` 引入 `<ClientRouter />`，`astro:page-load` 首次加载和每次导航都会触发；`onPageLoad` 负责「一次挂载 + 导航前清理」，没有 ClientRouter 的页面也会用 `DOMContentLoaded` 兜底。
- `init` 返回清理函数，用来移除 window/document 监听、断开 observer、销毁第三方实例。
- 组件 `<script>` 只做薄封装（取 DOM → 调 init）；重逻辑放 `src/lib/client/*.ts`。
- `<script is:inline>` 只在两种情况下用：首屏必须同步执行（防 FOUC）、需要 `define:vars` 注入数据。用 `is:inline` 时必须自己处理重复初始化/清理（元素 `dataset` 标记 + `astro:before-swap`）。
- 纯函数放 `src/lib/`；浏览器专用放 `src/lib/client/`。模块顶层**不能**访问 `window/document`（构建期会 SSR）。
- 共享工具：
  - `mount.ts`：`onPageLoad`
  - `dom.ts`：`escapeHtml`、`prefersReducedMotion`、`onNextFrame`
  - `tippy.ts`：`createTippy`（实例统一记录，导航前销毁；不要再裸 `import tippy`）
  - `cards-loader.ts`：第三方卡片脚本按需加载（页面有 `.kg-video-card/.kg-audio-card/.kg-toggle-card` 才拉 chunk）
  - `timeline.ts`：时间线全部交互（无限滚动、memo、图片堆叠画廊、渐入）
  - `footprint-map.ts`：足迹地图控制器（独立 Mapbox 实例、标点聚合、卡片联动）；和 `exercise-map.ts` 互不 import
- 重依赖（mapbox-gl、artalk、htmx、tippy、cards）不要静态 import 进 `Head.astro`；能动态 `import()` 的就动态加载，并检查 `dist/_astro` 分块。
- 客户端模块以 `export default function initXxx()` 为主；共用导出用命名导出。**新代码禁止 `@ts-nocheck`**；历史例外：`cards.ts`（vendored 播放器）、`timeline.ts`（从内联脚本机械搬移，待补类型）、`coco-message.ts`、`LedgerMemo.astro`，后续改动可逐步收窄。
- 第三方实例（tippy/artalk/Mapbox）必须可销毁；地图控制器要提供 `destroy()`。

---

## 5. 组件与图标

- 有交互/状态的用 Solid（`.tsx`，按需 `client:load` / `client:visible` / `client:media`）；纯展示用 Astro（`.astro`）。
- 指标图标统一用 `MetricIcon.astro` / `MetricIcon.tsx` + `src/lib/metric-icons.ts`，类名 `.metric-icon`；不要在页面里手写新的 SVG 图标表。
- 运动卡片数据统一走 `stravaMetaFor()` / `StravaCardPreview.astro`；不要把配速/均速/时长格式化再抄一份，统一用 `src/lib/exercise.ts` 的函数。
- 新增短代码：放 `src/components/shortcode/`，并在需要它的页面 `Markup` 的 `components` 映射里注册。
- 组件的样式依赖全局类名时，类名要跟现有命名一致（`ledger-*`、`memo-*`、`ex-*`）。

---

## 6. 构建、缓存与部署

- 构建：`yarn build` → `dist/`；RSS、sitemap、`search-data.json`、`exercise-routes.json` 都是构建产物。
- **`experimental.incrementalBuild: true`**（Astro 7.2）：缓存放在 `node_modules/.astro`（`incremental-build.json` + `dist/` 副本），计划任务/本地二次构建会复用页面。

  - **已知坑**：只改 CSS（尤其是 Sass `@import` 链里的全局样式）时，缓存页面可能保留旧 hash 的资源引用，而旧 CSS 文件已被删除 → 线上无样式。
  - 改 CSS/JS 后验证前先冷构建：

    ```bash
    rm -rf node_modules/.astro/dist node_modules/.astro/incremental-build.json
    yarn build
    ```

  - CI 里如果保留 `.astro` 缓存，缓存 key 必须包含 `src/styles/**`、`src/components/**`、`src/layouts/**`、`astro.config.mjs`、`package.json`、`yarn.lock` 等代码/样式指纹（`src/data/**` 可排除，这样纯数据同步还能吃到增量缓存）；否则宁可在 push 构建时加 `astro build --force`。

- 部署：GitHub Actions（`.github/workflows/ci.yml`）→ `rsync dist/` 到 VPS。**不要修改 workflow 里的 secrets / cache key 表达式**（本地看到的是脱敏占位符，改坏会直接破坏部署）。
- 构建产物体积基线：全局 `BaseLayout.css` ~168KB；运动页 chunk ~38KB；`List.css` ~22KB；mapbox/artalk/htmx 各自独立 chunk。新增静态 import 前先想想是否该动态加载。
- Astro 配置里的 `vite.build.rollupOptions.manualChunks` 按 `node_modules` 包拆 chunk；不要随意改动。

---

## 7. 测试与完成标准（Definition of Done）

1. 纯函数/数据转换改动：在 `tests/lib` 加或改测试；`yarn test` 必须全绿。
2. 类型检查：`yarn astro check` 0 error（warning/hint 不阻塞，但不要新增）。
3. 构建：`yarn build` 成功；改了样式/脚本分块时用冷构建。
4. 浏览器抽查（本地 `dist` 或 dev）：
   - 首页 `/`、时间线 `/259/` 这类列表页（无限滚动、memo、卡片）
   - `/exercise/`（地图 canvas、筛选 chip、重播、时间线；「足迹」按钮切到足迹布局，左侧导航还在，Esc 能退出）
   - 文章页（复制/折叠按钮、TOC、评论、点赞）
   - 改动涉及的其它页面（`/links/`、`/archives/`、`/now/`、`/albums/…`、`/map/`）
   - 响应式至少看 320 / 768 / 1440 三档；UI 改动要看 375 左右
5. 冷构建后检查资源引用完整：

   ```bash
   grep -REho '(href|src)="/_astro/[^"]+\.(css|js)"' dist --include=*.html \
     | sed 's/.*="//; s/"$//' | sort -u \
     | while read -r f; do [ -f "dist$f" ] || echo "MISSING $f"; done
   ```

6. 文档：新增约定/工具时更新本文件或对应 README；不要留下临时脚本、临时数据文件、后台 server。

---

## 8. 代码风格与提交

- Prettier 统一格式（可在编辑器里保存时格式化）。
- 命名：组件 PascalCase；函数 camelCase；纯函数文件 kebab-case；样式块 `_kebab-case.scss`。
- 注释/文案用中文（与现有代码一致）；对外 API 注释写清「为什么」而不只是「做什么」。
- 提交信息用 conventional 前缀：`feat:`、`fix:`、`refactor:`、`chore:`、`docs:`、`test:`；数据提交由 CI 生成 `chore(data): … [skip ci]`。
- 一次提交只做一件事，避免「重构 + 功能 + 格式化」混在一起。

---

## 9. 常见坑

- Sass 变量在页面级 scss 里不可用（不在 `book.scss` 的变量上下文）→ 用字面量或单独 `@use`。
- Vite JS `import './blocks/xxx.scss'` 必须用真实文件名（`xxx.scss`），Sass `@import 'xxx'` 才会解析 `_xxx.scss`。
- Astro 按组件切 CSS chunk：`<style is:global>` 只在渲染它的页面加载；不要因为「别处也能用」把页面样式塞进全局。
- 挂载在 `astro:page-load` 的逻辑要能重复执行；不要用 `window.onscroll = …`（覆盖别人），用 `addEventListener` + 清理。
- 第三方 tooltip/评论/地图实例必须销毁，否则 View Transitions 后越积越多。
- 地图相关代码顶层不能碰 `window`；`/map/`、`/exercise/`、足迹地图是三套控制器，不要互相 import。
- 足迹是**独立路由** `/exercise/footprint/`：页面靠 `body:has(.footprint-page)` 把 `.book-page` 锁成 `100svh`，`.exercise-page` 变 flex 列，剩余高度交给 `.ex-fp`。宽度不要自己写 `max-width`——直接把 Ghost 页原样交给 `BaseLayout`（它带 `hash-page-fullwidth`），`isFullWidth` 会跳过右侧 TOC 空栏并给 `.container` 上 `.full-width`；滤掉那个标签再用 `:has()` 硬压宽度，右边就会留一列空的 16rem。
- 外部接口失败要降级（读缓存 / 显示提示），不要让整页构建或交互崩掉。
- 页面标题区统一用 `src/components/ui/PageIntro.astro`（渲染 `.page-head / .page-title / .page-intro`，尺度对齐首页的 `.timeline-intro`）。新页面不要自己写 `<h1>` + 导语，也不要再造一套 `pv-title`/`ex-title` 这种一次性样式。
- `.page-bg` 的几何 / 层级写在 `_defaults.scss` 里、**与主题解耦**（主题只通过 `--page-bg-alpha` 给浓度）。它是 `fixed; z-index: 0`：压底色、在正文之下。**不要给它 `view-transition-name`**：有了名字，过渡期间快照会被画在所有内容之上，就是「右上角冒出一块背景色、动画结束又消失」。也别把几何塞回 `html.<theme> .page-bg`（主题类运行时才加，换页有空窗期）。
- 地图 / WebGL 这类重活挂在 `src/lib/client/idle.ts` 的 `afterTransition()` 里创建：等 `html[data-astro-transition]` 消失、再两帧、再 `requestIdleCallback`。换页那几百毫秒是动画时间，这时候初始化地图会直接把过渡拖卡。

- 不要直接编辑 `dist/`、`node_modules/`、`node_modules/.astro/`、`src/data/*.json`。

---

## 10. 当前状态 / 待办（会变化，供接手参考）

- 数据源正在从 Strava 迁到 **intervals.icu**（`activity-types.ts` / `intervals.ts` / `store.ts` / `exercise.astro` / `sync-data.mjs`）。若 `astro check` 报缺少 `src/data/activities.json`，说明迁移未收尾：先运行 `node scripts/sync-data.mjs intervals`（需 `INTERVALS_ICU_*` 环境变量）或恢复数据文件。
- 旧的 `tests/lib/exercise.test.ts`、`tests/api/store.test.ts` 等断言可能还在用 `StravaActivity` 字段（`run_id`/`summary_polyline`/`location`），迁移完成时要一起更新。
- `/activity/` 是「运动 + 足迹」合并页（新页面，2026-11-11 起）：一张地图 + 右上角 `act-switch` 切模式，时间线和右侧栏跟着 `.activity-page[data-activity-mode]` 用 CSS 切换。地图由 `src/components/islands/ActivityShell.tsx` 统一持有，切换模式时先 `destroy()` 旧控制器再建新的，**同一时刻只允许一个 Mapbox 实例**。旧的 `/exercise/`、`/exercise/footprint/` 保持原样。
- 运动地图控制器已拆分为 `src/lib/client/exercise-map.ts` + `exercise-map/` 子模块；`/map/` 页面计划与运动页合并/重做，未定稿前不要大改 `src/lib/map.ts` 与地图相关样式。
- 路由：`/strava/` 通过 `astro.config.mjs` 的 redirect 永久跳到 `/exercise/`；运动轨迹接口为 `/exercise-routes.json`。
- 图标、滤镜 chip、Strava 卡片样式已经统一，新增地方直接复用，不要再复制一份。
- 足迹页：独立路由 `/exercise/footprint/`，布局是「左侧导航 + 中间地图 + 右侧时间线（16rem）」，桌面端整页不滚动；游记靠 Ghost 的 `#地点-<标点名>` 标签关联。两个页面的来回走统一用顶部 `.ex-switch`（`src/components/ui/ExerciseNav.astro`，真锚点 + `aria-current="page"` 激活态）；它挂在 `.exercise-page` 上、不在预览地图里，所以地图吸顶悬浮时不会被一起带走。老链接 `/exercise/#footprint` 由 `exercise.astro` 的 inline 脚本重定向过去。`/map/` 页面保留但不在导航入口里。

---

## 11. Agent 工作规则

1. **动手前先看**：`git status`、相关目录、本文件与两个 README；工作区可能有别人未提交的改动（例如并行的数据迁移），不要 revert/覆盖不属于你的修改。
2. **先说明再改**：涉及跨页面重构、删除文件、改构建/部署配置时，先确认影响范围；不确定就问。
3. **小步验证**：每完成一块就跑 `astro check` + 相关测试 + 局部构建；不要攒到最后一次性验证。
4. **范围隔离**：一次只动一个主题（样式 / 脚本 / 数据）；重构不夹带行为变更。
5. **不碰密钥与生成物**：`.env`、`.github/workflows` 的 secrets、`src/data/`、`dist/`、锁文件不手工编辑。
6. **清理现场**：结束前关掉本地 server / headless 浏览器，删除 `/tmp` 脚本与临时数据；提交前 `git status` 确认没有意外文件。
7. **交付说明**：报告改了什么、为什么、怎么验证的、还剩什么风险；没验证过的不要写成已验证。
