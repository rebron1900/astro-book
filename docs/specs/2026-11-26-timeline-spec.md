# 时间线规范（v1，2026-11-26）

状态：可实施规范。适用 `astro-book` 的 `/timeline/*`（含 `/timeline/reading/` 阅读+影视合并栏目、`/timeline/preview-mixed/` 原型）。
定位：时间线**只是数据集的消费者**，不拥有取数逻辑。本轮不改页面外观、不改既有 URL。

---

## 1. 分层：source / kind / 栏目

三个概念**必须分开**，不要用一个字段兼职：

| 概念 | 含义 | 举例 |
| --- | --- | --- |
| **source** | 数据来自哪个 dataset | `ghost.posts`、`memos`、`neodb.marks`、`emby.viewing`、`reading`、`intervals.activities` |
| **kind** | 卡片类型（渲染分支） | `post` / `memo` / `neodb` / `media` / `reading` / `strava` |
| **栏目** | 用户可见的筛选入口（URL 段） | `/timeline/post`、`/timeline/memo`、`/timeline/reading`（= 阅读 + 影视）、`/timeline/strava` |

规则：

- kind 与栏目的映射**显式写在页面 props 里**，不要靠 kind 名字前缀猜。
- 一个栏目可以包含多个 kind：`/timeline/reading/` = `reading` + `media`（既有行为，保留）。
- 一个 source 可以产出多个 kind（如 neodb 的 mark 与 reading 是两种卡片）。
- 展示注册表（kind → 组件）不是本轮强制重构项；但新增 kind 必须同时有：类型、store 里的构建函数、组件分支、栏目映射、测试。

## 2. 类型化事件

时间线内部的统一形状：

```ts
type TimelineEntry =
  | { kind: 'post'; time: number; data: Post }
  | { kind: 'memo'; time: number; data: Memo }
  | { kind: 'media'; time: number; data: EmbyEntry }
  | { kind: 'reading'; time: number; data: ReadingDay }
  | { kind: 'neodb'; time: number; data: NeoDBMark }
  | { kind: 'strava'; time: number; data: Activity };
```

- **按需转换**：只把当前栏目需要的 dataset 转成事件（不要为了时间线把每次同步的原始数据整份塞进 HTML）。
- 事件构造是纯函数，放 `src/lib/` 或 `src/api/store.ts`，可单测；不得在组件里临时拼时间/排序。
- 每个事件必须能追溯到 `source + 稳定 id`，用于去重与「编辑/撤回」判断。

## 3. 时间语义（最容易出错，按此执行）

1. **精确时间 vs 日期型，分开存**：
   - 精确时间（post `published_at`、memo `createdTs`、emby `lastPlayedAt`、activity `start_date_local`）→ epoch 毫秒。
   - 日期型（reading 的 `date` = `YYYY-MM-DD`）→ **保留字符串日期**，另给出该日北京时间 00:00 的 epoch 仅用于排序，不得反推成时刻显示。
2. **一切「天」按北京时区**：`cnDateKey(ms)`（`src/lib/utils/help.ts`）为唯一日键函数。CI 跑 UTC，禁止用 `new Date().getDate()` 或本地时区拼日期。
3. **稳定排序**：`time` 降序；同 `time` 时按 `kind` 固定序号、再按 `id` 字典序升序。**不允许**依赖数组原始顺序或 `sort` 的不稳定行为（比较器必须全序）。
4. **同日不跨页**：分页按「天」累计，页内达到 `PAGE_SIZE` 且下一条换了天才开新页（既有实现，保留并加回归测试）。同日多集合成的聚合卡不得被拆到两页。
5. **去重**：以 `source + id` 为键。同一记录在多个 dataset 出现（如 Resume 与 Items 的同一影片）必须在构造阶段合并（取较新 `lastPlayedAt`，进度取较大），不得在渲染层去重。
6. **编辑**：`updatedTs > createdTs` 的记录以最新一次为准，时间线**位置仍按原 `createdTs`**（避免旧内容跳到顶部）；卡片上如显示修改痕迹，只显示「已编辑」。
7. **撤回/删除**：上游删除的记录不再出现在 dataset 里（`replace` 语义）→ 时间线自然消失。不做「已删除」占位。
8. **未来时间**：`time > now + 5min` 的记录视为脏数据，在 `buildTimeline` 末尾由 `FUTURE_TOLERANCE_MS` **直接过滤丢弃**，防时区错算导致置顶。
   - 与最初规范的偏差（按实现如实记录）：当前**不计数、不告警**，属静默丢弃。2026-11-26 冻结数据实测 0 条命中，故本轮不改实现；将来任一来源出现未来时间，先补「丢弃条数」告警再查时区。

## 4. 聚合口径

- **剧集聚合**：同一 `seriesId` 的多集合并为一张卡（既有 `mergeEmbyItems`/`mapEmbyItem` 行为）；卡片标题用剧名，副信息显示最近一集 `SxxExx`；集数计数为「本轮窗口内去重后的集数」。
- **阅读聚合**：同一天的多本书合成一张阅读卡（`reading.days[]` 既有结构）；计数为「当天有进度的书数」，进度取当天最后一次。
- **计数口径统一**：页头「共 N 条」= 该栏目**事件数**（`source+id` 去重后、按 kind 过滤后），**不是**原始上游记录数，**也不是**卡片行数。分页 `total` 与页头必须同源同值（实现上就是同一个 `items.length`）。
- **聚合在渲染层，不改变计数**：实测「阅读与影视」206 事件（54 个阅读日 + 152 条影视）→ 渲染 87 行（18 页，同日阅读合并一行、同日同剧集合成一行）；运动 178 事件 → 142 行。看到「共 N 条」不要期望它等于卡片行数。
- 每个栏目的口径写进该页 `props` 注释，避免以后各算一套。

## 5. 公开性

- 时间线只消费**可公开**记录：memos 仅 `visibility === 'PUBLIC'`（默认，可按显式配置放开），neodb 仅公开 mark，emby/reading 视为本人可公开内容。
- 过滤发生在 dataset 落地前 + store 读取时双保险（见数据接入规范 §6）。时间线**不得**自己写第三套可见性判断。
- 卡片不得包含：带 token 的图片 URL、内网地址、未公开记录正文。

## 6. 渲染与交互兼容（现有外观不能坏）

必须保持：

- 既有 URL：`/timeline/<kind>/`、`/timeline/<kind>/<page>`；`/timeline/reading/` 仍映射「阅读+影视」。
- 卡片结构与样式类名（`ledger-*`、`memo-*`、`strava-*`）；样式改动必须走 `src/styles/`，不进组件 `<style>`。
- 无限加载：分页 URL 可被客户端直接拼接拉取；加载下一页时不得重复插入同一 `id` 的卡。
- 跳转：站内链接不得 404；外链走既有 `golink` 编码方式；`preview-mixed` 保持 noindex 且不进 sitemap。
- 图片：卡片只引本地/白名单域名；懒加载与 `image-meta.json` 尺寸（避免布局抖动）沿用既有机制。

**真实渲染验收**（构建后用浏览器，不只看 HTML 文本）：
1. 每个改动栏目：首屏渲染、翻页/无限加载、筛选 chip 切换；
2. 跨日边界：北京时间 00:00–01:00 的记录落在正确日期、不被拆卡；
3. 卡片点击跳转目标可达（站内 200、外链地址正确）；
4. 320 / 768 / 1440 三档宽度无溢出；
5. 控制台无报错、无重复卡片。

## 7. 明确不做（本轮）

- 不重构展示注册表（kind → 组件表）为通用插件机制。
- 不改 URL 结构、不做时间线主题改版。
- 不把 Emby/NeoDB/reading 之外的源新接入时间线。
- 不引入客户端状态库或虚拟列表。
