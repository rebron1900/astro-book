# 独立复核（第二轮）：敏感头通用化 / 离线构建 / CI 本地等价

- 复核人：明鉴（代码审查与质量验证，独立于实现方）
- 复核对象：分支 `feat/data-modular-pilot` 提交 `2b2e2f5`（tree `…`，见 `git show --stat 2b2e2f5`）
- 复核时间：2026-11-26 18:00 前后
- 结论：**通过，0 阻塞**；1 条可选的正则收紧、4 条可选整理
- 本文件记录的是复核方报告 + 我方处置；复核方原话未改写结论

## A. 测试条数

```
npx vitest run tests/scripts/ingest.test.ts   Tests 38 passed (38)
npx vitest run                                Test Files 29 passed (29) / Tests 470 passed (470)
```

与实现方文档一致（vitest 4.1.12，Node 24.22.3）。

## B. 反向断言（规则是否真的在被测）

把 `sensitive-headers.mjs` 的 `SENSITIVE_PATTERN` 改成 `/NEVER_MATCH_xyz/` 后：

```
× ②跨域跳转后认证头全没了、非认证头还在
× ⑤跨域取图（fetchBinary）仍能正常返回字节，认证头同样不带过去
× 反向用例：未登记的新头（x-thirdparty-token）跨域跳转后也不带走
× 反向用例：x-api-key / x-session-id / x-client-secret 同样被剥
Test Files 1 failed / Tests 4 failed | 34 passed (38)
```

恢复后文件 sha256 与改前一致、`git diff` 为空、38 passed。→ 这 4 条确实钉在通用规则上，不是空转。

## C. 复核方自带用例（执行器真实跑跨源 302）

```
KEPT   X-Trace / X-Correlation-Id / X-Request-Id / If-None-Match / Accept-Language / X-Api-Version / X-Client-Id
STRIP  X-Author（旧正则下）/ X-Tokenizer（旧正则下）/ X-Session-Cache / X-Csrf-Token / X-Api-Key / Authorization
声明式 x-acme 跨源剥 = true；同源 x-trace、x-api-key 全部保留 = true
```

→ 既没有把普通头一起砍掉，也没有漏掉新命名的认证头。

## D. `ci-local.mjs --offline`

5 项在 Node 22.23.5 下全 PASS；并在 Node 22.20.0 上复现了一个非代码问题：

```
Node 22.20.0 → astro check / astro build FAIL：
"Node.js v22.20.0 is not supported by Astro! Please upgrade to: >=22.23.4"
Node 22.23.5 → 5/5 PASS
```

同时实证 `--import=data:text/javascript,…` 在 Node 22 上生效（含中文注释、子进程继承 `NODE_OPTIONS` 后仍拦截）。断网等价是真拦住了：9 个出站向量（fetch / net.connect / Socket.connect / https.get / tls.connect / http2.connect / dns.lookup / dns.promises.resolve / WebSocket）全部 `[net-blocked]`；去掉 `ASTRO_TELEMETRY_DISABLED` 会看到遥测请求被拦、构建仍成功，证明 preload 确实进了构建进程。

## E. 正则误伤

不误伤：`if-none-match`、`accept-language`、`x-request-id`、`x-api-version`、`x-trace`、`x-correlation-id`。
过度剥离（关键词当子串）：`x-author`、`x-tokenizer`；`x-auth-mode`、`x-session-cache`、`authorization-result` 等含真边界词的头仍会剥（无实际后果）。
漏网（设计如此）：无关键词的私有头、身份类头 —— 必须靠 `meta.sensitiveHeaders` 声明。

## 我方处置（复核后改动，均已重跑）

| # | 项 | 处置 |
| --- | --- | --- |
| 1 | 正则词边界 `(?:^|[-_])(…)(?=$|[-_])` | **采纳**。`x-author` / `x-tokenizer` 不再被剥；`x-api-key` / `x-auth-mode` / `x-session-cache` / `x-emby-token` 照旧剥。补 1 条回归用例；把边界退回旧正则时该用例正好失败 1 条（反向可复现），恢复后 39 passed |
| 2 | `--fast` 死分支 | **删除**（连带删掉只为它存在的 `existsSync` 导入） |
| 3 | `NODE_OPTIONS` 覆盖使用者设置 | **改为追加** |
| 4 | `executor.mjs` 未使用的 `BASE_SENSITIVE_HEADERS` 导入 | **删除** |
| 5 | `package.json` 加 `engines.node >=22.23.4` | **未改**：CI 的 `node-version: '22'` 取最新 22.x，不会踩；本机版本问题已写进 `docs/specs/2026-11-26-local-acceptance.md` §5。要改得顺带动 `package.json`，超出本轮范围 |

改后实测：`vitest` 29 files / **471 passed**；`ci-local --offline` 5/5 PASS；构建 2171 页、出站 0 次。

**未覆盖**：320/768 视口表（复核方无探针页与可控视口）、Emby 冻结对照的请求序列细节、`astro preview` 进程回执 —— 这三项由实现方证据承担，复核方未独立复跑。

**环境副作用（复核方自报）**：worktree 的 `node_modules` 是指向 `../../astro-book/node_modules` 的符号链接，`.gitignore:7` 的 `node_modules/`（带斜杠）不匹配符号链接，所以 `git status` 恒有一条 `?? node_modules`；`astro build` 会写共享的 `.astro/incremental-build.json`（ignore 内）。主检出源码未受影响。
