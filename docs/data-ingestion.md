# 数据接入指南（外部数据 → `src/data/*.json`）

本文件面向后续维护者：说明站点数据是怎么从外部服务进到仓库里的 JSON、怎么加一个新来源、怎么排查失败，以及地图那条特殊处理链。

> **本文的命令与退出码都在 2026-11-26 的本地分支上实跑过**（见 §11 记录）。当时的状态是：模块化迁移**只完成了本地实现与本地验收**，真实上游联调、GitHub Actions、发布均**未验证**。文中的 URL、令牌、示例条目都是占位或虚构的。

- 设计与验收细节：`docs/specs/2026-11-26-data-ingest-spec.md`、`docs/specs/2026-11-26-local-acceptance.md`
- 站点构建期的读取方：`src/lib/store.ts`、`src/pages/*.astro`

---

## 1. 一句话架构与端到端流程

站点**构建时零网络**：所有外部数据先由 `scripts/sync-data.mjs` 落成 `src/data/*.json` 并提交进仓库，`astro build` 只读这些文件。

```
外部服务 (Ghost / Memos / NeoDB / Flux / intervals.icu / KMZ / WebDAV / 排名 worker)
        │
        │  node scripts/sync-data.mjs [源...] [--dry-run] [--full]
        ▼
scripts/sync-data.mjs          解析参数、加载 .env、汇总结果、决定退出码
        │
        ▼
scripts/lib/ingest/registry.mjs   源登记表（源名 → 模块路径 + optional）
        │
        ▼
scripts/lib/ingest/executor.mjs   runIngestSource(name)
   1. 动态 import 模块 → 校验 meta（id / optional / datasets / 契约版本）
   2. 必需凭据缺失 → code=auth（可选源只告警）
   3. 取 .cache/sync.lock（并发互斥，陈旧锁自动接管）
   4. 构造 ctx：只注入 meta 声明的环境变量；日志脱敏；
      fetchJson / fetchBinary（自行跟随 ≤5 跳、跨源剥敏感头）；
      previous / readData / fileStat / writeArtifact
   5. await collect(ctx)          ← 来源模块唯一的职责：返回数据，不写盘
   6. 契约校验：完整度 → 空值 → 主键唯一 → 字段类型 → 排序后置条件
      （一源多产物时，任一不过，整源一个文件都不写）
   7. JSON.stringify(data,null,2)+"\n" → 写 .<file>.tmp-<pid> → rename 原子替换
      （内容与旧文件完全相同则不写）
   8. 记录 .cache/sync-state.json（每个源最后成功时间与条数）
        │
        ▼
src/data/*.json  ──►  astro build（只读文件，不发请求）
```

两条硬规则：

1. **执行器是唯一写盘者**。来源模块不 import `fs`，只能返回数据、通过 `ctx.writeArtifact()` 交附属文件。
2. **契约先于写盘**。产物不合契约就抛错、保留旧文件；可选源（`optional: true`）失败只告警，不影响退出码。

---

## 2. 目录职责

| 路径 | 职责 |
| --- | --- |
| `scripts/sync-data.mjs` | CLI 入口：参数解析、`.env` 加载、跑源、汇总告警、退出码 |
| `scripts/lib/ingest/registry.mjs` | 源登记表：`源名 → { module, optional }`，**新增来源只加一行** |
| `scripts/lib/ingest/contracts.mjs` | 11 份数据集契约：文件名、版本、形状、主键、字段类型、排序、空值策略 |
| `scripts/lib/ingest/validate.mjs` | 纯函数校验器：版本、字段类型、主键唯一、排序后置条件 |
| `scripts/lib/ingest/executor.mjs` | 执行器：加载模块、注入凭据、超时、取锁、校验、原子写、记状态 |
| `scripts/lib/ingest/state.mjs` | `.cache/sync-state.json`（成功记录）与 `.cache/sync.lock`（并发锁） |
| `scripts/lib/ingest/sensitive-headers.mjs` | 敏感头判定与跨源剥离（通用模式 + 来源显式声明） |
| `scripts/lib/sources/<源>.mjs` | 各来源采集模块：只 `collect(ctx)`，返回 `{ outputs: [...] }` |
| `scripts/map/*.py` | **地图专用**：KMZ → GeoJSON 转换与 GCJ-02→WGS-84 坐标转换（见 §7） |
| `scripts/sync-reading.mjs` | 阅读数据实现本体（`reading.mjs` 转调它，含封面写盘） |
| `scripts/check-public-data.mjs` | 隐私闸门：`src/data` 与 `dist` 里不得出现非公开记录（见 §10） |
| `scripts/check-no-modu-db.mjs` | 泄露闸门：git 索引与 `dist/` 不得有本地数据库/日记痕迹 |
| `scripts/ci-local.mjs` | 把 CI 的构建侧闸门在本地按同一顺序跑一遍（见 §4.3） |
| `src/data/*.json` | 产物，**不要手改**；改数据请改上游或同步脚本 |
| `.cache/` | 同步状态与锁（gitignore，不进仓库） |
| `tests/scripts/ingest-*.test.ts` | 每个来源一组：冻结输入等价、契约、失败语义、原子写 |

---

## 3. 十个来源 / 十一份契约（按代码实测生成，2026-11-26）

`optional` 决定失败语义：**true = 失败只告警、保留旧文件、退出码不受影响**；false = 计入硬失败，整轮退出码 1。

| 源 | optional | 必需凭据 | 可选凭据 | 数据集 → 产物文件 | 形状 / 空值 / 写入 |
| --- | --- | --- | --- | --- | --- |
| `emby` | ✔ 可选 | `EMBY_BASE_URL` `EMBY_USER_ID` `EMBY_API_KEY` | — | `emby.viewing` → `emby.json` | list / 不许空 / replace |
| `memos` | 必需 | —（优先 GTS，缺失则走公开 API 兜底） | `GOTOSOCIAL_URL` `GOTOSOCIAL_TOKEN` `GOTOSOCIAL_ACCOUNT_ID` `MEMOS_PUBLISH_VISIBILITIES` | `memos.list` → `memos.json` | list / 不许空 / replace |
| `ghost` | 必需 | `GHOST_API_URL` `GHOST_API_KEY` | `GHOST_API_POST_LIMIT` | `ghost.content` → `ghost.json` | object / 不许空 / replace |
| `neodb` | 必需 | `NEODB_TOKEN` | `NEODB_API_URL` `NEODB_SHELVES` `SYNC_FULL` | `neodb.marks` → `neodb.json` | object / 不许空 / replace |
| `flux` | 必需 | `FLUX_URL` `FLUX_KEY` | `FLUX_READER_PROXY` | `flux.feed` → `flux.json`；`flux.lost` → `flux-lost.json` | list ×2 / 前者不许空、后者允许空 / replace |
| `intervals` | 必需 | `INTERVALS_ICU_API_KEY` | `INTERVALS_ICU_ATHLETE_ID` `SYNC_FULL` | `intervals.activities` → `activities.json` | list（升序）/ 不许空 / replace |
| `map` | 必需 | `MAP_KMZ_URL` | `SYNC_FULL` | `map.geojson` → `geojson.json` | object / 不许空 / replace |
| `reading` | ✔ 可选 | `MODU_WEBDAV_URL` | `MODU_WEBDAV_USER` `MODU_WEBDAV_PASS` | `reading.digest` → `reading.json` | object / 不许空 / replace |
| `rank` | ✔ 可选 | — | — | `rank.status` → `rank.json` | object（未声明字段放行）/ 不许空 / replace |
| `imagemeta` | 必需 | — | — | `imagemeta.sizes` → `image-meta.json` | map（键为 `size_<url>` / `error_<url>`）/ 不许空 / replace |

沿用既有语义的三处细节：

- **`flux` 一源两产物**：`flux.json` 与 `flux-lost.json` 要么都写、要么都不写（`flux-lost.json` 允许 `[]`）。
- **`intervals` 是升序**（`orderBy: start_date_local`，`orderDir: 'asc'`），页面时间线按它从早到晚排；其余 list 契约默认降序。
- **`rank` 与 `reading` 必须是可选源**：远端打盹时迁移前就是「只告警、退出码 0」，标成必需会把一次抖动升级成整轮失败。

---

## 4. 调用入口、参数与退出码

### 4.1 同步数据

```bash
node scripts/sync-data.mjs                 # 全部 10 个源
node scripts/sync-data.mjs ghost           # 只跑一个源
node scripts/sync-data.mjs ghost neodb     # 多个源：空格分隔（不是逗号）
node scripts/sync-data.mjs --dry-run       # 全部源，只看将写什么，不落盘
node scripts/sync-data.mjs map --dry-run   # 单源预览
node scripts/sync-data.mjs --full          # 忽略增量缓存（等价 SYNC_FULL=1）
npm run sync:data                          # = node scripts/sync-data.mjs
```

- 环境变量来源：仓库根 `.env` 全部键；`process.env` 只接受白名单前缀（`GHOST_ NEODB_ FLUX_ MAP_ CDN_ INTERVALS_ GOTOSOCIAL_ MEMOS_ MODU_ EMBY_`）。**新增来源若用别的前缀，必须同时加进 `sync-data.mjs` 的 `loadEnv()`**，否则进程环境里设了也不生效。
- 逗号分隔**不支持**（`ghost,neodb` 会被当成一个未知源名 → 警告 → 一个都不跑 → 退出 0）。这与 `sync-data.mjs` 顶部注释里写的「逗号分隔」不一致，属既有缺口，按实际行为（空格分隔）使用。

退出码：

| 退出码 | 含义 | 实测样例 |
| --- | --- | --- |
| `0` | 没有硬失败源（可选源失败、或一个源都没跑也算） | `rank --dry-run`、`reading --dry-run`、未知源名 |
| `1` | 至少一个**必需**源失败，或脚本异常 | `ghost --dry-run`（缺凭据）、`map --dry-run`（缺凭据） |
| `2` | 拿不到并发锁（另一个同步进程正在跑） | 需并发触发，未在本轮实跑 |

逐条实测（2026-11-26，本机无凭据、无 python3）：

```
node scripts/sync-data.mjs ghost --dry-run   → 1  "[ghost] 同步失败: 缺少凭据 GHOST_API_URL, GHOST_API_KEY，保留已有数据"
node scripts/sync-data.mjs map --dry-run     → 1  "[map] 同步失败: 缺少凭据 MAP_KMZ_URL，保留已有数据"
node scripts/sync-data.mjs reading --dry-run → 0  "[warn] 可选源 reading: 缺少凭据 MODU_WEBDAV_URL"
node scripts/sync-data.mjs rank --dry-run    → 0  上游不可达 → 复用旧文件 → 契约判旧文件不合格 → 只告警
node scripts/sync-data.mjs nosuch-source     → 0  "未知源: nosuch-source（可用: emby,memos,…）"，跑 0 个源
```

### 4.2 只跑代码不联网

CI 与本地断网等价验证靠两道闸门 + 一个预加载脚本，不需要额外命令：

- `scripts/ci-local.mjs --offline` 构建阶段注入 `NODE_OPTIONS=--import=data:text/javascript,…`，把 `fetch`/`net.connect`/`dns.*`/`http(s).request` 全部改成抛错，出站请求会记进 `/tmp/ci-offline-net.log`。
- 构建能通过 = 构建期确实没有依赖外网。

### 4.3 本地 CI 等价闸门

```bash
node scripts/ci-local.mjs            # 类型 → 单元测试 → 构建 → 隐私闸门 → 泄露闸门
node scripts/ci-local.mjs --fast     # 跳过构建（用现有 dist 跑两个闸门）
node scripts/ci-local.mjs --offline  # 构建阶段断网（CI 的等价验证）
```

五步依次是：`npx astro check`、`npx vitest run`、`npx astro build`、`node scripts/check-public-data.mjs`、`node scripts/check-no-modu-db.mjs`。任一步失败即退出 1。

它**不替代 CI**：Actions 里还会拉取 garden vault（需令牌）并跑定时取数。

---

## 5. `--dry-run`、离线与写盘边界

| 动作 | 写 `src/data/` | 写 `.cache/` | 发网络请求 |
| --- | --- | --- | --- |
| 正常同步 | 有变化才写（原子替换） | 成功后写 state；全程持锁 | 是 |
| `--dry-run` | **不写**（仍做完整校验，能提前暴露契约问题） | 不写 state；仍取锁并释放 | 是（仍会请求上游） |
| `--full` / `SYNC_FULL=1` | 同上 | 同上 | 是，且忽略增量缓存（`map` 不带 `If-Modified-Since`、`intervals` 重拉轨迹、`neodb` 全量翻页） |
| `ci-local --offline` | 只读 | 不涉及 | **否**（出站被 preload 拦死） |

要点：

- `--dry-run` 不是「离线模式」：它照样请求上游，只是不写盘。要既不发请求又不写盘，用 `ci-local --offline` 的构建阶段（它只读已提交的 `src/data`）。
- 附属产物（`ctx.writeArtifact`，目前只有 `emby` 的封面）在 dry-run 下只记「将写入」，不落盘。
- **例外（已知限制）**：`reading` 的封面由 `scripts/sync-reading.mjs` 直接写到 `src/assets/reading-cover/`，页面用 `import.meta.glob` 消费，**不在执行器原子写路径**。失败时可能留下「孤儿封面」（图有、JSON 没更新），页面按 key 取不到就不显示，属既有行为。

---

## 6. registry 与契约机制

### 6.1 登记表

```js
// scripts/lib/ingest/registry.mjs
export const sources = {
    example: { module: '../sources/example.mjs', optional: false }
};
```

- 登记表**不 import 模块**（加载无副作用），执行器运行时才 `import()`。
- `meta.id` 必须等于 registry 的键；`meta.optional` 必须与 registry 一致，否则按配置错误硬失败。
- `meta.datasets` 里的每个 dataset 必须已存在契约；`meta.datasetVersions` 的版本号必须与契约一致。

### 6.2 契约字段

```js
'example.feed': {
    version: 1,            // 字段增删或语义变更必须 +1
    file: 'example.json',  // 写入 src/data/ 的文件名
    writeMode: 'replace',  // replace | merge | append（merge/append 按 key 合并旧记录）
    key: 'id',             // list 主键（默认 'id'；数字主键也支持，比较时统一转字符串）
    allowEmpty: false,     // 允许空输出？空且不允许 → 抛 code=empty，保留旧文件
    description: '…',
    orderBy: 'publishedAt', // 可选：排序后置条件
    orderDir: 'desc',       // 'desc'（默认）| 'asc'
    item: { id: 'string', title: 'string', publishedAt: 'number|null' }
}
```

类型语法：`string | number | boolean | null | array | object`，`|` 表示联合，末尾 `?` 表示字段可缺失（**不表示可为 `null`**，`null` 要显式写进联合，例如 `'object|null?'`）。

三种 `shape`：

| shape | 顶层 | 校验内容 | 现有使用者 |
| --- | --- | --- | --- |
| 省略 / `list` | 数组 | `item` 字段、主键唯一、`orderBy` | emby、memos、flux×2、intervals |
| `map` | 扁平映射（键带前缀） | 键前缀白名单、值必须是对象 | imagemeta |
| `object` | 对象 | `fields` 逐字段（未声明字段放行）、`countField` 取条数 | ghost、neodb、map、reading、rank |

嵌套数组字段用对象描述：`{ type:'array', item:{…}, key?, allowEmpty?, orderBy?, orderDir? }`；省略 `key` 就不做唯一性校验（`geojson.features`、`reading.books` 这类没有稳定 id 的）。

排序后置条件比较时把缺失字段当 `0`（`validate.mjs` 的 `firstOrderViolation`），所以「可空字段 + 降序」要小心空值落点。

---

## 7. 地图：`.kmz` 不是直接能用的数据（特殊处理链）

足迹地图吃的不是 KML/KMZ，而是 `src/data/geojson.json`（GeoJSON FeatureCollection）。从 KMZ 到它是**一段必须的 Python 转换**，这也是整套数据接入里唯一使用子进程的地方。

### 7.1 链路

```
MAP_KMZ_URL（打包好的 .kmz，走 Secret）
   │  node scripts/sync-data.mjs map
   ▼
scripts/lib/sources/map.mjs :: collect(ctx)
   1. 有旧 geojson.json 且非 SYNC_FULL → 带 If-Modified-Since: <产物 mtime, GMT>
   2. ctx.fetchBinary(url, 30000)  → 304 复用本地、≥400 报错、空响应体报「KMZ 文件为空」
   3. mkdtemp('astro-book-map-') → 写入 input.kmz
   4. execFileSync(process.env.PYTHON || 'python3',
        ['scripts/map/convert_kmz_to_geojson.py', input.kmz, output.json], { stdio:'inherit' })
   5. 读回 output.json → 校验 features 是数组 → 返回 dataset
   6. finally：整目录 rm -rf（成功失败都清）
   ▼
执行器：契约 map.geojson（顶层对象、features 非空数组、每项有 geometry）
        → 原子写入 src/data/geojson.json
   ▼
src/pages/map.astro、src/lib/footprint-data.ts（构建期读 JSON）
   前端底图另需 PUBLIC_MAP_KEY（Mapbox 令牌，与 KMZ 无关）
```

### 7.2 转换脚本做了什么（`scripts/map/convert_kmz_to_geojson.py`）

1. 按 ZIP 打开 KMZ，**硬编码读取 `doc.kml`**；
2. 用 `xml.etree.ElementTree` 解析，命名空间硬编码为 `http://www.opengis.net/kml/2.2`；
3. 遍历每个 `Placemark`，取 `name` / `description` 文本，并按 `Point` / `LineString` / `Polygon` 生成几何；
4. **只有 `Point` 做坐标转换**：`gcj02_to_wgs84(lon, lat)`（`coordTransform_utils.py`，纯标准库实现）；
5. 用 `shapely` 的 `shape/mapping` 生成标准 GeoJSON 结构，`json.dump(..., indent=4)` 写文件；
6. 没有几何的 Placemark 直接丢弃。

### 7.3 依赖

| 依赖 | 位置 | 说明 |
| --- | --- | --- |
| `python3` | 运行环境 | 本机（NAS 容器）**没有** python3，所以转换在本机跑不了；可用 `PYTHON` 环境变量换解释器路径（测试就是靠它注入「假 python3」） |
| `shapely>=2` | `scripts/map/requirements.txt` | 只有 `mapping()` 用到；无 shapely 时脚本在 import 阶段就 `ModuleNotFoundError` |
| CI 安装 | `.github/workflows/ci.yml` 的 Install dependencies 步骤 | `python3 -m pip install --upgrade pip -r scripts/map/requirements.txt`；ubuntu-latest 自带 python3 |
| 无其他依赖 | — | `coordTransform_utils.py` 只用 `math`/`json`/`urllib`（其中 `urllib.urlencode` 那一段是没被调用的遗留代码） |

### 7.4 迁移前后差异（逐条）

| 项 | 迁移前（`scripts/sync-data.mjs` 的 `syncMap`） | 现在（`scripts/lib/sources/map.mjs`） | 影响 |
| --- | --- | --- | --- |
| 转换输出写到哪 | **直接写 `src/data/geojson.json`**（python 自己写） | 先写临时目录，由执行器原子替换 | 旧实现转换中途失败会在仓库文件里留下半截/缩进不同的内容；新实现失败时 `src/data` 一个字节不动 |
| 临时文件 | `tmpdir()/astro-book-map-<时间戳>.kmz`，只删 kmz | `mkdtemp` 目录（`input.kmz` + `output.json`），整目录删 | 都无残留；新实现连中间 GeoJSON 也一起清 |
| 产物格式 | python 先写 4 空格缩进，再由 JS 重写成 2 空格 + 换行 | 只有 JS 写一次（2 空格 + 换行） | **最终字节完全一致**：实测把现有 `geojson.json` 反序列化后按执行器的序列化方式重写，字符数 39642 与文件相同、逐字节相等 |
| 转换脚本本身 | — | — | **零改动**：`git diff 630519c..HEAD -- scripts/map` 为空 |
| `If-Modified-Since` | `statSync` 产物 mtime | `ctx.fileStat`（同一文件、同一格式） | 等价，模块因此不 import `fs` |
| 304 但本地无产物 | 抛 `HTTP 304` | 抛 `HTTP 304` | 一致 |
| 3xx 非 304（无 `location`） | `!response.ok` → 报错 | 只判 `>=400`，会把重定向响应体当 KMZ → 后续「KMZ 文件为空」或转换失败 | 边角差异：两条路都失败，只是错误文案不同；执行器实际会自行跟随 301/302/303/307/308（最多 5 跳） |
| `SYNC_FULL=1` | 不带条件请求头 | 不带条件请求头 | 一致 |

### 7.5 这条链的已知风险（未验证项）

1. **真实 KMZ 未跑过**：本机无 python3，仓库里也没有 KMZ 样本；黄金用例是用「假 python3」（`PYTHON` 指向一个把 fixture 复制到输出路径的 shell 脚本）验证**编排**（下载 / 304 / 临时目录 / 回读 / 清理），**转换逻辑本身未执行**。
2. **`doc.kml` 硬编码**：若上游导出的 KMZ 内部文件名不同（例如 `doc.kml` 之外的命名），脚本会 `KeyError`；上游实际文件名未验证。
3. **只转换 `Point`**：`LineString` / `Polygon` 的坐标**不做 GCJ-02 偏移**。真实数据当前 127 个要素**全是 `Point`**（127/127，属性 `name` 全有、`description` 53 条），所以这条现在没有实际影响；将来若导入轨迹或面状区域，会与标点错开几百米。
4. **上游地址只在 Secret 里**：`MAP_KMZ_URL` 的值不在仓库（本地也没有 `.env`），所以「KMZ 由哪个仓库生成」无法从代码确认；仓库内与地图有关的代码只有 `scripts/map/*.py`、`scripts/lib/sources/map.mjs`、`src/lib/footprint*.ts`、`src/pages/map.astro`。
5. 页面消费的是 `properties.name` 与 `geometry`；`description` 里是原始 HTML，**不要**当游记正文来源（游记靠 Ghost 的 `#地点-<标点名>` 标签匹配）。

---

## 8. 鉴权、超时、重试、跨源敏感头

| 机制 | 实现位置 | 行为 |
| --- | --- | --- |
| 凭据注入 | `executor.mjs` `buildContext` | 只把 `meta.credentials` / `meta.optionalCredentials` 里列出的环境变量交给模块；其余一律不给 |
| 缺必需凭据 | `runIngestSource` | 直接抛 `code='auth'`，**不发请求**（所以缺凭据时错误文案干净、也不会等超时） |
| 超时（单请求） | `ctx.fetchJson(url, opts, timeoutMs)` | 默认 20s；`AbortController` 到点中断 |
| 超时（整体） | `runIngestSource` | `collect()` 整体 5 分钟；到点抛 `code='upstream'` |
| 重试 | 仅 `neodb` | 每页最多 3 次，退避 1s/2s，页间 150ms；**401/403 不重试**（无意义且拖慢分类） |
| 重定向 | `fetchWithTimeout` | 自己跟随，最多 5 跳；第六跳按 `upstream` 失败；303（及 301/302 的非 GET）改 GET 并丢 body |
| 跨源剥头 | `stripSensitiveHeaders` | 跳转目标 `origin` 变化时剥掉敏感头，同源保留（取图、分页要用） |
| 敏感头判定 | `sensitive-headers.mjs` | 两层并集：① 头名含 `auth/cookie/token/secret/session/api-key/password/credential/signature`（`author`、`tokenizer` 例外）；② 来源 `meta.sensitiveHeaders` 显式声明（如 emby 的 `x-emby-token`、flux 的 `x-auth-token`） |
| 日志脱敏 | `sanitize()` | 已知密钥值（按 `KEY/TOKEN/PASS/SECRET/COOKIE` 名识别）替换为 `***`；URL 里 `api_key=/token=/…` 参数也替换；错误信息只带 URL 的 path，不带 query |

失败分类 → 处理：

| `error.code` | 谁产生 | 必需源 | 可选源 |
| --- | --- | --- | --- |
| `auth` | 缺凭据；HTTP 401/403 | 计失败 | 告警 |
| `upstream` | 网络错误、429、5xx、超时、重定向超限 | 计失败 | 告警 |
| `contract` | 契约不符、`complete=false`、多产物声明不一致 | 计失败 | 告警 |
| `empty` | 空输出且 `allowEmpty:false` | 计失败 | 告警 |
| `lock` | `.cache/sync.lock` 被活进程占用 | **整轮退出码 2** | 同左 |
| `registry` / `write` | 登记表不一致、写盘失败 | 计失败 | 计失败（这两类不区分可选性） |

---

## 9. 原子写、缓存、降级

- **原子写**：先写 `src/data/.<file>.tmp-<pid>`，再 `rename` 覆盖；一源多产物时先把所有临时文件写好，再逐个 rename。写失败会清掉临时文件并抛 `code='write'`。
- **不写无变化的文件**：序列化结果与现有文件逐字节相同则跳过，`changed` 计数不加。
- **空值保护**：空数组/空对象且契约 `allowEmpty:false` → 抛 `code='empty'`，保留旧文件（`flux-lost.json` 显式允许 `[]`）。
- **增量缓存**（各源自带，执行器不统一管）：
  - `map`：`If-Modified-Since`（基于产物 mtime），304 直接复用；
  - `intervals`：轨迹 `polyline` 复用 `activities.json` 里已有的，缺了才请求 `/activity/{id}/map`；`SYNC_FULL=1` 全量重拉；
  - `neodb`：本页全是已知条目即停止翻页；
  - `imagemeta`：`image-meta.json` 里已有键就是缓存，只补缺失。
- **降级**：可选源失败保留旧文件（`rank` 还会主动把旧数据回传，让执行器判定「无变化」）；必需源失败整轮退出 1，但**其它源已经写好的文件不会被回滚**（每源独立提交）。
- **并发**：`.cache/sync.lock`，写 PID 与开始时间；进程已死或锁超过 30 分钟自动接管；拿不到锁退出码 2。

---

## 10. 公开数据白名单（隐私）

三层防线，任何一层都不许把非公开记录带进数据或构建产物：

1. **来源侧**：`memos` 模块只保留 `MEMOS_PUBLISH_VISIBILITIES` 允许的可见性，默认 `PUBLIC`（显式写 `PUBLIC,UNLISTED` 才放开未列出）；全被过滤时直接报错，不用空数据覆盖已有文件。
2. **消费侧**：`src/lib/store.ts` / `src/lib/privacy.ts` 再过滤一次。
3. **发布前体检**：

```bash
node scripts/check-public-data.mjs                    # src/data + dist 双检
node scripts/check-public-data.mjs --features-from /path/to/历史备份.json   # 用仓库外备份复测「旧泄露样本已被清掉」
MEMOS_PUBLISH_VISIBILITIES=public,unlisted node scripts/check-public-data.mjs
```

- 规则：`src/data/memos.json` 里出现非公开记录 → 失败；`dist/` 文本文件里命中非公开正文特征 → 失败；`dist` 不存在时提示并跳过。
- 脚本**只打印条数与文件名，绝不打印正文**；`--features-from` 的备份含正文，必须放仓库外。
- 发布白名单不是「多一层保险」，而是硬闸门：`ci-local` 与 CI 都会跑它。

---

## 11. 新增一个来源：最小完整范例

> 以下代码是**虚构示例**（源名 `example`、域名 `example.invalid`、字段随意），只为展示最小改动面与写法。

改四处（不需要动执行器）：

**① `scripts/lib/sources/example.mjs`**

```js
/** 示例源：上游 JSON 数组 → src/data/example.json。只返回数据，不写盘。 */
export const meta = {
    id: 'example',                 // 必须等于 registry 键
    optional: false,               // false = 失败即整轮退出码 1
    credentials: ['EXAMPLE_TOKEN'],// 必需凭据：缺了直接 code=auth，不发请求
    optionalCredentials: [],       // 有则注入、无则不注入
    datasets: ['example.feed'],
    datasetVersions: { 'example.feed': 1 },
    description: '示例源条目（虚构）'
};

export async function collect(ctx) {
    // 只走 ctx：凭据注入、超时、跨源剥头、日志脱敏都由执行器负责
    const payload = await ctx.fetchJson(
        'https://example.invalid/api/items',
        { headers: { Authorization: `Bearer ${ctx.env.EXAMPLE_TOKEN}` } },
        20000
    );
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const rows = items.map((item) => ({
        id: String(item.id),                       // 主键必须稳定且唯一
        title: String(item.title ?? ''),
        publishedAt: typeof item.published_at === 'number' ? item.published_at : null
    }));
    // complete:false 表示没拉完 → 执行器抛 code=incomplete，保留旧文件
    return { outputs: [{ dataset: 'example.feed', data: rows, complete: true }] };
}
```

**② `scripts/lib/ingest/contracts.mjs` 加一份契约**

```js
'example.feed': {
    version: 1,
    file: 'example.json',
    writeMode: 'replace',
    key: 'id',
    allowEmpty: false,
    description: '示例源条目（虚构），按 publishedAt 降序',
    orderBy: 'publishedAt',
    item: { id: 'string', title: 'string', publishedAt: 'number|null' }
},
```

**③ `scripts/lib/ingest/registry.mjs` 加一行**

```js
example: { module: '../sources/example.mjs', optional: false },
```

**④ `tests/scripts/ingest-example.test.ts`（形状参照现有 `ingest-rank.test.ts`）**

```ts
import { describe, expect, it } from 'vitest';
import { runIngestSource } from '../../scripts/lib/ingest/executor.mjs';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const quiet = { log() {}, warn() {}, error() {} };

function makeProject() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'example-'));
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    return root;
}

const fetchImpl = async () =>
    new Response(JSON.stringify({ items: [{ id: 1, title: '甲', published_at: 2 }, { id: 2, title: '乙', published_at: 1 }] }), { status: 200 });

describe('example 源', () => {
    it('写入 src/data/example.json，条数与内容正确', async () => {
        const root = makeProject();
        const result = await runIngestSource('example', { projectRoot: root, env: { EXAMPLE_TOKEN: 'test-token' }, fetchImpl, log: quiet });
        expect(result.outputs[0].count).toBe(2);
        const written = JSON.parse(readFileSync(path.join(root, 'src/data/example.json'), 'utf8'));
        expect(written.map((row: { id: string }) => row.id)).toEqual(['1', '2']);
    });

    it('缺凭据 → code=auth，不写盘', async () => {
        const root = makeProject();
        await expect(runIngestSource('example', { projectRoot: root, env: {}, fetchImpl, log: quiet }))
            .rejects.toMatchObject({ code: 'auth' });
    });
});
```

若新源要用新的环境变量前缀，记得同步改 `scripts/sync-data.mjs` 的 `loadEnv()` 白名单；若它要写图片等附属文件，用 `ctx.writeArtifact('emby-cover/x.webp', bytes)`，并在 `meta.artifacts` 里声明 `{ dir: 'public/emby-cover' }`。

**上面这四段代码在临时副本里实跑过**（2026-11-26，`node_modules` 与工作副本同源的隔离目录，不污染仓库）：`npx vitest run tests/scripts/ingest-example.test.ts` → **2 passed**；`node scripts/sync-data.mjs nosuch` 的「可用」列表里出现 `example`；`node scripts/sync-data.mjs example --dry-run` → 缺凭据、退出码 **1**。跑完副本已删除，仓库未多出任何文件。

---

## 12. 测试与调试清单

```bash
npx vitest run                                    # 全部（2026-11-26 实测 37 files / 580 passed）
npx vitest run tests/scripts/ingest-map.test.ts   # 单源（实测 8 passed）
npx astro check                                   # 类型（246 files / 0 errors）
node scripts/ci-local.mjs --offline               # 五步闸门（实测 5/5 PASS）
node scripts/check-public-data.mjs                # 隐私闸门
```

每个 `ingest-<源>.test.ts` 至少覆盖四件事：**冻结输入等价**（旧实现产出的 golden，新模块深比较）、**真实文件过契约**（`validateDataset` 对 `src/data/*.json` 0 错误）、**失败语义**（401/403→`auth`、429/5xx→`upstream`、空结果→拒写、`.tmp` 无残留）、**写盘边界**（失败时旧文件字节不变）。

排查常见症状：

| 症状 | 先看哪里 |
| --- | --- |
| `缺少凭据 X`，根本没发请求 | 凭据名是否与 `meta.credentials` 一致；`.env` 或进程环境是否有值；新前缀是否加进 `loadEnv()` 白名单 |
| `HTTP 401/403`，退出码 1 | 令牌是否过期；该源是否被标成必需源（可选源只会告警） |
| `契约校验失败（N 处）` | 上游字段变了：用 `validateDataset(datasetId, data)` 单跑看前 3 条；改契约要同时 `version + 1` 并在模块里同步 `datasetVersions` |
| `结果为空且契约不允许空输出` | 上游返回空 / 过滤条件把数据全滤掉了；不要为了「让它过」改成 `allowEmpty:true`，先确认上游 |
| 数据没更新但同步「成功」 | 内容与旧文件逐字节相同（执行器跳过写盘）；看 `[ingest] … 无变化` |
| 退出码 2 | `.cache/sync.lock` 被活进程占着；确认没有并发同步后删锁文件 |
| `astro build` 报缺模块 | 某个 `src/data/*.json` 被删了；产物文件必须存在（`rank.json` 这类被页面直接 import） |

---

## 13. 当前状态与未验证项（务必与结论一起读）

**已完成（本地）**：10 个来源全部由 registry 驱动，`sync-data.mjs` 内的旧实现已清空；11 份契约对真实文件校验通过（`rank.status` 按设计如实判不合格，见下）；隐私闸门、泄露闸门、类型、单元测试、断网构建在本地全绿。

**未验证（不要当成已联调）**：

1. 真实上游同步：Ghost / GTS / NeoDB / Flux / intervals / map / reading 均未跑真实同步（无凭据或按约束不跑）；等价性靠「冻结输入 + 真实文件重算」。
2. GitHub Actions 从未在本轮运行（`ci.yml` 有改动未提交至远端）。
3. 地图转换本身（本机无 python3，见 §7.5）。
4. 翻页与增量：`ghost` / `neodb` 仅单页 fixture；`intervals` 真实多窗口未验。
5. `rank.status`：仓库里现存 `src/data/rank.json` 是上游错误载荷（`{"success":false,"error":"…"}`），契约会拒绝它并保留旧文件——即页面短期内仍显示 0 小时，直到上游恢复正常。
