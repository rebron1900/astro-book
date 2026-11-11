# Bot 团队接手 Handoff（含历史会话索引）

> 日期：2026-11-10
> 面向：AstroBook 后续开发（Bot 团队与后续 Agent）
> 项目目录：`/home/rebron1900/workspace/projects/active/astro-book`

## 先读什么

1. 根目录 [`AGENTS.md`](../../AGENTS.md)：开发与协作规则、命令、样式分层、客户端脚本约束。
2. [`docs/research/2026-11-09-intervals-activity-pipeline.md`](../research/2026-11-09-intervals-activity-pipeline.md)：运动数据源迁移到 intervals.icu 的完整设计与限制。
3. [`src/styles/README.md`](../../src/styles/README.md) 与 [`src/lib/client/README.md`](../../src/lib/client/README.md)：样式与客户端脚本分层说明。

## 当前仓库状态（2026-11-10 核对）

- 当前 HEAD：`12d68f3 feat: 浏览量/点赞改用 Artalk 统计`（2026-11-06）。
- 工作区有未提交改动：`54` 个修改、`15` 个删除、`27` 个新增（含本文件；合计约 3,700 行新增、11,400 行删除），主要是 11-09 的 intervals.icu 运动数据迁移和 CSS/JS 结构整理。接手后先和用户确认这些改动是否要提交，不要直接覆盖或回滚。
- 包管理器固定 Yarn 1.22，Node 22；提交前至少跑 `yarn astro check`、`yarn test`、`yarn build`。

## 历史会话索引（传统模式，共 21 个）

这些会话都保存在 DSH 的项目工作区（cwd = 项目目录），没有丢。Bot 团队的工作文件夹设到项目目录后，可以直接用 `session_search` 按关键词检索；不设工作文件夹时，可以让 Chief 代为检索或直接读本索引。

| 日期 | 标题 | Session ID |
|---|---|---|
| 2026-08-20 | 先阅读一下全库代码 | `f86c94d1-4a21-4b7a-bdf7-8ad0a849778f` |
| 2026-08-20 | 中文问候交流 | `ce1412b2-29db-4195-8c4d-0139e31194d7` |
| 2026-10-27 | 基于 Astro 的博客项目 | `dc1494cc-a0b3-4448-ad9a-202b243729f7` |
| 2026-10-27 | 你好与拉起服务 | `407631c4-5ac0-4ce5-86de-c63b7abd1cac` |
| 2026-10-29 | 友邻页时间线卡片设计优化 | `749ecc92-92e9-49e3-b95f-d3e14162fa9c` |
| 2026-11-03 | 时间线样式统一与显示问题修复 | `d53f4cda-ce9d-4866-8fb5-c2c7d143ccaa` |
| 2026-11-03 | 运动页面时间线与地图布局 | `99269923-c8ca-4ebe-8cbb-c72ae0881019` |
| 2026-11-03 | Side: New thread（空会话） | `65c1f5d0-9d0e-4749-a312-588b48edcd64` |
| 2026-11-03 | 前端子任务：exercise-map | `f04cbd36-ed6e-4309-a407-8fa3efadec38` |
| 2026-11-03 | 前端子任务：ExerciseStats | `697663db-f53b-414b-8aae-2d6aee12cd07` |
| 2026-11-04 | 运动卡片与时间线细节修复（续） | `2b46101f-cbc6-40c9-b41b-76513b0ab594` |
| 2026-11-04 | 运动页面 UI 细节优化修复 | `1dbae122-3923-449c-a926-1b71a25acf18` |
| 2026-11-04 | 博客首页布局与导航样式优化 | `e0518a7d-f14b-42ce-b03b-96fa2eba18c7` |
| 2026-11-06 | Artalk 浏览量/点赞切换 | `cb9d52c6-302b-48d5-a303-a98f803816e0` |
| 2026-11-09 | 运动页面 UI 与 CSS 优化（含足迹页） | `4a992f54-665e-4728-8890-6bc0308995d4` |
| 2026-11-09 | Astro 7 JavaScript architecture audit | `f6a246e4-4bab-4709-b84c-5bc98fa2e265` |
| 2026-11-09 | Strava 导出补数据 + intervals.icu 迁移总控 | `26b1ec5a-6835-48ef-ab1a-8088d99e6a85` |
| 2026-11-09 | 侧栏 View Transition 与背景闪烁修复 | `f4e5c441-943b-4b47-8c16-74f9b6c4d971` |
| 2026-11-09 | Strava 活动导入 intervals.icu 脚本（子任务） | `72e09abc-7513-4744-b4a6-27ad5791f9c9` |
| 2026-11-09 | intervals.icu 全量同步管道改造（子任务） | `4072eb9f-5652-4327-a6f7-152f16490894` |
| 2026-11-09 | 复核运动数据源迁移 intervals.icu（子任务） | `c17d849d-5961-4c58-93f3-1c5cd886b773` |

## 近期工作脉络

- 8 月：全库通读、早期整理。
- 10 月底到 11 月初：首页时间线、友邻页、书影音游、归档页的卡片与时间线样式重构；运动页和预览地图迭代；Artalk 统计切换。
- 11 月 9 日：运动数据从「Strava 缓存 + intervals.icu 混合」收敛为 intervals.icu 单一来源；补齐 Strava 导出中缺失的 12 条活动（166 → 178 条）；同步管道与 GitHub Action 改造完成，独立复核 0 阻塞项。相关结论见 `docs/research/2026-11-09-intervals-activity-pipeline.md`。
- 当前待确认：intervals 迁移和 CSS/JS 结构整理仍在工作区未提交，需先确认是否提交/推送，再开始新需求。

## 足迹（/exercise/#footprint）数据口径与待办

- 数据来自外部同步的 `src/data/ghost.json`（2026-11-10 口径）：**34 篇游记、48 个有游记的标点、118 个标点、整篇未命中 5 篇**。页头副标题由构建期数据算出，不要在代码里写死这些数字。
- 待办：有 **8 个地点写过游记但地图上没有标点**（太原、天台山、平乐古镇、三星堆、蓥华山、西岭雪山、花水湾、牛背山）。按用户口径**不加界面提示**；正确做法是去 Google Maps 补这 8 个点、重新导出 geojson，数据补全后缺口自然消失。

## Bot 团队协作约定

- Chief 拆解需求 → 阿码实现并自验 → 阿审独立复核 → Chief 汇总给用户。
- 代码只进文件，不在群里贴大段 diff；汇报先结论后细节。
- 历史会话是只读参考，不要凭记忆猜数据口径或旧决策，必要时先 `session_search`。
