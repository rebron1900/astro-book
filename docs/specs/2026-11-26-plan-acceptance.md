# 里程碑与验收（本轮，2026-11-26）

主负责人：知行。实现：筑成。独立复核：明鉴。授权边界见文末。

## 0. 基线（已由知行完成）

- 工作树：`/data/workspace/bots/知行/worktrees/modular-2026-11-26`，分支 `feat/data-modular-pilot`，基线提交 `128e6a9`（= `main` = `origin/main`）。
- 主检出 `/data/workspace/bots/知行/astro-book` 保持不动：**未提交的 TMDB 改动（`scripts/sync-emby.mjs`、`.github/workflows/ci.yml`）原样保留，不提交、不 stash、不迁入本分支。**
- 本分支不 push、不合并、不改远端、不重写历史。
- 已看过：`AGENTS.md` 全文、`scripts/sync-data.mjs`、`scripts/sync-emby.mjs`、`src/api/store.ts`、时间线页面、既有测试。

## 1. 里程碑

| # | 内容 | 主责 | 完成标准（可检查） |
| --- | --- | --- | --- |
| M1 | **隐私发布过滤**（独立提交，可单独回滚） | 筑成 | 默认只发布 `visibility==='PUBLIC'`；`src/data/memos.json` 里非公开条目被清除（旧文件备份到仓库外）；`store` 读取处二次过滤；`scripts/check-public-data.mjs` 命中即非零退出；新增测试覆盖「非公开不进入 store/搜索/RSS」；`dist` 重新构建后不再命中非公开样本 |
| M2 | **数据接入模块层 + 试点**（Emby、imagemeta） | 筑成 | 按 `2026-11-26-data-ingest-spec.md`：`scripts/lib/ingest/{contracts,executor,registry,state}.mjs` + `scripts/lib/sources/{emby,imagemeta}.mjs`；`sync-data.mjs` 变薄（只编排）；CLI（单源/`--full`/`--dry-run`）、`optional` 语义、`runSources`/`classifyFailure` 导出与既有测试全部不变；新增来源只需加模块 + registry 一行 + 契约，不改 executor（实机演示） |
| M3 | **时间线按规范校验**（不做改版） | 筑成 | 对照 `2026-11-26-timeline-spec.md`：稳定全序排序、`source+id` 去重、同日不跨页、北京时区分日、计数口径单一来源；缺哪条补哪条 + 测试；**外观/URL 不变** |
| M4 | **独立复核** | 明鉴 | 亲自跑命令，给出「通过/阻断」逐项依据，含至少 3 个边界反例（缺凭据、分页不全、重复 ID）与隐私复测数字 |
| M5 | **交付文档与四态报告** | 知行 | 两份规范 + 隐私证据 + 本文件入 `docs/specs/`；报告写清已验证/未验证/回滚/待授权 |

顺序：M1 与 M2 无依赖，可并行；M2 必须先于 M3（时间线消费的 dataset 形状稳定后再校验）。M4 在 M1–M3 完成后一次性做。

## 2. 验收矩阵（必须实际跑，不用线上浮动数字）

| 场景 | 期望 | 覆盖在 |
| --- | --- | --- |
| 缺凭据（EMBY_* 全缺） | 可选源告警、旧 `emby.json` 不变、退出码不影响其它源 | 单测 + CLI |
| 401 / 403 | 分类 auth，不写盘 | 单测（stub fetch） |
| 429 / 503 / 超时 | 分类 upstream，整源放弃，旧数据保持 | 单测 |
| 分页不全（`complete:false`） | 不写盘 + 告警写明进度 | 单测 |
| 合法空结果（allowEmpty:false） | 保留旧文件 | 单测（沿用既有空数组保护） |
| 合法空结果（allowEmpty:true） | 写空 | 单测（flux-lost 语义不回退） |
| 重复 ID | 整源失败，报首个重复 id | 单测 |
| 契约版本不匹配 / 未知 dataset | 硬失败，不写盘 | 单测 |
| 多输出部分失败 | 两个文件都不写 | 单测 |
| 契约字段类型不符 | 整源失败并指出条目与字段 | 单测 |
| 幂等 | 同一输入连跑两次，第二次不写盘（无 diff） | CLI + 单测 |
| 输出语义不变 | 用冻结 fixture 跑新旧实现，比较排序/字段/封面路径 | 一次性对比脚本 + 记录 |
| 私密过滤 | PUBLIC 之外不进入 `src/data`、`dist`、search-data、rss | `check-public-data.mjs` + 单测 |
| 时间线跨日 | 北京时间 00:30 的记录归当天，不被拆卡 | 单测 + 浏览器 |
| 时间线渲染 | 筛选、分页/无限加载、链接、三档宽度 | 浏览器实测（构建后 dist） |

统一验证命令（每个里程碑都跑）：

```bash
yarn astro check
yarn test
yarn build          # 改样式/分块时先冷构建
node scripts/check-public-data.mjs
```

## 3. 冻结输入与对比口径

- 用 `fixtures/` 内的样本或从当前 `src/data/*.json` 复制出的**冻结副本**（放 `/tmp`，不进仓库）做新旧对比；不用线上实时条数。
- 旧测试 385 条与新测试条数不作硬指标；**只要求全绿 + 新增用例覆盖上表**。
- 任何需要真实网络/真实凭据的验证：能用脱敏 fixture 的用 fixture；不能的标「未验证」，不伪造。

## 4. 唯一写入者

- `docs/specs/` 三份文档：知行写，筑成不改。
- 代码、测试：筑成写；知行只做审阅与必要的小修（改前在提交说明里写清）。
- 明鉴只读 + 跑命令，不改代码（发现问题退回筑成）。

## 5. 授权边界（不变）

允许：本地代码、文档、测试、隔离分支准备。
不允许：push、上线、重写历史、删除既有数据文件、改生产凭据/权限、索取或打印密钥、任何有副作用的上游写请求。
外部取数缺授权时用脱敏 fixture 并标「未验证」。

## 6. 回滚

- M1 与 M2/M3 分成独立提交，可单独 `git revert`。
- M1 涉及删除 `src/data/memos.json` 里的非公开条目：删除前把原文件整份复制到 `/data/workspace/bots/知行/backups/memos-2026-11-26.json`（仓库外，权限 600），回滚即从备份恢复。
- 主检出的 TMDB 改动不受影响：本分支从未触碰那两个文件。
