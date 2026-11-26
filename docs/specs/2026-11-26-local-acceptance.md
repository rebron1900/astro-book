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

**反向用例（证明这个洞是真实存在的）**：把通用模式改成永不命中后重跑，4 条用例失败（含旧的 `x-emby-token` 跨域用例与两条新用例）；恢复后 39 条全过。

**词边界收紧（独立复核后加的一条）**：初版把关键词当子串匹配，`x-author`、`x-tokenizer` 这类「只是含 auth/token」的头也被剥。现改为要求关键词两侧是头名边界（`(?:^|[-_])(…)(?=$|[-_])`），`x-author` / `x-tokenizer` 保留，`x-api-key` / `x-auth-mode` / `x-session-cache` / `x-emby-token` 照旧剥。新增 1 条回归用例，把边界退回旧正则时该用例**正好失败 1 条**（非空转）。

```
npx vitest run tests/scripts/ingest.test.ts     Tests 39 passed (39)
  新增 6 条：x-thirdparty-token / x-api-key / x-session-id / x-client-secret 跨域被剥；
             x-acme 靠声明被剥；同源保留；accept / accept-language / x-request-id 不误剥；
             x-author / x-tokenizer 不被误剥
```

## 3. 构建外链与离线构建

方法：用 `--import` 预加载一个「屏蔽一切出站网络」的模块（patch `fetch` / `net` / `dns` / `http(s)`，任何调用都记录并抛错），再跑完整构建。容器内 `unshare -n` 不被允许，因此这是断网等价验证，不是内核级隔离。

| 跑法 | 结果 | 出站尝试 |
| --- | --- | --- |
| 默认 | 2171 页，成功 | 1 次：`https://telemetry.astro.build/api/v1/record`（Astro 匿名统计，被拦后不影响构建） |
| `ASTRO_TELEMETRY_DISABLED=1` | 2171 页，成功 | **0 次** |

结论：构建对网络零依赖；唯一外呼是 Astro 遥测，建议 CI 与本地都设 `ASTRO_TELEMETRY_DISABLED=1`。

**页面运行期**仍引用外部主机（按出现次数）：`1900.live`、`cdn.1900.live`（图片/CDN）、`og.190102.xyz`、`chart.1900.live`（统计脚本，来自 Ghost code injection）、`s3.996288.xyz`、`social.1900.live`、`artalk.1900.live`（评论）、`memos.1900.live`。这些是浏览器侧请求，不是构建依赖；要让站点在断网环境完全可用需把图片/统计/评论本地化，属较大改造，本轮不做，只登记。

## 4. Emby 冻结输入新旧对照（无线上凭据）

**凭据现状（如实）**：本机无 `.env`，环境变量里没有 `EMBY_BASE_URL` / `EMBY_USER_ID` / `EMBY_API_KEY`，因此**无法做线上真实同步对照**。凭证只在 GitHub Actions Secrets（未 push，无法触发）。

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

结论：同等输入下新实现与旧实现行为一致；**线上真实数据未验证**，缺凭据，属外部阻塞。

## 5. CI 本地等价

新增 `scripts/ci-local.mjs`，按 `ci.yml` 构建侧闸门顺序执行：类型检查 → 单元测试 → 构建（可选断网等价）→ 隐私闸门 → 泄露闸门，逐项 PASS/FAIL 汇总，任一失败即退出 1。

```
node scripts/ci-local.mjs --offline
PASS  类型检查 astro check  (8.4s)
PASS  单元测试 vitest  (4.7s)   471 passed (471) / 29 files
PASS  构建 astro build（断网等价）  (19.8s)   2171 page(s)
PASS  隐私闸门 check-public-data  (0.1s)   memos 2668 条 PUBLIC=2668，非公开 0 条
PASS  泄露闸门 check-no-modu-db  (0.1s)
```

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
| 敏感头通用化 + 反向用例 | **完成**（39 条通过；去掉通用规则会挂 4 条；词边界回归用例可反向复现） |
| 独立复核（明鉴） | **完成**：A–E 全部实跑，0 阻塞；1 条正则收紧已采纳并补测，3 条整理已修（§9） |
| 离线构建验证 | **完成**（关闭遥测后出站 0 次） |
| Emby 新旧对照 | **部分完成**：冻结输入逐字节一致；线上真实同步**阻塞**（无凭据） |
| CI 本地等价 | **完成**（脚本 + 实跑）；Actions 本身未运行 |
| 剩余源迁移 | **未开始**（清单已给） |
| 推送 / 合并 / 上线 | **待授权**（本轮按指示不做） |

## 8. 安全回滚

- 本轮只新增两个文件（`sensitive-headers.mjs`、`ci-local.mjs`）并改执行器/emby meta/测试；回滚 = `git revert` 本轮提交，不涉及数据文件，不需要重跑取数。
- **恢复非公开随记不是发布回滚手段**：那 242 条是隐私过滤的结果，任何回滚都不得把它们带回 `src/data/memos.json` 或构建产物。
- 预览回滚：停进程即可（`npx astro preview stop`），不落任何持久状态；`dist/__probe.html` 是临时探针，不入库。

## 9. 独立复核结论与复核后改动

明鉴（独立质量角色）按 A–E 五项实跑复核：**通过，0 阻塞**。它自带用例验证了三件我没钉住的事：跨源 302 后 `x-trace` / `x-correlation-id` / `if-none-match` 保留、`x-acme` 靠声明被剥、同源全部保留；并实测「把通用规则关掉 → 4 条失败」。全文见 `docs/reviews/2026-11-26-independent-review-round2.md`。

复核后只做了 4 处小改（复核时提的可选项，不涉及结论）：

| # | 改动 | 文件 |
| --- | --- | --- |
| 1 | 关键词加词边界，消除 `x-author` / `x-tokenizer` 误剥；补 1 条回归用例（反向可复现） | `sensitive-headers.mjs`、`ingest.test.ts` |
| 2 | `--offline` 的 `NODE_OPTIONS` 改为追加而非覆盖，不再吞掉使用者自己的 `--max-old-space-size` | `ci-local.mjs` |
| 3 | 删掉不可达的 `--fast` 构建跳过分支与随之无用的 `existsSync` 导入 | `ci-local.mjs` |
| 4 | 删掉 `executor.mjs` 里未使用的 `BASE_SENSITIVE_HEADERS` 导入 | `executor.mjs` |

改后重跑：`vitest` 29 files / **471 passed**，`ci-local --offline` 5/5 PASS，构建 2171 页、出站 0 次。**这 4 处改动未经第二位复核人重看**，但它们都在明鉴给出的最小改法范围内，且各有测试或实跑兜住。

仍会漏（设计如此，非缺陷）：不含任何关键词又不申报的私有头（如 `x-overseerr-key`）、身份类 `x-ms-client-principal` / `x-forwarded-user` 不在剥离范围；接新源时用这类命名必须写进 `meta.sensitiveHeaders`。

环境副作用：worktree 的 `node_modules` 是指向主检出 `node_modules` 的符号链接（`.gitignore` 写的是 `node_modules/`，带斜杠不匹配符号链接），因此 `git status` 永远有一条 `?? node_modules`；`astro build` 会写共享的 `.astro` 增量缓存（在 ignore 内），源码不受影响。主检出未提交的 TMDB 改动（`ci.yml`、`sync-emby.mjs`）本轮一个字节未动。
