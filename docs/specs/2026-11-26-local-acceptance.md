# 本地验收记录：数据接入模块化试点（第二轮收尾）

- 分支：`feat/data-modular-pilot`（未推送、未合并、未上线）
- 基线 HEAD：`4b568f4`；本轮新增本文件与 `scripts/ci-local.mjs`、`scripts/lib/ingest/sensitive-headers.mjs` 及测试
- 环境：NAS 本机容器（非 ROG-Flower），Node 24，真实 Chrome（内置浏览器）做视口验证
- 预览：`astro preview --host 0.0.0.0 --port 4321`，构建 2171 页；进程 pid 见回执

## 1. 320 / 768 真实浏览器验证

方法：构建产物里放一张临时探针页（`dist/__probe.html`，**不入库**），用真实 Chrome 以 320 / 768 宽度渲染 iframe，读 `scrollWidth/clientWidth` 与实际元素宽度；不靠截图目测。

| 视口 | 页面 | 横向溢出 | 卡片列 | 实测 |
| --- | --- | --- | --- | --- |
| 320 | `/timeline/reading/` | 无（scrollWidth 313 = clientWidth 313） | 1 列，首卡 281px | 侧栏折叠为抽屉，卡片单列 |
| 768 | `/timeline/reading/` | 无（761 = 761） | 侧栏 + 内容 | 首卡 217px，双列卡片 |

- 320 下「阅读与影视」卡片、封面、划线按钮（「6 条划线」）均可见，无文本截断错位。
- 768 下侧栏与内容并存，无横向滚动条。
- 未覆盖：480 / 1024 断点、触摸手势（本机无触摸设备）。

## 2. 敏感认证头：通用声明 + 跨域剥离

**问题**：执行器原来硬编码 `AUTH_HEADERS = [authorization, cookie, proxy-authorization, x-emby-token]`。接第三个来源时，只要它用新的自定义头（`X-Foo-Token`、`X-Api-Key`、`X-Session-Id`），跨源跳转就会原样带过去 —— 这是「接第三源前」就存在的已知泄密缺口。

**改法**（`scripts/lib/ingest/sensitive-headers.mjs`）：
1. 通用模式：头名命中 `auth / cookie / token / secret / session / api-key / password / credential / signature` 之一即敏感（新来源无需登记）；
2. 显式声明：`meta.sensitiveHeaders: [...]` 列出的名字一律敏感，兜住命名不规整的私有头（如 `x-acme`）；
3. 只在**跨源**跳转时剥离；同源跳转保留（取图、分页仍可用）。
执行器改为 `stripSensitiveHeaders(pairs, meta.sensitiveHeaders)`，`X-Emby-Token` 也在 `emby.mjs` 的 meta 里显式声明（双保险）。

**反向用例（证明这个洞是真实存在的）**：把通用模式改成永不命中后重跑，失败条数随基线变化（口径按当时用例数写清，不混用）：

| 基线 | 用例数 | 通用模式改 `NEVER_MATCH_xyz` 后 | 谁实测 |
| --- | --- | --- | --- |
| `2b2e2f5`（38 条时代） | 38 | **4 failed** / 34 passed | 明鉴（round2）、我 |
| `17d5d77`（加词边界回归用例后） | 39 | **5 failed** / 34 passed | 明鉴（最终增量复核）、我（本轮复核时自己复跑确认） |
| `51be4c7`（本轮返工后） | 69 | **23 failed** / 46 passed | 筑成（自测）、我（本轮自跑确认） |

即：早前文档把 `17d5d77` 这一列写成「4 条」是错的——那时的基线已从 38 涨到 39，新增的「词边界回归」用例本身也依赖该正则，故为 5 条。已按实跑更正。

**词边界收紧（独立复核后加的一条）**：初版把关键词当子串匹配，`x-author`、`x-tokenizer` 这类「只是含 auth/token」的头也被剥。`17d5d77` 先收紧为「关键词两侧都必须是头名边界」，`x-author` / `x-tokenizer` 保留，`x-api-key` / `x-auth-mode` / `x-session-cache` / `x-emby-token` 照旧剥。

**这次收紧引入的 fail-open（`51be4c7` 已修）**：要求右边界后，拼接式命名反过来被放行——`x-sessionid`、`x-authtoken`、`x-secretkey`、`x-credentialid`、`x-tokenid`、`x-apikeys`、`x-api-keys` 由「跨源剥离」退成「跨源保留」，属安全方向的回退；且 `x-csrftoken`（Django/axios 常见头）新旧两版都不命中。明鉴在最终增量复核里点出这一条（无阻塞，因为三个已知源都用标准头名、且 `meta.sensitiveHeaders` 声明层仍然生效），本轮按最小改法修掉：

- 命中位置改为「左边界（`^` 或 `-`/`_` 之后）**或** 关键词恰好收尾」，右侧不再要求边界 → 拼接式命名与 `x-csrftoken` 一并覆盖；
- 两处已知误报在同一处豁免：`auth(?!ors?\b)` 放行 `author`/`authors`，`token(?!i[sz]e)` 放行 `tokenizer`/`tokenize`；
- 判定仍在一个正则里，不是逐名硬编码；导出名与同源保留、显式声明两条语义未动。

实测（我本轮自跑，直接 import 模块）：STRIP 表 **20/20** 全中（含上述 7 个拼接式 + `x-csrftoken` + 旧 `x-emby-*`），KEEP 表 **13/13** 全保留（`x-author`、`x-authors`、`x-tokenizer`、`x-tokenize`、`if-none-match`、`accept-language`、`x-request-id`、`x-api-version`、`x-trace`、`x-correlation-id`、`x-client-id`、`x-oauth2-scope`、`x-ratelimit-remaining`），`x-acme` 声明后 true、未声明 false。用例 39 → **69**；反向把正则改 `NEVER_MATCH` 挂 **23** 条，恢复后 69/69。

```
npx vitest run tests/scripts/ingest.test.ts     Tests 69 passed (69)   （本轮 51be4c7）
npx vitest run                                  Test Files 29 passed (29) / Tests 501 passed (501)
  51be4c7 新增 30 条（20 STRIP + 9 KEEP + 1 整链断言）；原有 39 条断言一行未改；
  早前 39 条时代新增的 6 条仍在：x-thirdparty-token / x-api-key / x-session-id /
  x-client-secret 跨域被剥；x-acme 靠声明被剥；同源保留；x-author / x-tokenizer 不被误剥
```

## 3. 构建外链与离线构建

方法：用 `--import` 预加载一个「屏蔽一切出站网络」的模块（patch `fetch` / `net` / `dns` / `http(s)`，任何调用都记录并抛错），再跑完整构建。容器内 `unshare -n` 不被允许，因此这是断网等价验证，不是内核级隔离。

| 跑法 | 结果 | 出站尝试 |
| --- | --- | --- |
| 默认 | 2171 页，成功 | 1 次：`https://telemetry.astro.build/api/v1/record`（Astro 匿名统计，被拦后不影响构建） |
| `ASTRO_TELEMETRY_DISABLED=1` | 2171 页，成功 | **0 次** |

结论：构建对网络零依赖；唯一外呼是 Astro 遥测，建议 CI 与本地都设 `ASTRO_TELEMETRY_DISABLED=1`。

**页面运行期**仍引用外部主机（按出现次数）：`1900.live`、`cdn.1900.live`（图片/CDN）、`og.190102.xyz`、`chart.1900.live`（统计脚本，来自 Ghost code injection）、`s3.996288.xyz`、`social.1900.live`、`artalk.1900.live`（评论）、`memos.1900.live`。这些是浏览器侧请求，不是构建依赖；要让站点在断网环境完全可用需把图片/统计/评论本地化，属较大改造，本轮不做，只登记。

## 4. Emby 冻结输入新旧对照（线上真实同步本轮未验证）

**凭据现状（如实，不推断）**：

- 本机（NAS 容器 worktree）**无 `.env`**，环境变量里也没有 `EMBY_BASE_URL` / `EMBY_USER_ID` / `EMBY_API_KEY`；
- 团队保险库**确有 Emby 相关密钥**；本轮**未取用、未读取其内容**，也未将它写入任何文件或环境变量；
- 因此正确说法是「本轮**未做**线上真实同步对照」，而不是「没有凭据」或「凭据只在 Actions Secrets」。之前的写法属臆断，已删。

未做的原因：本轮任务范围是本地收尾返工（敏感头修复 + 文档 + 预览），发包方明确要求不中请新凭据、不实跑上游。要补这一步，需单独授权并给出取用方式；真要跑，也要先在排演环境确认不污染 `src/data/emby.json`。

**替代证据：冻结输入对照**（不联网、不打印密钥）：
- 用 `fixtures/emby-sample.json` 起本地假 Emby（Items / Resume / 详情 / 图片），
- 旧实现 = 模块化迁移前的 `scripts/sync-emby.mjs`（`a7eda60^`），新实现 = 执行器 + `scripts/lib/sources/emby.mjs`，
- 两边喂同一份假数据，比较落盘 JSON 与封面：

```
oldEntries 3 / newEntries 3
sameBytes true            ← emby.json 逐字节相同
sameCovers true (1 / 1)
oldRequests 5 / newRequests 5   ← 请求序列条数一致
```

结论：同等输入下新实现与旧实现行为一致；**线上真实数据仍未验证**（本轮未取用保险库密钥，不中请新凭据），属**待授权的未验证项**，不是外部阻塞也无法归因于「缺凭据」。

## 5. CI 本地等价

新增 `scripts/ci-local.mjs`，按 `ci.yml` 构建侧闸门顺序执行：类型检查 → 单元测试 → 构建（可选断网等价）→ 隐私闸门 → 泄露闸门，逐项 PASS/FAIL 汇总，任一失败即退出 1。

```
node scripts/ci-local.mjs --offline        （2026-11-26 18:30，HEAD 51be4c7，ASTRO_TELEMETRY_DISABLED=1）
PASS  类型检查 astro check  (8.5s, exit 0)
PASS  单元测试 vitest  (4.9s, exit 0)   501 passed (501) / 29 files
PASS  构建 astro build（断网等价）  (27.3s, exit 0)   2171 page(s)
PASS  隐私闸门 check-public-data  (0.1s, exit 0)   memos 2668 条 PUBLIC=2668，非公开 0 条
PASS  泄露闸门 check-no-modu-db  (0.0s, exit 0)
EXIT=0；/tmp/ci-offline-net.log 未生成 → 构建期 0 次出站
```

（早前 `17d5d77` 同类跑法为 471 passed / 2171 页 / 出站 0 次，差异只在测试条数。）

**Node 版本坑**：Astro 要求 `>=22.23.4`。Node 22.20.0 下 `astro check` / `astro build` 会失败并提示升级版本，容易被误读成代码问题；CI 的 `node-version: '22'` 取当时最新 22.x，不受影响。

不覆盖（必须由 CI 补）：garden vault 只读拉取（需 `GARDEN_VAULT_TOKEN`）、定时取数、数据提交与 rebase 推送。**Actions 未运行**，不得据本节宣称已上线。

## 6. 剩余源迁移清单

已完成：`emby`（M2 试点，含本轮冻结输入对照）、`imagemeta`。执行器/契约/登记表已就位。

| 源 | 输出 | 凭据（CI Secrets） | 迁移注意 |
| --- | --- | --- | --- |
| ghost | `ghost.json` | `GHOST_API_URL`、`GHOST_API_KEY` | 含文章正文与 code injection，脱敏与字段白名单先定 |
| memos | `memos.json` | `GOTOSOCIAL_URL`、`GOTOSOCIAL_TOKEN`、`GOTOSOCIAL_ACCOUNT_ID` | **必须继续走 `privacy.ts` 白名单**，非公开 242 条不得回流 |
| neodb | `neodb.json` | `NEODB_TOKEN` | visibility 0/1/2 只发 0，已实现于 store 侧 |
| flux | `flux.json` / `flux-lost.json` | 无（Miniflux 走 env 内 URL） | 一个源两个产物，需 `files()` 多输出与 `allowEmpty` |
| intervals | `activities.json` | `INTERVALS_ICU_API_KEY`、`INTERVALS_ICU_ATHLETE_ID` | 轨迹增量缓存、全量校正（`SYNC_FULL`）语义要保留 |
| map | `geojson.json` | `MAP_KMZ_URL` | 大文件，离线构建不受影响 |
| rank | `rank.json` | 无 | 纯本地计算，迁移收益低，可最后做 |
| reading | `reading.json` + 封面 | `MODU_WEBDAV_*` | 只读 WebDAV；分片枚举、`coverKeyOf` 命名、可选源语义都已定 |

迁移顺序建议：`memos`（有隐私闸门，最需要统一口径）→ `ghost` → `neodb` → `flux` → `intervals` → `map` → `reading` → `rank`。每迁移一个，旧的 `sync-data.mjs` 分支删掉，跑 `ci-local.mjs` 并对该源做一次冻结输入对照。

## 7. 发布准备状态（四态）

| 项 | 状态 |
| --- | --- |
| 320/768 视口验证 | **完成**（真实 Chrome，无横向溢出） |
| 敏感头通用化 + 反向用例 | **完成**（69 条通过；去掉通用规则挂 23 条；词边界回归与拼接式命名双向可反向复现） |
| 独立复核（明鉴） | **完成**：round2（A–E 全实跑）与最终增量复核（`2b2e2f5..17d5d77`）均 0 阻塞；它点出的 3 条应改（含拼接式 fail-open）已在本轮 `51be4c7` 修掉（§11），修完再交它仅复核最终增量 |
| 离线构建验证 | **完成**（关闭遥测后出站 0 次） |
| Emby 新旧对照 | **部分完成**：冻结输入逐字节一致；线上真实同步**未验证**（保险库有密钥，本轮未取用、未申请新凭据，见 §4） |
| CI 本地等价 | **完成**（脚本 + 实跑）；Actions 本身未运行 |
| 剩余源迁移 | **未开始**（清单已给） |
| 推送 / 合并 / 上线 | **待授权**（本轮按指示不做；远端 main 已由他人推进到 `1e210d3`，见 §10） |

## 8. 安全回滚

- 本轮只新增两个文件（`sensitive-headers.mjs`、`ci-local.mjs`）并改执行器/emby meta/测试；回滚 = `git revert` 本轮提交，不涉及数据文件，不需要重跑取数。
- **恢复非公开随记不是发布回滚手段**：那 242 条是隐私过滤的结果，任何回滚都不得把它们带回 `src/data/memos.json` 或构建产物。
- 预览回滚：停进程即可（`npx astro preview stop`），不落任何持久状态；`dist/__probe.html` 是临时探针，不入库。

## 9. 独立复核结论与复核后改动

明鉴（独立质量角色）按 A–E 五项实跑复核：**通过，0 阻塞**。它自带用例验证了三件我没钉住的事：跨源 302 后 `x-trace` / `x-correlation-id` / `if-none-match` 保留、`x-acme` 靠声明被剥、同源全部保留；并实测「把通用规则关掉 → 失败」（它那一轮是 38 条基线的 **4 条**；到 `17d5d77` 的 39 条基线变成 5 条，见 §2 表）。全文见 `docs/reviews/2026-11-26-independent-review-round2.md`。

复核后只做了 4 处小改（复核时提的可选项，不涉及结论）：

| # | 改动 | 文件 |
| --- | --- | --- |
| 1 | 关键词加词边界，消除 `x-author` / `x-tokenizer` 误剥；补 1 条回归用例（反向可复现） | `sensitive-headers.mjs`、`ingest.test.ts` |
| 2 | `--offline` 的 `NODE_OPTIONS` 改为追加而非覆盖，不再吞掉使用者自己的 `--max-old-space-size` | `ci-local.mjs` |
| 3 | 删掉不可达的 `--fast` 构建跳过分支与随之无用的 `existsSync` 导入 | `ci-local.mjs` |
| 4 | 删掉 `executor.mjs` 里未使用的 `BASE_SENSITIVE_HEADERS` 导入 | `executor.mjs` |

改后重跑：`vitest` 29 files / **471 passed**，`ci-local --offline` 5/5 PASS，构建 2171 页、出站 0 次。这 4 处改动当时未经第二位复核人重看，已由下一轮「最终增量复核」覆盖（结论 0 阻塞 + 1 条应改：拼接式命名 fail-open，已在本轮 §11 修掉）。

仍会漏（设计如此，非缺陷）：不含任何关键词又不申报的私有头（如 `x-overseerr-key`）、身份类 `x-ms-client-principal` / `x-forwarded-user` 不在剥离范围；接新源时用这类命名必须写进 `meta.sensitiveHeaders`。

环境副作用：worktree 的 `node_modules` 是指向主检出 `node_modules` 的符号链接（`.gitignore` 写的是 `node_modules/`，带斜杠不匹配符号链接），因此 `git status` 永远有一条 `?? node_modules`；`astro build` 会写共享的 `.astro` 增量缓存（在 ignore 内），源码不受影响。主检出未提交的 TMDB 改动（`ci.yml`、`sync-emby.mjs`）本轮一个字节未动。

## 10. 远端状态（核对时间 2026-11-26 18:12，`git ls-remote origin`）

- `refs/heads/main` = **`1e210d3`**，已不是本轮开工时核对的 `ce29a90`：main 上多了 38 个提交（这正是昨天的阅读/影视时间线工作 + 两次 `chore(data): 定时同步外部数据源 [skip ci]`）。**不是我推的** —— 本轮从未 push。
- 本分支 `feat/data-modular-pilot` **不在远端**（`ls-remote` 无此 ref），只在本地 worktree。远端还挂着 `feat/reading-timeline` = `c29ab06`，即之前几轮报的 tip。
- 分支基点：`128e6a9`（`feat(covers)`）。**提交数一律现算，不写死**：`git rev-list --count origin/main..HEAD`。本文件所在提交自身也计入，所以任何写死在文档里的数字，落库那一刻就会 +1（这个数已经因此改过三轮）。
  - 各时点的实测值（供对账，不是当前值）：`17d5d77` = **12**（明鉴当时的数）；`51be4c7` = **13**；`269e9a4` = **14**；更早对话里说的“11”是 `17d5d77` 之前的旧口径。
  - 口径：`origin/main`(`1e210d3`)..HEAD 与 `128e6a9..HEAD` 数值相同（本分支自 `128e6a9` 起，无分叉穿插）。
  - 结论：数字有差不是矛盾，是提交在增加；以命令输出为准。
- `origin/main` 独有 2 个提交（两次定时数据同步）。
- 将来合入 main 时会撞的唯一文件：`src/data/memos.json`（main 上的定时同步改过它；本分支改的是结构/过滤，不是内容）。合入前先 `git rebase origin/main` 并重跑 `ci-local.mjs` 与隐私闸门，不要把远端新数据覆盖掉。

## 11. 最终增量复核后的返工（`51be4c7`）

明鉴对 `2b2e2f5..17d5d77` 的最终增量复核（`/data/workspace/bots/明鉴/reviews/2026-11-26-final-delta-17d5d77.md`）结论是「通过，0 阻塞，3 条应改」。**0 阻塞不等于没问题**，本轮把 3 条应改逐条落地。

| # | 明鉴的问题 | 处置 |
| --- | --- | --- |
| 1 | 词边界收紧带来 fail-open：7 个拼接式头名（`x-sessionid`、`x-authtoken`、`x-secretkey`、`x-credentialid`、`x-tokenid`、`x-apikeys`、`x-api-keys`）由剥变留，且无用例钉住 | **已修**（代码，`51be4c7`）：右侧不再要求边界，改「左边界或收尾」；补 30 条用例 |
| 2 | `x-csrftoken` 新旧正则都不命中（既有缺口） | **已修**（同一敏感头边界内）：收尾命中覆盖 `x-csrftoken`，并加用例 |
| 3 | 文档「永不命中挂 4 条」与 HEAD 实跑的 5 条不一致 | **已更正**（本文件 §2 表，含 38 / 39 / 69 三种基线的口径） |
| 4 | Emby 凭据表述与团队事实不符（保险库有密钥） | **已更正**（§4，见下） |
| 5 | 「本分支独有 11 个提交」 | **已改口径**（§10）：不再写死数字，给 `git rev-list --count origin/main..HEAD` 与各时点实测值（12 / 13 / 14） |

**Emby 口径更正**：之前写「凭据只在 GitHub Actions Secrets」是臆断。事实是——本机无 `.env`、无 `EMBY_*` 环境变量；团队保险库**有** Emby 密钥；本轮**未取用、未申请新凭据、未实跑上游同步**。所以「线上真实同步」的状态是**本轮未验证（待授权）**，既不能写成「外部阻塞」，也不能写成「不存在凭据」。冻结输入对照（§4）仍是唯一可用的等价证据。

**提交**：`51be4c7`（父 `17d5d77`，tree `68e3558`），只含 2 个文件：`scripts/lib/ingest/sensitive-headers.mjs`（+22/−4）、`tests/scripts/ingest.test.ts`（+54/−0）。源码面未动，故 `dist` 内容与 `17d5d77` 构建一致。

**我方自跑复核（不采信执行方口述）**：

```
npx vitest run tests/scripts/ingest.test.ts        69 passed (69)
npx vitest run                                     29 files / 501 passed (501)
node -e 直连模块：STRIP 20/20、KEEP 13/13（含 x-author/x-authors/x-tokenizer/x-oauth2-scope 等）、
                   x-acme 声明 true / 未声明 false、failures=0
反向 1：当前正则改 /NEVER_MATCH_xyz/ → 23 failed / 46 passed（69 条基线）
反向 2：git checkout 17d5d77 的两个文件 + 改 /NEVER_MATCH/ → 5 failed / 34 passed（39 条基线，证实旧文档的「4」是错的）
恢复：cp 回原文件 / git checkout HEAD -- → git status 仅 ?? node_modules，再跑 69/69
node scripts/ci-local.mjs --offline → 5/5 PASS，2171 页，出站 0 次（见 §5）
```

**仍未做**：push / 合并 / 上线 / 申请新凭据 / 实跑上游 / 扩大迁移范围；480、1024 断点与触摸手势未测；Actions 未运行；保险库密钥未读取，故「用它跑一遍真实同步」这件事仍未验证。

## 12. 预览刷新（对应最终构建）

旧预览进程（pid 52215）服务的 `dist` 早于本轮返工，不算最终版。已按 `51be4c7` 工作树**重新构建并重启预览**：

| 项 | 值 |
| --- | --- |
| 构建 | `ASTRO_TELEMETRY_DISABLED=1 node scripts/ci-local.mjs --offline`，`dist/index.html` mtime **18:30:07**，2171 页（`dist` 内 html 2174 个，含 404 两版） |
| 旧进程 | pid 52215 已停 |
| 新进程 | pid **58153**（`astro preview --host 0.0.0.0 --port 4321`），日志 `/tmp/preview-51be4c7.log` |
| 版本证据 | 服务端 `/` 响应 md5 `1f0a7963…a294066a` **等于** `dist/index.html`；`/timeline/reading/` 响应 md5 `9040a106…c71be3d2` **等于** `dist/timeline/reading/index.html` → 预览服务的就是本次构建产物，不是缓存旧版 |
| dist 整体指纹 | 全量文件 md5 汇总 `9f460398…b3013d1f` |

HTTP 实测（18:31）：

| 路径 | 状态 | 大小 | 标题 |
| --- | --- | --- | --- |
| `/` | 200 | 425,085 B | 只是玩玩 \\| 今天该把哪颗灯泡扭进脑袋… |
| `/timeline/memo/` | 200 | 434,553 B | 随记 \\| 只是玩玩 |
| `/timeline/reading/` | 200 | 428,063 B | 阅读与影视 \\| 只是玩玩 |
| `/now/` | 200 | 430,884 B | Now 🚩 \\| 只是玩玩 |

说明：`51be4c7` 只改 `scripts/lib/ingest/*` 与 `tests/*`，`src/` 与 `astro.config.*` 里没有任何文件引用它（`grep` 为空），所以本次构建的页面字节与 `17d5d77` 的构建应当一致；「预览对应最终版」指的是**进程与 dist 都来自 `51be4c7` 工作树重建**，不是页面内容发生了变化。

局域网仍不可达（容器只映射了 4433，未映射 4321），需主机侧加端口映射，不在本轮权限内、未改。

**复核后复验（18:37，同一进程 pid 58153，未重建 dist 以保住 §12 的指纹）**：进程启动时间 18:30:27 晚于 `dist/index.html` mtime 18:30:07，服务的是本次构建；四条路径的响应字节 md5 与本地文件逐一相同：

| 路径 | 状态 / 字节 | 响应 md5（前 8 位） | 对应 dist 文件 md5 |
| --- | --- | --- | --- |
| `/` | 200 / 425,085 | `1f0a7963` | `1f0a7963` |
| `/timeline/memo/` | 200 / 434,553 | `9a0c11fb` | `9a0c11fb` |
| `/timeline/reading/` | 200 / 428,063 | `9040a106` | `9040a106` |
| `/now/` | 200 / 430,884 | `4fc0e027` | `4fc0e027` |

“预览对应最终版”的证明链：`dist` 由 `51be4c7` 工作树构建；`17d5d77..HEAD` 仅 3 个文件（`scripts/lib/ingest/sensitive-headers.mjs`、`tests/scripts/ingest.test.ts`、本文件），`grep -rn lib/ingest src astro.config.mjs` 为空（构建不引用），其后 `51be4c7..HEAD` 只有本文件 —— 故页面字节与最终源码状态一致。

## 13. 明鉴第二轮复核（`51be4c7`）结论与我方处置

结论：**通过，0 阻塞；1 条需改（本文档 §10 提交数）、2 条可选**。全文见 `/data/workspace/bots/明鉴/reviews/`。逐条处置：

| # | 明鉴的发现 | 处置 |
| --- | --- | --- |
| 1 | §10 提交数写 13，实际 14（自指） | **已改**：不再写死，改命令口径 + 各时点实测值 |
| 2 | `scripts/lib/ingest/sensitive-headers.mjs:26` 注释称 `tokenization` 也放行，实跑 `x-tokenization` = **SENSITIVE**（`token(?!i[sz]e)` 只放行 tokenizer / tokenize） | **未改代码，登记为已知余项**（见下），原因：这是注释与实现不符、且实现方向偏安全侧（多剥不漏剥），改它要动代码提交，会让 `51be4c7` 已完成的独立复核失去覆盖 |
| 3 | 右侧不要求边界带来的新误剥（`x-authorize`、`x-secretary`、`x-cookiecutter` 等） | **接受不改**：现实中几乎不会作为头名出现，且方向是“多剥”，安全侧无害 |

**已知余项（不粉饰，留给下一次代码提交）**：`sensitive-headers.mjs:26` 注释多写了 `tokenization`。实现是对的（它被判敏感），注释是错的。最小改法 = 删掉注释里那三个字，零行为变化。**不影响任何测试或构建结论**；本轮遵守“只改文档”的范围约束，未动它。

**仍未验证**：本轮复核未重跑 `ci-local --offline` 构建段（为保住 §12 的 dist 指纹）；构建段证据是 §12 的 18:30 实跑（同一工作树，之后只多文档提交）。

## 14. 八源迁移：盘点、设计与分批（2026-11-26 20:45 起）

范围：`memos → ghost → neodb → flux → intervals → map → reading → rank` 全部接进统一模块层。不动前端、不造插件系统、不 push/合并/上线。

### 14.1 实际入口与产物（逐项核对源码与 `src/data/*.json`）

| 源 | 现有入口（`scripts/sync-data.mjs`） | 产物 / 形状 | 主键 | 必须保留的语义坑 | 凭据 |
| --- | --- | --- | --- | --- | --- |
| memos | `syncMemos` → `syncGtsMemos`（GoToSocial 优先）/ 旧 Memos API 兜底 | `memos.json` 数组 2668，按 `createdTs` 降序 | `id` | `privacy.ts` 白名单必须在模块内执行；非公开 242 条**不得回流**；空结果拒绝覆盖；缺 visibility 落 `''` 不算公开 | `GOTOSOCIAL_URL`、`GOTOSOCIAL_TOKEN`、`GOTOSOCIAL_ACCOUNT_ID`（可选） |
| ghost | `syncGhost` | `ghost.json` 对象 `{settings,posts(863),pages(16),authors(1),tags(100)}`，tags 内嵌裁剪后的 posts | `posts/pages/authors/tags` 各自 `id` | 五段全部校验；0 篇拒写；内嵌 tags/authors 裁剪；`GHOST_API_POST_LIMIT` | `GHOST_API_URL`、`GHOST_API_KEY` |
| neodb | `syncNeodb` | `neodb.json` 对象 `{data:[1035]}` | `post_id` | 增量合并 + `SYNC_FULL`；中文标题沿用上一版；空结果拒写；visibility 只发 0 在 store 侧（不动） | `NEODB_TOKEN`（`NEODB_API_URL`/`NEODB_SHELVES` 可选） |
| flux | `syncFlux` + `buildFluxSnapshot` | `flux.json` 数组 141（`url` 唯一）+ `flux-lost.json` 数组 9（`id` 唯一，空是合法结果） | `url` / `id` | **一个源两个产物**，任一失败不写；>50% feed 失败放弃本次；失败订阅沿用上一版文章与失联时间 | `FLUX_URL`、`FLUX_KEY`（`FLUX_READER_PROXY` 可选） |
| intervals | `syncIntervals` | `activities.json` 数组 178，按 `start_date_local` **升序** | `id` | 活动全量按自然年窗口、轨迹走上一版缓存、`SYNC_FULL` 全重拉；空结果拒写；单条地图失败只计数 | `INTERVALS_ICU_API_KEY`、`INTERVALS_ICU_ATHLETE_ID` |
| map | `syncMap` | `geojson.json` 对象 `{type,features(127)}` | 无（features 无稳定 id） | KMZ 下载 → `python3 scripts/map/convert_kmz_to_geojson.py`；`If-Modified-Since` 基于产物 mtime、304 复用本地；空 KMZ 报错 | `MAP_KMZ_URL` |
| reading | `scripts/sync-reading.mjs` 的 `syncReading` | `reading.json` 对象 `{generatedAt,source,totals,books(18),days(54),warnings}` | `books`/`days` 无稳定 id | WebDAV 分片 + 封面附属产物 + override 合并；**optional**（NAS 打盹不拖垮整轮） | `READING_*`（WebDAV 地址/账号） |
| rank | `syncRank` | `rank.json` 任意对象（当前是 `{success:false,error}`） | 无 | 远端 worker；失败只告警、保留旧数据 → 迁移后必须 `optional: true` 才不改变退出码语义 | 无 |

### 14.2 框架需要补的四处（都是通用能力，不加插件机制）

1. `contracts`/`validate` 增加 `shape: 'object'`：声明顶层字段，数组字段可带 `item`/`key`/`allowEmpty`，`countField` 指定日志与状态用的数组；未声明字段放行（rank 这类上游可变的）。
2. `orderDir: 'asc' | 'desc'`（默认 `desc`）：intervals 是升序，沿用现有 `orderBy` 校验但允许方向。
3. 数组字段的 `key` **可省略**：省略即不做主键唯一性校验（`reading.books`、`geojson.features` 没有稳定 id），普通数组仍要求 `id`。
4. `ctx.fileStat(file)`：只读返回产物 `mtime/size`（map 的 `If-Modified-Since` 需要，模块不碰 `fs`）。

模块可以 import `src/lib/*.ts` 里的纯函数（`privacy`、`flux-snapshot`、`feed-xml`、`intervals`）——这与现状一致，不新增依赖方向。旧分支删除后，`sync-data.mjs` 保留 `trimMemos`/`gtsStatusToMemo`/`classifyFailure`/`runSources` 的**兼容导出**，既有测试不必改写。

### 14.3 分批与单一写入者

| 批次 | 内容 | 写入者 |
| --- | --- | --- |
| A | 框架四处 + `memos` + `ghost` + `neodb`（三种产物形状各一例） | 筑成 |
| B | `flux`（双产物）+ `intervals`（缓存/全量）+ `map`（子进程+mtime）+ `reading`（WebDAV/附属产物）+ `rank` | 筑成 |

同一 worktree 同一时刻只有筑成写代码；我只写本文件，不与它并发改同一路径。

### 14.4 每源的验收口径（同一套）

- **冻结输入等价**：用旧实现在固定响应下的产物作 golden（`tests/fixtures/ingest/<source>/`），新模块对同一输入必须**深比较相等**（值与结构，不看字段顺序），并用真实 `src/data/*.json` 跑一遍 `validateDataset` 必须 0 错误——契约过严会误伤真实数据，这是首要回归风险。
- **失败语义**：空结果不覆盖、401/403 归 `auth`、429/5xx 归 `upstream`、多产物任一失败整源不写、可选源失败只告警。
- **敏感头**：带 `Authorization`/`X-Auth-Token` 的源各补一条跨源跳转剥头用例。
- **入口兼容**：`node scripts/sync-data.mjs <source> --dry-run` 仍可用（无凭据时给出分类错误，不崩）；`scripts/sync-reading.mjs` 仍导出 `syncReading`。
- **退出码**：整轮 `node scripts/sync-data.mjs --dry-run` 与迁移前一致。

### 14.5 风险

| 风险 | 处置 |
| --- | --- |
| 契约比真实数据严 → 同步被误判失败 | 类型从真实文件取样推导（联合类型容纳 null）；CI 加一条「真实文件过校验」用例 |
| memos 隐私回归（挪动 `trimMemos` 时漏掉空结果保护） | `privacy.test.ts` 原样跑 + `check-public-data.mjs` 双闸；非公开条数前后必须都是 0 |
| map 依赖 `python3` 与临时文件 | 同步期能力，不在构建链；失败按硬失败但可用 `--dry-run` 隔离验证 |
| 真实上游全部未验证（凭据/授权不在本轮） | 分三层写清：冻结输入等价（已验）/ 真实同步（未验）/ 凭据来源 |
| 八个源一次性提交难以归因 | 每源一个提交 + 每源一次全量测试；回归可单源 `git revert` |

## 15. 八源迁移终稿验收（2026-11-26 21:50，本节为最终状态，§6/§7/§12 的时点值已被本节取代）

### 15.1 状态

| 项 | 值 |
| --- | --- |
| 分支 / HEAD | `feat/data-modular-pilot` / 代码 **`8a570a8`**（代码提交到此为止；其后仅文档提交） |
| `origin/main..HEAD` | **29 个代码提交**（本轮新增 13 个，见 15.2）；其后另有纯文档提交（§15 落稿与复核标注），不涉代码，数量随标注变动，不据此计数 |
| `origin/main` | `1e210d3`（`git ls-remote` 实时核） |
| 工作区 | 仅 `?? node_modules`（符号链接，非本轮引入） |
| `src/` 与 `src/data/` 自 `630519c` | **0 行改动**（`git diff --stat` 为空） |
| push / merge / rebase / 上线 | **一件没做** |
| 独立复核覆盖 | 到 **`8a570a8`** 为止的最后一个代码提交（明鉴：可收尾、0 阻塞；A 批/B 批/上次两轮返工/本轮定点，共 5 份报告）。本节文档提交本身不含代码，未单独复核。 |

### 15.2 本轮提交（每源一个，可单源 revert）

| 提交 | 内容 |
| --- | --- |
| `3a24124` | 框架四处：`shape:'object'`+`fields`+`countField`、`orderDir`、数组 `key` 可省、`ctx.fileStat` |
| `4cd0f79` | memos（GTS 优先 / 旧 API 兜底） |
| `c120b00` | ghost（object 形状，五段全声明） |
| `0b3487a` | neodb（增量合并 + 中文名沿用 + 跨源剥 Authorization） |
| `63c9654` | flux（一源两产物） |
| `f5c31a7` | intervals（升序 + 轨迹缓存） |
| `db38075` | map（`ctx.fileStat` 条件请求 + 临时目录隔离） |
| `0146e5b` | reading（可选源，保留 `syncReading` 导出） |
| `c2a2848` | rank（可选源） |
| `55f7c48` | 返工：ghost 请求断言改完整 URL + 排序后的 query 键值对（A 批复核「需改」闭环） |
| `86bb735` | 返工：rank 契约声明字段，上游错误载荷判不合格（B 批复核「需改」闭环） |
| `8a33c98` | 返工：B 批 3 个测试文件补显式类型，`astro check` 9 → 0 |
| `8a570a8` | 返工：`myRank` 允许 `null`（「本次无排名」是成功载荷） |

### 15.3 八类逐项状态

| 源 | 入口 | 契约 × 真实文件 | 冻结输入等价 | 独立复核 | 状态 |
| --- | --- | --- | --- | --- | --- |
| memos | `syncMemos` 兼容导出 | `memos.list` 2668 / 0 错误 | 深等（GTS 增量+去重+隐私、旧 API 兜底） | A 批 + 反证重跑 | 完成 |
| ghost | `syncGhost` 兼容导出 | `ghost.content` 863 / 0 错误 | 深等（五段 + 请求参数集） | A 批 + 返工复验 | 完成 |
| neodb | `syncNeodb` 兼容导出 | `neodb.marks` 1035 / 0 错误 | 深等（增量 102→100→101） | A 批 + 反证重跑 | 完成 |
| flux | `syncFlux` 兼容导出 | `flux.feed` 141 / `flux.lost` 9 / 0 错误 | 双产物各自深等（六分支） | B 批 + 反证重跑 | 完成 |
| intervals | `syncIntervals` 兼容导出 | `intervals.activities` 178 / 0 错误 | 深等（分年去重 + 缓存复用 + 升序） | B 批 | 完成 |
| map | `syncMap` 兼容导出 | `map.geojson` 127 / 0 错误 | 深等（编排层，假 python 验下载/304/临时目录/清理） | B 批 | 完成（真实 KMZ 转换未验） |
| reading | `syncReading`（`scripts/sync-reading.mjs` 仍导出） | `reading.digest` 54（books 18）/ 0 错误 | 除 `generatedAt` 外深等 | B 批 | 完成（可选源） |
| rank | `syncRank` 兼容导出 | `rank.status` 对现有文件**如实判不合格**（见 15.5） | 深等（上游 JSON 原样落地） | B 批 + 终轮 | 完成（可选源） |

框架：`SOURCES` 残余清空，10 个源（8 新 + emby + imagemeta）全部由 `registry.mjs` 驱动；`sync-data.mjs` 从 700+ 行降到约 250 行，旧 `sync*` 实现 0 个。

### 15.4 本轮我自己跑的命令与结果（不引用他人报告）

```
npx vitest run                      → 37 files / 580 passed           exit 0
npx astro check                      → 246 files, 0 errors, 0 warnings exit 0
node scripts/ci-local.mjs --offline  → 5/5 PASS                      exit 0
   类型检查 8.6s / 单元测试 6.4s / 构建 20.4s（2171 页）/ 隐私闸门 0.1s / 泄露闸门 0.1s
node scripts/check-public-data.mjs   → 非公开记录 0 条（memos PUBLIC 2668/2668）exit 0
11 个契约 × 真实文件                 → 10 ok / 0 错误；rank.status 如实判不合格
```

逐源 `--dry-run` 退出码（本轮实跑，未写盘：`src/data/*.json` mtime 仍是 15:27/17:39）：

| 源 | exit | 失败原因 |
| --- | --- | --- |
| memos | 1 | `The operation was aborted due to timeout`（公开兜底无需凭据，本机出站被拦；与迁移前同为 1） |
| ghost / neodb / flux / intervals / map | 1 | 缺少凭据（检查先于网络，文案比迁移前干净） |
| reading | 0 | 可选源告警，保留现有数据 |
| rank | 0 | 可选源：上游错误载荷 → 契约判不合格 → 告警 + 保留旧文件 |

### 15.5 rank 的两个真实问题（本轮由复核发现并修好，未改数据文件）

1. 库里 `src/data/rank.json` 内容是上游错误载荷 `{"success":false,"error":"Unexpected end of JSON input"}`（66B，`ce29a90` 旧管线写入，**非本轮引入**），原契约 `fields:{}` 放行一切 → 页面经 `Now.astro:14-17` 静默显示 0 小时。修法：`fields:{ myRank:'object|null?', error:'null?' }`，错误载荷判不合格、不覆盖旧文件。**坏文件一字未动**，等上游恢复后由同步覆盖，届时验收即可见。
2. `'object?'` 的 `?` 只豁免字段缺失、不豁免 `null`，故必须写 `'object|null?'`，否则 `{success:true,myRank:null}`（本次无排名，合理成功载荷）会被判不合格、rank 永久冻结。四条载荷我直接跑过：`myRank:null` ok、错误载荷 fail、正常载荷 ok、`{}` ok。

### 15.6 预览与产物版本对应

| 项 | 值 |
| --- | --- |
| 构建 | `dist/index.html` 425085B，mtime **21:49:42**（本轮 `ci-local` 重建） |
| 预览进程 | pid 58153，cwd = 本 worktree，`astro preview :4321`（常读磁盘） |
| `/` | 200 425085B resp=file=`1f0a7963` **SAME** |
| `/timeline/memo/` | 200 434553B resp=file=`9a0c11fb` **SAME** |
| `/timeline/reading/` | 200 428063B resp=file=`9040a106` **SAME** |
| `/now/` | 200 430884B resp=file=`e95c6ab4` **SAME** |

`/now/` 哈希与 18:30 那次不同，原因是页面内嵌构建时间戳；`src/` 零改动，故其余三页字节级不变。

### 15.7 已知行为变化（均已登记，非回归）

1. memos 旧 API 返回 0 条：原「静默保留旧文件 exit 0」→「显式失败 exit 1」。数据不丢，失败变可见。
2. memos 旧 API 兜底不走 `ctx.fetchJson`（要读 `X-Total-Count` 并保留旧翻页语义）：无凭据、有 20s 超时，无跨源泄头面；代价是注入的 `fetchImpl` 对它无效。
3. ghost 传输由 `@ts-ghost` 换成 `ctx.fetchJson`（为把 401/403 归 `auth`）：路径/query 参数集逐字保留、产物深等已证。
4. rank「无旧文件 + 上游失败」：产物从「写 null」变「不写」。当前文件已入库，仅在仓库缺该文件时触发；`Now.astro` 直接 import，缺文件会让构建报缺模块，故不删该文件。
5. rank 契约收紧后，现有 `src/data/rank.json` 会被判不合格 → rank 停止更新（仅该源，退出码不受影响）。这是期望行为，不是故障。

### 15.8 实际未验证项（不粉饰）

1. **真实上游同步全部未跑**（除 rank/reading 的只读 dry-run 本身）：Ghost / GTS / NeoDB / Intervals / Map 无凭据且本轮禁止真实同步。等价性是「冻结输入 + 真实文件重算」，不等于线上已验。
2. **map 的 KMZ→GeoJSON 转换本机跑不了**（无 python3）：golden 用假 python 验编排；真实 KMZ 与真实转换未验。
3. **reading 封面**仍在 `src/assets/reading-cover`（前端 `import.meta.glob` 消费），不在执行器原子写路径：失败时可能留孤儿封面（图有、JSON 未更新），页面按 key 取，无害且是既有行为。改它要动前端，不在授权内。
4. **翻页与增量提前停止**：ghost/neodb 仅单页 fixture；intervals 真实多窗口翻页未验；flux 真实 141 条全量重算未做（纯函数 `src/lib/flux-snapshot.ts` 一行未改）。
5. **CI 未运行**（仅本地等价）；Actions 未跑；480/1024 断点与触摸手势未测；局域网 4321 未映射（需主机侧加端口）。
6. `sensitive-headers.mjs:26` 注释称 `tokenization` 放行、实测判敏感（实现偏安全侧，注释多三个字）；`§4` 一处错别字「不中请」。零语义影响，登记不改，避免为注释再造一个未被复核的提交。

### 15.9 提交、回滚与报告路径

- 回滚：按源 `git revert <commit>` 即可，各提交只碰自己的模块 + `registry.mjs` + 自己那段 `sync-data.mjs`；框架 `3a24124` 需最后回滚。整轮回滚 `git reset --hard 630519c`（会丢本轮全部迁移，不推荐）。
- 合入前必须做：`git rebase origin/main`（唯一冲突面 `src/data/memos.json`）→ 再跑一次 `ci-local`（不带 `--offline`）+ 隐私闸门 → push。以上均待授权。
- 独立复核报告：`/data/workspace/bots/明鉴/reviews/2026-11-26-A-batch-0b3487a.md`、`...-B-batch-c2a2848.md`、`...-final-86bb735-rank-contract.md`、`...-final-8a570a8.md`。
- 终轮复核对 `8a570a8` 的结论：可收尾、0 阻塞；两条护栏各自有可回归的变异证明（`|null` 由 2 条测试钉住、`error:'null?'` 由 3 条钉住），恢复后 `ingest-rank` 12 passed、`astro check` 246 files / 0 errors。
- 主检出 `astro-book` 仍是 `128e6a9`，其 TMDB 相关 `ci.yml`/`sync-emby.mjs` 改动未触碰。
