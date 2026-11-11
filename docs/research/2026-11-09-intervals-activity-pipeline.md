# 运动数据源迁移：从「Strava 缓存 + intervals.icu 混合」到 intervals.icu 单一来源

> **日期:** 2026-11-09 · **项目:** astro-book（Astro 7.2.0）
> **问题:** 站点运动页/首页运动卡片原先读的是「旧 Strava 缓存基线 `strava-history.json` + intervals.icu 增量活动」的合并结果。Strava 数据早已停止更新，基线里 2024~2026 的历史记录只能靠缓存维持；需要改成**直接从 intervals.icu 全量拉取**，并把 Strava 导出里 intervals.icu 缺的活动补传上去，再把同步逻辑与 GitHub Action 流程收敛。

## 结论摘要

- **数据源单一化：** `scripts/sync-data.mjs` 的 `intervals` 源现在只读 intervals.icu，按自然年窗口全量拉取，映射成 `Activity` 契约后写入 **`src/data/activities.json`**（原 `src/data/strava.json` 已删除）。旧缓存基线 **`src/data/strava-history.json` 已删除**，同步脚本不再做「历史 + 增量」合并去重。
- **缺失数据已补齐：** 用一次性工具 `scripts/import-strava-export.mjs` 把 Strava 导出里缺失的 **12 条**活动补传进 intervals.icu（166 → 178 条）。之后全量同步自然包含它们，站点不再依赖 Strava 缓存。
- **轨迹走增量缓存：** 活动列表每次都全量拉（很便宜，1 年 1 次请求），但**地图轨迹**只在上一版 `activities.json` 里没有该活动轨迹时才请求 `/activity/{id}/map`，避免每 3 小时重拉上百条折线。首轮全量约 150 次地图请求（149 条出轨迹 + 1 条上游无 GPS）、约 22 秒；之后增量同步约 6 秒。
- **构建仍完全离线：** 和原来一样走「外部数据 → 本地 JSON → 构建读取」的方案 B，CI 里 `yarn build` 不访问 intervals.icu。

## 数据契约（`src/lib/activity-types.ts`）

`src/data/activities.json` 是 `Activity[]`，按 `start_date_local` 升序：

| 字段                | 类型           | 说明                                                                               |
| ------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `id`                | string         | intervals.icu 活动 ID，原样保留，形如 `i204300274`（**不要**再加 `i` 前缀）        |
| `name`              | string         | 活动名称；空则回退「运动记录」                                                     |
| `distance`          | number         | 距离（米，取整）                                                                   |
| `moving_time`       | number         | 移动时长（**秒**，不是字符串）                                                     |
| `type`              | string         | intervals 类型：Run / Ride / Walk / Hike / RockClimbing / StairStepper / Workout … |
| `start_date`        | string         | UTC ISO 带 `Z`，如 `2026-10-11T08:06:19Z`                                          |
| `start_date_local`  | string         | 本地墙上时间 `YYYY-MM-DD HH:mm:ss`                                                 |
| `average_heartrate` | number \| null | 平均心率                                                                           |
| `average_speed`     | number \| null | 平均速度（m/s）                                                                    |
| `elevation_gain`    | number         | 累计爬升（米）                                                                     |
| `polyline`          | string?        | 编码轨迹（Google polyline，lat/lng，精度 1e-5）；仅距离 > 0 且上游有 GPS 的活动    |
| `url`               | string?        | `https://intervals.icu/activities/{id}`                                            |
| `source`            | string?        | intervals 的 source：`ZEPP` / `UPLOAD` …                                           |

映射纯函数在 `src/lib/intervals.ts`：`toActivity`、`toUtcIso`、`encodePolyline`、`sampleRoute`、`parseMapPoints`、`polylineFromMap`、`applyRouteCache`、`pendingRouteIds`、`yearWindows`、`sortActivities`，均有无网络单测（`tests/lib/intervals.test.ts`）。

> 注意：原来的 `location_country` 字段没有了（intervals.icu 不提供城市/地址）。地图隐私过滤改为**只按轨迹范围**判断（`src/lib/client/exercise-map.ts` 的 `shouldUsePrivacy`），自贡市等隐私城市用 `PRIVACY_CITIES` 的 bounds 命中。

## 一次性导入：Strava 导出 → intervals.icu

Strava 导出的「请求你的存档」解压后是 `activities.csv` + `activities/<编号>.fit.gz|.tcx.gz`。脚本：

```bash
# 只看差异，不上传
node scripts/import-strava-export.mjs /path/to/export --dry-run --expect-missing=12

# 真正上传缺失活动，并自动回查校验
node scripts/import-strava-export.mjs /path/to/export --expect-missing=12
# 或：yarn import:strava-export /path/to/export
```

匹配与防重规则：

- 以 **UTC 开始时间**（导出 CSV 的「活动日期」是 UTC）在 ±5 分钟内对齐，并要求「运动家族」一致（Run/Ride/Walk/Hike/Climb/Other，中文类型映射见脚本 `CSV_TYPE_MAP`）。
- 只上传 `missing` 集合；`ambiguous`（同窗口多条无法唯一定位）直接拒绝上传（退出码 2）。
- 用 `external_id=strava:<活动ID>` 做幂等标记：重复执行时已存在的会跳过，不会产生重复记录。**intervals 的文件 hash 去重不可依赖**——Strava 导出文件与 Zepp 上传的文件内容不同，hash 必然不同。
- 上传后重新拉列表，核对时间差、距离、类型，并打印核对表。退出码：0 成功 / 1 用法配置 / 2 门禁失败 / 3 上传失败 / 4 校验失败。

本次导入的 12 条（全部 HTTP 201）：10 条 2024-03 的跑步（intervals 最早活动是 2025-01，之前的都没同步过）+ 2025-01-22 一条 0 距离 Run + 2025-05-17 一条攀岩。

## 同步流程（`scripts/sync-data.mjs` 的 `intervals` 源）

1. 按自然年窗口（`INTERVALS_FIRST_YEAR = 2015` → 当前年）调用
   `GET /api/v1/athlete/{athleteId}/activities?oldest=&newest=&limit=500&fields=...`，按 `id` 去重合并；日志会打印每年条数与去重后条数，方便排查「静默丢活动」。
2. 用上一版 `src/data/activities.json` 建 `id → polyline` 缓存；只有「距离 > 0 且没有轨迹」的活动才请求 `/api/v1/activity/{id}/map`，并发 5，单条失败只 `warn`。距离为 0 的活动（爬楼、器械等）永远不请求地图。
3. `--full` / `SYNC_FULL=1`：忽略轨迹缓存、全部重拉（每周全量校正用）。
4. 输出按 `start_date_local` 升序的 `Activity[]`；空结果会抛错、拒绝用空数组覆盖线上数据。

日常命令：

```bash
node scripts/sync-data.mjs intervals          # 全量活动 + 增量轨迹（推荐，~6s）
node scripts/sync-data.mjs intervals --full   # 轨迹也全部重拉（~22s）
node scripts/sync-data.mjs intervals --dry-run
```

## GitHub Action 流程

- `schedule: 17 */3 * * *`：每 3 小时常规同步。intervals 每次**全量拉活动**（没有「只拉新增」模式，178 条一次请求即可），轨迹走增量缓存。
- `schedule: 47 4 * * 0` + `workflow_dispatch(full)`：`SYNC_FULL=1`，轨迹全部重拉，用于校正历史数据变更。
- 数据无变化时 `writeJson` 跳过写盘，`changed=0` 不产生提交；有变化才以 `chore(data): 定时同步外部数据源 [skip ci]` 提交，避免自触发循环。
- 构建阶段仍然离线读仓库里提交的 `src/data/*.json`。

## 已知限制 / 注意

- **intervals.icu 对「Strava 来源」的活动只返回空 stub**（`/docs` 明示：_An empty stub object is returned for Strava activities_）。本次账号里的活动都是直接来源（`ZEPP` / `UPLOAD`），字段完整；若以后又把 Strava 连回 intervals，同步到的活动可能只有 id/时间/类型，需要留意。
- Strava 导出 CSV 的「活动 ID」与 `activities/<文件名编号>` **不是同一个编号**（12 条全部如此）。脚本用「活动 ID」写 `external_id`，`--only` 两种编号都接受。
- 类型口径以 intervals 为准：Zepp 把部分「攀岩」路线记成 `Hike`，与 Strava 的 `RockClimbing` 不一致。这是上游记录口径，不在同步时强行改写；如需统一可用导入脚本的 `--fix-type`（默认关闭）。
- 轨迹是坐标点采样后压缩的（每条最多 1500 点），只用于卡片背景与地图预览，不是逐点原始 GPS。
- 活动 `i204301945`（340m 跑步）上游 `/map` 返回空 `latlngs`，属于本身无 GPS，不是同步失败。

## 涉及文件

- `src/lib/activity-types.ts`（数据契约）、`src/lib/intervals.ts`（映射与轨迹纯函数）
- `scripts/sync-data.mjs`（intervals 源）、`scripts/import-strava-export.mjs`（一次性导入工具）
- `src/api/store.ts`、`src/pages/exercise.astro`、`src/pages/exercise-routes.json.ts`、`src/lib/exercise.ts`、`src/lib/strava-preview.ts`、`src/components/islands/{ExerciseTimeline.astro,LedgerStrava.astro,Relitu.tsx}`、`src/lib/client/exercise-map.ts`
- `src/data/activities.json`（新产物）；已删除 `src/data/strava.json`、`src/data/strava-history.json`、`src/lib/strava-types.ts`
- `.github/workflows/ci.yml`（注释与流程说明）
