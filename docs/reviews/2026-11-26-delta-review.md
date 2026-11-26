# 增量独立复核：327c181 / 1635b43 / c773f5b / 3354d0f

- 复核人：明鉴（独立验证方，只读；未改代码、未 commit、未 push、未合并）
- 时间：2026-11-26 17:06–17:40（Asia/Shanghai）
- 对象：`/data/workspace/bots/知行/worktrees/modular-2026-11-26`，分支 `feat/data-modular-pilot`，HEAD `3354d0f`（tree `ed3aca2`），上一轮复核基线 `b7f5075`
- 工作树状态：`git status --porcelain` 仅 `?? node_modules`；主检出 `astro-book` 仍 `128e6a9`，两个 TMDB 未提交改动未触碰
- 环境：Node v24.22.3 / yarn 1.22.22；本地沙箱（非 CI），真实 Chrome 可用

## 0. 总体结论

**通过。阻断 0 项。** 4 个提交全部独立实测通过：跨域重定向剥头在真实双端口服务上 32/32 成立且有反证；CI 闸门位置正确、diff 只加一步、失败确实非零；缺 id 指纹解决了 2→1 退化，真实数据构建 2171 页且 URL 集合与 `b7f5075` 完全一致；`3354d0f` 只新增 4 个 docs 文件、0 删除。

需要知情但不阻断的 3 件事（§3）：认证头剥离是**固定名单**（只 4 个头名）；A→B→A 回到原源不恢复认证头；三份规范里有 5 处与实现不一致（含 1 处自相矛盾），属文档待修。

另**更正我上一轮的一处说法**：上一轮我写「构建路径无网络调用」，不准确。`src/components/shortcode/OGCard.astro:87` 在 frontmatter 里 `await fetch(url)` 抓 OpenGraph，属构建期网络依赖（本轮复核中因此复现了 10 个 `/now/` 页的差异）。该行为与本次 4 个提交无关，但「离线构建」这个说法本轮不再沿用。

## 1. 逐项结果

| 提交 | 项 | 结论 | 我实际执行的命令 | 关键输出 |
| --- | --- | --- | --- | --- |
| 327c181 | 跨域重定向不带走认证头 | 通过 | 自建 127.0.0.1:4801/4802 双源真实 HTTP 服务 + `runIngestSource` 注入临时来源（32 例） | `pass=32 fail=0`；反证（删掉剥头那行）`pass=21 fail=9`，四个认证头全部原样出现在 B 源 |
| 327c181 | 跳数上限 / 相对 Location / 303 语义 / fetchBinary | 通过 | 同上 | 5 次跳转成功、第 6 次 `code=upstream`；`../echo` 落 `/echo`、`./echo` 落 `/r/echo`；303→GET 丢 body、307 保留 POST+body；跨源取图拿到字节且 B 端无 token |
| 1635b43 | 隐私闸门进 CI | 通过（Actions 实跑未验证） | js-yaml 解析 + 逐步打印 + `git show 1635b43^..1635b43` + `MEMOS_PUBLISH_VISIBILITIES=unlisted` 跑闸门 | 19 步中 gate 是第 16 步（0 起算 #15），build 是第 15 步（#14）、deploy 是第 19 步（#18），gate 无 `if`；diff 仅 ci.yml 加 4 行；反白名单 `EXIT=1` |
| c773f5b | 缺 id 键退化 | 通过 | 自写 8 例 vitest（不跑其测试）+ 反证 | `8/8`；两条无 id 不同内容 → 2 条；顺序无关、重跑一致；碰撞只留 1 条且 warn 不含正文；有 id 键仍 `memos:<id>` |
| c773f5b | 超时文案 | 通过 | 400ms 超时实测 + 读 `formatTimeout` | `collect 超时（400ms）`（旧为 `0s`）；≥1s 仍显示秒 |
| c773f5b | 真实数据与构建 | 通过 | 导入 store + `yarn build` | 4950 事件、0 条使用指纹键、0 重复键；2171 页；URL 集合与 b7f5075 完全相同 |
| 3354d0f | 只新增文档 | 通过 | `git show --numstat/--name-only`、md5 比对 | 4 个文件全 `A`、0 删除、全在 `docs/`；我上一轮的复核文档 md5 未变（`90308d6a…`） |

## 2. 依据（真实输出）

### 2.1 HEAD 门禁复跑

```
$ yarn astro check
Result (228 files):  - 0 errors  - 0 warnings  - 63 hints      Done in 8.22s

$ npx vitest run
Test Files  29 passed (29)
     Tests  465 passed (465)          # 上一轮 454，+11（本轮 5 重定向 + 6 指纹/文案）

$ rm -rf dist && yarn build
[build] 2171 page(s) built in 19.21s

$ 与 b7f5075 构建产物比对 URL 集合
b7f5075 urls 2172 | HEAD urls 2172 | only-old 0 | only-new 0 | 集合完全一致: true

$ md5
47df15f1a3a922a1b50e7a88c18b6fdb  src/data/emby.json
3b0eba06dec91addf1243de35600dc43  src/data/image-meta.json      # 与 128e6a9 / b7f5075 相同

$ node scripts/check-public-data.mjs                                  → EXIT=0（2668 条全 PUBLIC，非公开 0）
$ node scripts/check-public-data.mjs --features-from …/memos-2026-11-26.json → EXIT=0（2910/242/特征 210，2238 文件命中 0）
$ MEMOS_PUBLISH_VISIBILITIES=unlisted node scripts/check-public-data.mjs     → EXIT=1（非公开 2668，dist 命中 1081 文件）
   （用完确认 `env | grep -c MEMOS_PUBLISH_VISIBILITIES` = 0，未留环境变量）
```

### 2.2 327c181 跨域剥头（自建证据，不用其测试）

两个真实 HTTP 服务（`127.0.0.1:4801` 与 `:4802`，端口不同即不同源），来源模块只负责按计划发请求，执行器用真实 `fetch`：

```
PASS 1  同源跳转保留 x-emby-token / accept
PASS 2  跨源剥 x-emby-token / authorization / cookie / proxy-authorization；保留 accept、x-custom；确实落到 B
PASS 3  相对 Location ../echo → 同源 /echo 且保留 token
PASS 3b 相对 Location ./echo 按目录解析（服务端请求日志里实际出现 "A GET /r/echo"）
PASS 4  协议相对 //127.0.0.1:4802/echo 视为跨源，token 被剥
PASS 5  恰好 5 次跳转仍成功
PASS 5b 第 6 次跳转 code=upstream「重定向超过 5 跳（…/r/chain0）」，不再跟
PASS 6  自环（302 指向自己）5 跳后报错，不无限
PASS 7  303 + POST → GET、body 丢、content-type 被清
PASS 7c 302 + POST → GET         PASS 7d 307 + POST → 保留 POST 与 body
PASS 8  Headers 实例（同源保留 / 跨源剥净）
PASS 8c 大写键名（AUTHORIZATION / X-EMBY-TOKEN）跨源同样剥净
PASS 8d 二维数组形态跨源剥净
PASS 9  同源取图拿到字节；9b 跨源取图仍拿到字节；9c B 端服务日志里没有 x-emby-token
PASS 10b A→A→B：只在跨源那一跳剥（B 端无 token）
PASS 11 非跳转 200 原样返回       PASS 12 302 无 Location 不崩（按 HTTP 302 失败）
PASS 13 headerPairs 三种形态       PASS 13b AUTH_HEADERS = [authorization, cookie, proxy-authorization, x-emby-token]

合计 pass=32 fail=0
```

绕过探针（**这两条是记录行为，不是失败**）：

```
BYPASS x-auth-token 跨源仍带走: flux-like | x-api-key: apikey-like
ABA  A→B→A 回到 A 时 x-emby-token = undefined（不恢复）
```

结论细节：

- 「中途替换 `options.headers`」这条绕过**结构上不存在**：`headerPairs` 在进入循环前一次性快照，之后只操作本地 `[name, value][]`；实测调用方之后换对象不影响已发出的请求。
- 真正的边界是**头名固定名单**：`scripts/lib/ingest/executor.mjs:35` 只列 4 个名字，`X-Auth-Token`、`X-Api-Key` 之类跨源仍会带过去。当前登记的源只有 emby 用自定义认证头（`X-Emby-Token`，在名单内），flux/neodb/gts 走旧 `sync-data.mjs`（`Authorization`/`X-Auth-Token`，不在执行器路径上），**所以现在没有实际泄漏**；但下一个用 `X-Auth-Token` 的源接进执行器就会踩到。
- A→B→A 不恢复认证头：更安全，但若将来 Emby 走跨域 SSO 往返会拿不到 token。属产品取舍，建议写进规范的已知行为。

### 2.3 1635b43 CI 闸门

```
YAML 解析 OK, jobs: [ 'build' ]，共 19 步（下列序号从 0 起算）
14 Build Astro project                       if=-
15 Check public data (privacy gate)          if=-          run: node scripts/check-public-data.mjs
16 Guard against leaked modureader database  if=-
18 Deploy to VPS                             if=github.ref == 'refs/heads/main'
build<gate: true | gate<deploy: true | gate 的 if 条件: undefined（不是 always()）
```

与父提交逐行 diff：只新增 4 行（注释 + name + run + 空行），`git show --name-only 1635b43` 只有 `.github/workflows/ci.yml`。闸门失败确实非零：反白名单 `EXIT=1`（§2.1）。**GitHub Actions 实跑未验证**（不允许 push，见 §6）。

### 2.4 c773f5b 缺 id 键与超时文案

我自己的 8 条（在 HEAD 的 `/tmp` 副本里跑，未用其测试文件）：

```
T1 条数=2 keys=["memos:~e97bd966","memos:~ea798b29"]        # 旧实现为 1 条 "memos:"
T2 顺序无关=true 重跑一致=true
T3 内容相同、时间不同 → 2 条
T4 内容与时间都相同 → 1 条，warn=1，泄漏正文=false
   warn 原文 = ["[timeline] memo 记录缺少 id 且指纹相同（内容与时间一致），只保留一条：memos:~1de1c47a"]
T5 有 id → key=memos:01ABC，isFingerprintId=false
T6 post 无 id 无 slug → 2 条，键 ghost.posts:~08550af3 / ~67ab24b7（不再共用空键）
T7 16000 个 UTF-16 字符（中文+emoji）→ ~e5e19492，稳定
T8 真实数据里以 "~" 开头的真实 id = 0（不会与指纹撞前缀）
```

真实数据侧（导入 store）：`真实数据使用指纹键的条目数=0 / 总事件 4950`、`重复键=0`、`visible=3915` → 本轮改动只影响兜底分支，**构建产物不可能因它变化**；实测 `_astro` 资源总量与 b7f5075 相同（2 710 614 字节），`timeline.ts` 未被客户端脚本引用，进不了浏览器包。

超时文案：`formatTimeout(400)` → `collect 超时（400ms）`（实测 401ms 返回，`code=upstream`，旧数据保留）。

### 2.5 3354d0f 文档提交

```
docs/reviews/2026-11-26-independent-review.md   288  0   (A)
docs/specs/2026-11-26-data-ingest-spec.md       146  0   (A)
docs/specs/2026-11-26-plan-acceptance.md         75  0   (A)
docs/specs/2026-11-26-timeline-spec.md           91  0   (A)
→ 4 个文件全部新增、0 删除、全部在 docs/ 下，无代码/数据文件
```

我上一轮写的复核文档在两个位置的 md5 一致（`90308d6a3b55ab5e281f346011309e32`），**没有被改组**。`git diff --stat b7f5075..HEAD -- src/data/ public/` 为空，数据文件未被这 4 个提交改动。

### 2.6 构建产物语义（为何只有 10 个 /now/ 页不同）

在 `/tmp/b7` 用 `git archive b7f5075` 独立重建（2171 页）后逐文件比对：文件集合完全相同（2312 个），但 2168 个文件字节不同 —— 归一化掉 Astro 每次构建随机生成的 `astro-island uid="…"` 后：

```
归一化后语义不同的文件数: 10，全部是 /now/*/index.html
例：now/14 差异为 og-card 区块（PR 卡片的图片/描述），不是时间线内容
原因：src/components/shortcode/OGCard.astro:87 在构建期 await fetch(外链) 抓 OpenGraph；
      /tmp/b7 没有缓存（cache/og-cache.json 在 .gitignore 里）→ 重新抓取，个别失败/成功不同
      （/tmp/b7 构建耗时 5m16s vs 工作树 19s，正是这些外链抓取）
```

结论：`/timeline/*`、首页、`search-data.json`、`rss.xml` **逐字节语义一致**；差异只出现在构建期外链 OG 卡片，与本轮 4 个提交无关。

## 3. 我自己构造的反证（不跑其测试）

| 反证 | 做法 | 结果 |
| --- | --- | --- |
| 剥头失效 | `/tmp` 副本删掉 `if (originOf(nextUrl) !== originOf(currentUrl)) headers = withoutAuthHeaders(headers);` | 我的 32 例里 **9 例变红**：四个认证头原样出现在 B 源（`x-emby-token:k2, authorization:Bearer zz, cookie:c=1, proxy-authorization:Basic yy`），Headers 实例/大写键/数组三种形态也全部红 |
| 指纹退回空串 | `/tmp` 副本把 `return id === '' ? timelineFingerprint(entry) : id;` 改回 `return id;` | 我的 8 例里 **3 例变红**：`T1 条数=1 keys=["memos:"]`、`T3 条数=1`、`T6 条数=1 keys=["ghost.posts:"]` —— 正是被修的 2→1 退化 |
| 闸门失效 | `MEMOS_PUBLISH_VISIBILITIES=unlisted` 跑 `check-public-data.mjs` | `EXIT=1`，报「data 文件里仍有非公开记录」+ dist 命中 1081 文件 |

## 4. 规范与实现一致性抽查

### 4.1 文档写了、代码也确实做到的（7 条实测）

| 规范论断 | 出处 | 实测 |
| --- | --- | --- |
| 契约版本不一致 → 配置错误，硬失败 | data-ingest §3（:79） | `S1` 版本 v2 对 v1 → `code=contract`，不写盘 |
| 只注入 `meta.credentials` 声明的键 | §5（:105） | `S2` 传入 4 个 env，`ctx.env` 只有 `["SPEC_OPT","SPEC_TOKEN"]` |
| 游标只在写盘成功后推进 | §4（:100） | `S3` 失败后 `.cache/sync-state.json` 不存在；成功后才有 `lastSuccessAt` |
| 临时文件 + `renameSync` 原子替换 | §7.5（:127） | `S4` 内容变化时 inode 改变、无 `.tmp` 残留、新内容完整 |
| 附属产物只允许 `public/<声明目录>/`，禁穿越 | §6（:116） | `S5` 未声明目录 → `code=artifact`；`spec-assets/../../evil.jpg` → 拒绝 |
| 幂等：同输入第二次不写盘 | plan-acceptance §2 | `S6` `changed=0` 且 md5 不变 |
| 同日不跨页 / 北京日键 | timeline §3.3–3.4 | 上一轮 + 本轮构建：`同天跨页=0`；北京 00:09 条目落 07.15 |

### 4.2 文档与实现不一致（不阻断，建议修文档或补代码）

| # | 文档 | 实现 | 建议 |
| --- | --- | --- | --- |
| D1 | timeline §3.8（:54）「`time > now+5min` 丢弃**并计数告警**」 | `src/lib/timeline.ts:162` 只 `filter`，无计数、无告警 | 要么补计数/告警，要么把文档改成「静默丢弃」（当前真实数据 0 条，无实际影响） |
| D2 | timeline §4（:60）「页头 = **事件数**（不是卡片数）；**聚合卡算 1 条**」 | 同一句自相矛盾；实现按事件数：`/timeline/reading/` 页头 `共 206 条`，而全部 17 页只有 83 个 `.ledger-row`（其中 31 处是 Emby 组卡） | 删掉「聚合卡算 1 条」，或明确「聚合只在渲染层，计数按事件」 |
| D3 | data-ingest §4（:100）「`state` 里的 `cursor/lastSuccessAt/etag`」 | `scripts/lib/ingest/state.mjs` 只有 `lastSuccessAt` + `lastRun` 条数，没有 `cursor`/`etag` 字段 | 文档去掉未实现的字段，或在后续做增量游标时再加 |
| D4 | data-ingest §5（:109）「`redirect: 'follow'` 时若跨域跳转…」 | 实现已改 `redirect: 'manual'` 自跟随（327c181） | 文档同步成 manual，并写清「跨域后回到原源不恢复认证头」 |
| D5 | plan-acceptance §2「三档宽度 320/768/1440」 | 我只验了 375 与 1440（本轮未重跑渲染，构建产物与上一轮一致） | 320/768 标「未验证」或补测 |

## 5. 与自述对照

筑成 3 个提交说明里的数字**逐条复现，无矛盾**：`astro check 0 error` ✅、`465 tests` ✅（+11）、`2171 页` ✅、URL 集合一致 ✅、`check-public-data` 两模式 `EXIT=0`、反白名单 `EXIT=1` ✅、`emby.json`/`image-meta.json` md5 未变 ✅、「去掉剥头那行测试变红」✅（我用自建 32 例独立复现，9 红而不是他说的 2 红，因为我的用例覆盖更多头形态）、「指纹退回空串 3 条红」✅、「超时文案 400ms」✅。

唯一需要提醒的口径：他写「第 6 跳失败」，我实测是「允许跟随 5 次跳转，第 6 次收到重定向时失败」——语义一致，但表述上「第 6 跳」容易被理解成「第 6 个请求」，建议文档里写成「最多跟随 5 次重定向」。

## 6. 未验证 / 限制（如实标记）

- **GitHub Actions 实跑未验证**：不允许 push，只在本地解析 YAML、校验步骤顺序与 diff、并本地复现闸门失败非零退出。runner 上的 `node` 版本、Secrets 注入、`set -e` 传播未在真实 runner 观察。
- **真实上游未打请求**：重定向用本地双端口服务与真实 `fetch` 验证，未对真实 Emby/NeoDB/Miniflux 发请求（无凭据；也没有 push）。
- **320 / 768 两档宽度未验**（D5）；本轮未重跑浏览器渲染，依据是构建产物与上一轮语义一致（§2.6）。
- **构建非确定性**：`/now/` 的 OG 卡片依赖构建期外链抓取与本地 `cache/og-cache.json`，两次构建不保证字节相同（与本次提交无关，但「离线构建」的说法不成立）。
- **跨域 SSO 往返未测真实场景**（只测了 A→B→A 的头行为）。
- 改动的**提交信息与实现**我一并核对过；`c773f5b` 同时改了 `executor.mjs` 与 `timeline.ts` 两个无关主题（超时文案 + 指纹），功能无问题，但按仓库其它提交的习惯本可拆两个提交（仅流程建议）。

## 7. 最小修复方向（均非阻断）

1. `scripts/lib/ingest/executor.mjs:35`：把认证头从固定名单改为「来源声明 + 正则兜底」，例如 `meta.authHeaders` + 默认剥 `/^(authorization|cookie|proxy-authorization)$|token|api-?key|secret/i`；否则下一个用 `X-Auth-Token` 的源接进执行器时跨源会带出去。
2. `src/lib/timeline.ts:162`：要么在丢弃未来事件时 `console.warn` 并计数（规范 D1 的要求），要么改规范。
3. `docs/specs/2026-11-26-data-ingest-spec.md:100,109` 与 `docs/specs/2026-11-26-timeline-spec.md:54,60`：按 §4.2 的 D1–D4 对齐措辞。
4. 文档里把「第 6 跳」改成「最多跟随 5 次重定向」。

## 8. 复现方式

- 门禁：在 worktree 依次 `yarn astro check`、`npx vitest run`、`rm -rf dist && yarn build`、`node scripts/check-public-data.mjs`（含 `--features-from` 与反白名单）
- 跨域剥头：`/tmp/redir/{servers.mjs,src.mjs,run.mjs}`（双端口真实服务 + 注入 registry/contracts），`node /tmp/redir/run.mjs`；反证把 `executor.mjs` 的剥头行注释掉后重跑
- 指纹：`/tmp/delta`（HEAD 副本）内 `tests/lib/mj-fingerprint.test.ts`，反证把 `timelineFingerprint` 兜底改回 `return id;`
- 规范断言：`/tmp/spec/{src.mjs,run.mjs}`（契约版本、凭据注入、游标、原子写、附属产物、幂等）
- 产物对比：`git archive b7f5075 | tar -x -C /tmp/b7` 后 `yarn build`，按 §2.6 归一化 `astro-island uid` 再比 md5
