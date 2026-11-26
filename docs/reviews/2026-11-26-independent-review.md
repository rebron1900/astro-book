# 独立质量复核：feat/data-modular-pilot @ b7f5075

- 复核人：明鉴（独立验证方，只读；未改代码、未 push、未合并）
- 时间：2026-11-26 16:2x–16:5x（Asia/Shanghai）
- 复核对象：`/data/workspace/bots/知行/worktrees/modular-2026-11-26`，分支 `feat/data-modular-pilot`，HEAD `b7f5075`（父 `e2e7437` ← `a7eda60` ← `ea97dfe` ← 基线 `128e6a9`）
- 工作树状态：`git status --porcelain` 只有 3 个未跟踪的 spec 文档与 `node_modules` 符号链接，无脏改动；`HEAD^{tree} = e683d248…`
- 主检出 `/data/workspace/bots/知行/astro-book`：仍为 `128e6a9`，两个 TMDB 未提交改动（`scripts/sync-emby.mjs`、`.github/workflows/ci.yml`）未触碰；本次只新增本文档
- 环境：Node v24.22.3 / yarn 1.22.22；本地沙箱，非 CI

## 0. 总体结论

**通过（可合并）。** 8 项要求全部独立实测通过，未发现阻断项：类型检查 0 error、454 条测试全绿、构建 2171 页、隐私双模式真跑、fail-closed 反证成立、接入层 13 条不变量全过、时间线排序/分页/计数与真实数据核对一致、375/1440 真浏览器渲染与无限加载正常、`emby.json` 与 `image-meta.json` 与基线逐字节一致。

必修 0 项；可延后 4 项（含 1 项 spec 标「必须」但未落地的实现，细节见 §3）。与筑成自述**无矛盾**，仅两处口径需要说清（§4）。

## 1. 逐项结果

| # | 项 | 结论 | 关键命令 | 关键输出 |
| --- | --- | --- | --- | --- |
| 1 | 类型检查 / 测试 / 构建 | 通过 | `yarn astro check`；`npx vitest run`；`yarn build` | `0 errors, 0 warnings, 63 hints (228 files)`；`29 files / 454 tests passed`；`2171 page(s) built in 18.89s`（总 19.47s） |
| 2 | 隐私检查双模式 + 数据核对 | 通过 | `node scripts/check-public-data.mjs`；加 `--features-from …/memos-2026-11-26.json` | 默认：`memos 2668 条（PUBLIC=2668）`、非公开 0、EXIT=0；备份模式：`2910 条 / 非公开 242 / 特征 210（排除 15）`、扫 2238 个文本文件 `命中 0`、EXIT=0 |
| 2b | 独立复核 2910→2668 | 通过 | 自写脚本比对 id 与正文特征 | 242 条非公开：id 在新 `memos.json` 里出现 **0** 次；正文前缀命中 5 条，全部可解释为「已公开过的同文」（3 条与 PUBLIC 条目全文相同、1 条是更长 PUBLIC 条目的子串、1 条正文完整收录在已发布文章） |
| 3 | fail-closed 反证 | 通过 | `/tmp` 副本改回「缺字段=public」后 `npx vitest run` | `8 failed / 446 passed`（2 个文件红）；不合规值（null/数字/对象/数组/空白/undefined）一律不发布；显式 `PUBLIC`/`0` 仍放行 |
| 3b | 真实构建级 fail-closed | 通过 | `/tmp` 副本注入 1 条 UNLISTED 后两次 build | 默认白名单：探针在 dist 出现 **0** 次；`MEMOS_PUBLISH_VISIBILITIES=public,unlisted`：出现 **1077** 个文件 → 开关真实生效，不是一律拦 |
| 4 | 接入层不变量 | 通过 | 自建临时来源 + 注入 registry/contracts 跑 `runIngestSource`（13 组） | 见 §2.4：原子写、失败保旧、游标、缺凭据、401/429/超时/分页不全、空结果、重复 ID、幂等、dry-run、脱敏 全部符合 |
| 4b | executor/registry 未被动过 | 通过 | `git diff HEAD -- scripts/lib/ingest/` | 空；md5 `executor f3e881c2…`、`registry e4bc5230…`、`contracts fb88e6f1…`（测试前后一致） |
| 5 | 凭据与泄露面 | 基本通过（1 项设计未落地） | grep / 代码审读 | 数据与产物无本人密钥；emby 封面全为本地路径（33 个文件全在）；日志脱敏实测生效；**跨域重定向剥认证头：未实现** |
| 6 | 时间线 | 通过 | 真实数据 + 纯函数层 | 4950 事件 / 4950 唯一键 / 重复 0 / 未来事件 0；各栏目分页「同天跨页=0」；北京日键正确；页头计数与数据一致 |
| 7 | 浏览器渲染 | 通过 | 本地 preview + 真实 Chrome，375 与 1440 | 首屏卡片、筛选计数、无限加载（10→41 行、0 重复）、跳转链接 10/10 可解析、00:09 条目归 07.15 |
| 8 | 输出语义 | 通过 | md5 与 `git show 128e6a9:` 对比 | `emby.json 47df15f1…`、`image-meta.json 3b0eba06…`，与基线完全相同；两文件在该区间 `git diff` 为空 |

## 2. 依据（真实输出）

### 2.1 类型检查 / 测试 / 构建

```
$ yarn astro check
Result (228 files):
- 0 errors
- 0 warnings
- 63 hints
Done in 8.03s.

$ npx vitest run
Test Files  29 passed (29)
     Tests  454 passed (454)
  Duration  4.10s

$ rm -rf dist && yarn build
[build] 2171 page(s) built in 18.89s
[build] Complete!
real 0m19.573s
```

与筑成自述（0 error / 454 passed / 2171 页）**完全复现**。

关于「离线」：构建全程读仓库内 `src/data/*.json`，日志无任何网络请求或告警；`src/` 内构建路径无 fetch（仅浏览器端脚本与 `src/lib/client/*`）。沙箱不允许 `unshare -rn`（`Operation not permitted`），**没有做断网复跑**，此点按「部分验证」记。

### 2.2 隐私检查与数据核对

```
$ node scripts/check-public-data.mjs
[check-public-data] 发布白名单：PUBLIC（默认 PUBLIC）
[src/data] memos 2668 条（PUBLIC=2668）
[src/data] 非公开记录 0 条（可用于检测的特征 0 条）
[dist] 没有非公开记录可检测，跳过
[check-public-data] 通过：src/data 与 dist 均未检出非公开记录
EXIT=0

$ node scripts/check-public-data.mjs --features-from /data/workspace/bots/知行/backups/memos-2026-11-26.json
[reference] …共 2910 条，非公开 242 条，生成特征 210 条（同文已在公开内容里的 15 条已排除）
[dist] 扫描 2238 个文本文件，命中 0 个，涉及 0 条非公开样本
EXIT=0
```

我另写脚本（不依赖其过滤规则）做交叉核对：

- 备份分布：`PUBLIC 2668 / UNLISTED 85 / PRIVATE 109 / DIRECT 48` → 非公开 242，新文件恰好 2668 条，`2910 - 2668 = 242` ✅
- 242 条非公开的 **id** 在新 `memos.json` 中命中 **0** 次；在 `dist` 中命中 **0** 次
- 用 181 条「正文 ≥24 字」的非公开条目做纯文本前缀检索，`dist` 命中 5 条，逐条查明：
  - 3 条：正文与一条 **PUBLIC** 条目全文相同（同文已公开，属重复发布）
  - 1 条：是一条更长 **PUBLIC** 条目的子串
  - 1 条（DIRECT）：正文 100% 出现在已发布文章 `la-mian-shi-fu-da-nao-he-mian-tuan-shi-jian` 中（69/69 个 20 字窗口命中）
- 因此 `dist/search-data.json`、`dist/rss.xml` 里各 1 处命中，来源都是那篇文章正文，**不是** memo 通道泄漏
- 结论：`src/data` 与 `dist` 均无本次变更引入的隐私泄漏。（正文片段按要求不在此文档复述）

### 2.3 fail-closed 反证

`/tmp/fc` 副本（同一棵树 + 可用的 `node_modules` 拷贝）先把两处改回旧语义：

- `normalizeMemoVisibility` 非字符串 → `PUBLIC`
- `isPublishableNeodbMark` → `Number(mark.visibility ?? 0) === 0`

```
$ npx vitest run
× 缺字段、null、空串、非数字一律不发布
× 可见性归一化：非字符串一律为空
× 缺 visibility 视为非公开（默认关闭）
× 过滤列表：空输入/非数组返回空数组，不抛错
× GoToSocial status 缺 visibility 时映射为空值，不兜底成 PUBLIC
× 缺 visibility 的 memo 落地时被丢弃（trimMemos 输出里没有它）
× 非法 visibility（null / 数字 / 对象 / 数组）同样落成空值且不可发布
× 整批都不可发布时仍然硬失败（不拿空数组覆盖已有文件）
Test Files  2 failed | 27 passed (29)
     Tests  8 failed | 446 passed (454)
```

当前实现的边界实测（`node --experimental-strip-types` 直接调纯函数）：

| 输入 | normalize | 可发布 |
| --- | --- | --- |
| `'PUBLIC'` / `' public '` / `'Public'` | `PUBLIC` | ✅ true |
| `'UNLISTED'` / `'PRIVATE'` / `'DIRECT'` | 同名 | ❌ false |
| `''` / `'   '` / `null` / `undefined` / `0` / `1` / `{}` / `[]` | `''` | ❌ false |

NeoDB（独立临时用例）：`0`、`'0'`、`' 0 '`、`0.0`、`'00'` → true；`1`、`2`、`null`、`''`、`'   '`、`{}`、`[]`、`true`、`'abc'`、缺字段、`null` 记录 → false。当前数据 1035 条 visibility 全为数字 `0`，过滤后仍 1035 条（条数与 URL 不变，与自述一致）。

来源侧（`trimMemos`）独立实测：7 条样本（PUBLIC / public / UNLISTED / 缺字段 / 数字 1 / null / 空白）→ 只保留 2 条；全批不可发布时抛错「拒绝用空数据覆盖已有文件」，不写空。

真实构建级双保险（`/tmp` 副本注入 1 条 UNLISTED 探针）：

```
默认白名单 build：探针在 dist 命中 0 个文件
MEMOS_PUBLISH_VISIBILITIES=public,unlisted build：探针命中 1077 个文件（2171 页照常）
```

即：store 侧过滤在真实产物上确实生效（数据文件里有非公开条目也渲染不出来），且显式配置能放开 —— 不是「一律拦」。顺带说明：我最初怀疑 `import.meta.env.MEMOS_PUBLISH_VISIBILITIES` 会被 Astro 的 `PUBLIC_` envPrefix 吃掉，实测**能读到**（构建期注入），该怀疑不成立。

### 2.4 接入层不变量（自建来源 + 注入 registry/contracts）

测试源 `/tmp/inv-src/testsrc.mjs`，通过 `registry = { invtest: { module: 'file:///tmp/inv-src/testsrc.mjs', optional: true } }` 注入，数据目录 `/tmp/inv/src/data` 预置旧文件。

| 场景 | 结果 |
| --- | --- |
| 正常两输出 | `changed=2`，两个文件都写；目标文件 **inode 变化**（rename，不是原地覆盖）；无残留 `.tmp-*` |
| 同输入重跑 | `changed=0`，`wrote=[false,false]`，两个文件 md5 不变（字节级幂等） |
| 字段类型错 | `code=contract`「#0: 字段 ts 类型是 string，要求 number」，旧文件保留，目录里没有临时文件 → **校验在写盘前** |
| 重复主键 | `code=contract`「重复的主键 id=x」，旧文件保留 |
| 排序后置条件（orderBy 降序） | `code=contract`「排序后置条件不满足…」，旧文件保留 |
| 多输出部分失败 | 失败在 `inv.b`，`inv.a` 也**没有写**（两文件都保旧）→ 多输出「全通过才写」成立 |
| 空结果 + `allowEmpty:false` | `code=empty`「结果为空且契约不允许空输出，保留旧数据」，保旧 |
| 空结果 + `allowEmpty:true` | 成功，`changed=2`，`inv-a.json` 内容为 `[]` → 合法空允许写 |
| `complete:false` | `code=incomplete`「未拉完（2/7 pages），保留旧数据」，保旧 |
| 401 | `code=auth`「HTTP 401」，保旧 |
| 429 | `code=upstream`「HTTP 429」，保旧 |
| 超时（timeoutMs=400，上游挂住） | `code=upstream`「collect 超时」，实测 401ms 返回，保旧 |
| 缺凭据 | `code=auth`「缺少凭据 INV_TOKEN，保留已有数据」，不碰文件 |
| 状态/游标 | 失败后 `.cache/sync-state.json` 仍为 `null`（无记录）；成功后才写入 `lastSuccessAt` 与各 dataset 条数 |
| 日志脱敏 | 抛错信息里 token 与 `api_key=…` 均变 `***`，原文未出现 |
| dry-run | `changed=0`、`wrote=[false,false]`，文件不变 |

端到端补一条（真实 `sync-data.mjs`，无 `EMBY_*` 凭据）：

```
$ env -u EMBY_BASE_URL -u EMBY_USER_ID -u EMBY_API_KEY node scripts/sync-data.mjs emby
[emby] 可选源同步失败，已跳过（保留现有数据）: 缺少凭据 EMBY_BASE_URL, EMBY_USER_ID, EMBY_API_KEY…
同步完成，0 个文件有变化
EXIT=0
emby.json md5 前后均为 47df15f1a3a922a1b50e7a88c18b6fdb
```

`scripts/` 内无 `readline` / `prompt(`（grep 为空），不存在交互等待。

### 2.5 凭据与泄露面

- `src/data`、`public/`、`dist/` 无本人密钥；命中的 `api key`/`secret` 字样均为文章正文里的工具教程文字（如 bitwarden/websocket 那篇），非凭据
- `emby.json` 里 `http` 出现 **0** 次，`cover` 全为 `/emby-cover/<id>.jpg`；33 个封面文件在 `public/` 与 `dist/` 都齐全，无 404
- 正文里确有第三方 URL 带 token（`webhook.actionsflow…?__token=…`、头条 `share_token=…`）——**基线 `128e6a9` 的 ghost.json 与基线 dist 里就已存在**，不是本次引入；按已有内容风险记录（详情不在此复述）
- 脱敏：新执行器 `sanitize()` 实测生效（见 §2.4）；旧的 `sync-data.mjs fetchJson` 不脱敏，但所有密钥都在 header（`X-Emby-Token`/`X-Auth-Token`/`Bearer`/`Basic`），错误里拼接的 URL 不含密钥，`MAP_KMZ_URL` 报错只打状态码
- **跨域重定向剥认证头：未实现。** `docs/specs/2026-11-26-data-ingest-spec.md:109` 写「必须剥掉 Authorization」，代码里没有任何 `redirect` 处理（执行器默认跟随，`sync-data.mjs` 只显式写了 `redirect:'follow'`）。按「设计未落地」记，不按通过。

### 2.6 时间线

真实数据（`/tmp` 副本导入 store）：

```
memos.json 2668 | neodb 1035（全部可发布）| emby 152
timeline 事件数 4950 {all:4950, post:863, memo:2668, neodb:1035, strava:178, reading:54, media:152, readingAndMedia:206}
唯一键 4950 | 重复键 0 | 未来事件(>now+5min) 0 | 5 分钟内 0 | 最早 1900-01-01T08:40Z 最新 2026-11-24T16:42Z
排序确定性(两次相同) true | 排序与 store 输出一致 true | 相邻比较器违例 0
[post] items=863 pages=83  sum=863  同天跨页=0 非末页<10 的页数=0
[memo] items=2668 pages=211 sum=2668 同天跨页=0 非末页<10 的页数=0
[strava] items=178 pages=17 sum=178 同天跨页=0
[reading] items=206 pages=18 sum=206 同天跨页=0（含 media）
readingDayTime 2026-01-02 = 1767283200000 = Date.parse('2026-01-02T00:00:00+08:00') | cnDateKey 回读 2026-01-02
emby 有时间的条目 152 | timeline media 152 | emby 唯一 id 152 | 缺 lastPlayedAt 0
reading+media = 206 = readingAndMedia
```

页头计数（真实渲染的 DOM）：`全部 3915 / 文章 863 / 随记 2668 / 运动 178 / 阅读与影视 206`，与 `timelineVisible` 计数逐项相同；`共 863 条`、`共 2668 条`、`共 178 条`、`共 206 条` 与各栏目条目数一致。`TIMELINE_INCLUDE_NEODB=false` 时 neodb 已剔除（3915 = 4950 − 1035）。

跨日边界（北京日键）：北京 00:00–01:30 的 memo 共 33 条，其 UTC 日期都比北京日期早一天。抽 `01KXGP8BM…`（UTC 2026-07-14T16:09:43Z = 北京 07-15 00:09）：

```
dist/timeline/memo/10/index.html 渲染 «07.15 | 周三»
当天（北京 07-15）memo 共 3 条，全在 page 10；page 11 首行日期键 2026-07-14
→ 同一天不跨页；凌晨条目不落到前一天
```

基线与本次 URL 集合对比（`dist/**/index.html`）：

```
baseline urls 2229 | new urls 2172 | only-baseline 57 | only-new 0
仅消失的 57 个（全部是数字分页尾页，无一个内容页）：
  首页 /<n>/        393..416（其中 404 在基线也不存在 → 实际 23 个）
  /now/             179..194（16 个）
  /timeline/memo/   212..229（18 个）
post / strava / reading 的分页上限不变（83 / 17 / 18）
复核：page 392 两边都有；393/416 只有基线有；417 两边都没有
```

`2229/2172` 含根路径 `/` 一次，按 Astro 的「页」口径即 `2228 / 2171`，与自述一致。

### 2.7 浏览器真实渲染（真实 Chrome，非 HTML 字符串）

用本地 `astro preview` 起我本机构建的 `dist`（2171 页），挂载浏览器打开 `http://127.0.0.1:4321/…`。挂载浏览器视口固定 1280×800 且 `resizeTo` 无效（`innerWidth` 仍 1280），因此 375/1440 用**同源 iframe 精确设定视口宽度**在真实浏览器内渲染 —— 布局与媒体查询按 375/1440 CSS px 计算，但不是设备模拟（无触摸、DPR=1）。

| 检查 | 375 | 1440 |
| --- | --- | --- |
| 视口 / 移动/桌面媒体查询 | `innerWidth 373–375`，`max-width:768px` = true | `innerWidth 1438–1440`，`min-width:1024px` = true |
| 横向溢出 | 无（`scrollWidth 364 < 375`） | 无（`1431 < 1440`） |
| 首屏卡片 | post 3 / memo 6 / strava 4 / reading 2（日组） | post 3 / memo 6 |
| 筛选计数 | 全部 3915 / 文章 863 / 随记 2668 / 运动 178 / 阅读与影视 206 | 同左 |
| 卡片宽度 | 单列 | 736px，右侧栏（热力图 + Tags）正常 |
| 无限加载 | 10 → 41 行，重复 0，`data-next` `/timeline/post/2 → /5`，页尾状态「继续向下滚动加载更多」 | 首屏 `data-next=/timeline/post/2` 正常 |
| 分页边界 | 第 1 页末行日键 `2026-08-07`，第 2 页首行 `2026-07-23`（不同天），边界行**未**被标 `is-repeat` | — |
| 卡片跳转 | post 卡片 10/10 href 在 dist 中存在并可解析 | — |
| 媒体封面 | `/emby-cover/7791.jpg` 自然尺寸 320×480 已加载；阅读封面 webp 正常；进度徽标 46% / 10% 渲染 | — |

截图三张（存于本次会话）：`/timeline/post/ @375`、`/timeline/reading/ @375`（Emby + 阅读封面、进度）、`/timeline/post/ @1440`。

### 2.8 输出语义

```
src/data/emby.json        47df15f1a3a922a1b50e7a88c18b6fdb
git show 128e6a9:…emby.json  47df15f1a3a922a1b50e7a88c18b6fdb
src/data/image-meta.json  3b0eba06dec91addf1243de35600dc43
git show 128e6a9:…image-meta.json 3b0eba06dec91addf1243de35600dc43
git diff --stat 128e6a9 b7f5075 -- src/data/emby.json src/data/image-meta.json  → 空
```

M2 把 emby/imagemeta 迁到模块层后，产物与基线逐字节一致 —— 重构没有改变输出语义。

## 3. 必修与可延后

### 必修（必须合并前修）

**0 项。** 未发现会导致数据丢失、隐私泄漏、构建失败或功能回归的缺陷；本次变更的隐私边界与接入层不变量均有实测依据。

### 可延后（不影响合并，按优先级）

1. **跨域重定向未剥认证头（spec 标「必须」，实现缺失）**
   `docs/specs/2026-11-26-data-ingest-spec.md:109` 要求显式判断跨域跳转并剥 `Authorization`；`executor.mjs` 的 `fetchWithTimeout` 直接透传 options，没有 `redirect` 处理。影响：自建 Emby 若被反代跨域 302，`X-Emby-Token` 属自定义头，undici 默认**不会**像 `Authorization` 那样剥掉。建议 `redirect:'manual'` 手动跟随、仅同源保留凭据头；或显式声明「不跟随重定向」。当前失败方向是「保旧数据」，不是数据损坏，故不阻断。

2. **隐私闸门没进 CI**
   CI（`.github/workflows/ci.yml`）跑 `astro check` / `test` / `build` / `check-no-modu-db`，但**没有** `node scripts/check-public-data.mjs`。影响：这道闸门目前只能靠人记得手动跑，回归不会被自动拦住。建议在 build 之后加一行（`--features-from` 需外部备份，CI 里用默认模式即可）。

3. **时间线 id 兜底会把多条无 id memo 合成 1 条**
   `timelineEntryId` 对 memo 只取 `data.id`，缺失时返回 `''`，去重键变成 `memos:`。实测：两条无 id 的 memo → `buildTimeline` 输出 **1 条**。当前数据 2668 条 memo 都有 id，未触发；但一旦上游漏 id 会静默丢卡片（不报错）。建议兜底用 `createdTs`（或 `createdTs + 内容哈希`）。

4. **超时提示取整到 0 秒（提示失真）**
   `Math.round(timeoutMs / 1000)` 对 400ms 超时渲染成「collect 超时（0s）」（实测）。行为正确、只是日志误导，改 `Math.ceil` 或显示毫秒即可。

另需在合并前确认（不算缺陷）：`docs/specs/2026-11-26-{data-ingest,plan-acceptance,timeline}-spec.md` 这三个文件在工作树里是**未跟踪**状态，若它们应随分支进仓库，需要补一次提交；否则评审/规范文档会缺失。

## 4. 与筑成自述的对照

**数字与结论全部复现，无矛盾项。** 逐条比对：0 error ✅、454 passed / 29 files ✅、2171 页 ✅、`check-public-data` 双模式 EXIT=0 ✅、242 条非公开被移除 ✅、57 个消失 URL（首页 23 + /now/ 16 + /timeline/memo/ 18）✅、只减不增 ✅、`emby.json`/`image-meta.json` 未变 ✅、NeoDB 1035 条全部显式 `0`、过滤后条数不变 ✅、旧实现下 8 条测试变红 ✅。

两处口径需要说清（非矛盾）：

1. **「dist 命中 0」依赖排除规则。** 其脚本用「同文已在公开内容里则排除」剔掉了 15 条特征；我不带该排除规则直接检索，会命中 5 条。我逐条查证这 5 条都是「已公开过的同文」（3 条重复发布、1 条子串、1 条完整收录在已发布文章），因此「无泄漏」的结论成立，但**「0 命中」是过滤后的表述**，不是原始检索结果。
2. **基线页数 2228 / 本分支 2171** 与我统计的 URL 集合 2229 / 2172 差 1，原因是我把根路径 `/` 单独计了一次（Astro 页数口径不含重复计数的根）。两者一致。

## 5. 未验证 / 限制（如实标记）

- **断网构建未做**：沙箱 `unshare -rn` 不允许；只做到「构建路径无网络调用 + 构建日志无网络错误」。
- **CI 真实环境未跑**：本地 Node 24，CI 是 Ubuntu + Node 22；类型剥离（`import … .ts`）依赖 Node ≥22.18，CI 的 `22` 会取最新补丁版，但未在 CI 实跑。
- **上游为模拟**：401/429/超时/分页不全用注入实现验证，未对真实 Emby/NeoDB/Miniflux 打请求（无凭据；也未改动主检出的 TMDB 改动）。
- **375/1440 为同源 iframe 设定视口**：真实浏览器布局与媒体查询生效，但非设备模拟（无触摸、无移动端 UA、DPR=1）；挂载浏览器视口固定 1280，`window.resizeTo` 无效。
- **Emby 封面实际像素 320 宽**：`emby.json` 站内封面为历史产物（请求参数写 780，落盘图仍 320），属基线既有，不影响本次结论。

## 6. 复现方式

- 只读复跑：在 `worktrees/modular-2026-11-26` 依次 `yarn astro check`、`npx vitest run`、`rm -rf dist && yarn build`、`node scripts/check-public-data.mjs [--features-from /data/workspace/bots/知行/backups/memos-2026-11-26.json]`
- fail-closed 反证：复制树到 `/tmp/fc`（拷贝 `node_modules`），按 §2.3 改两处后 `npx vitest run`
- 接入层不变量：`/tmp/inv-src/testsrc.mjs`（临时来源）+ `/tmp/inv-test.mjs`（13 组断言），`node /tmp/inv-test.mjs`
- 浏览器：在 worktree 起 `npx astro preview --port 4321`，用挂载浏览器打开后按 §2.7 用同源 iframe 设 375/1440
