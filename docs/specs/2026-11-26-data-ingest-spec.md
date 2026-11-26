# 数据接入规范（v1，2026-11-26）

状态：可实施规范，随试点实现同步修订。适用仓库 `astro-book`。
本轮目标：把「一个源一段裸函数 + 手写写盘」收敛为**显式登记、契约校验、统一执行**的三层，保留将来插件化边界；**不做插件平台**（不做自动发现、不做插件市场、不做动态加载、不做 UI 管理后台）。

---

## 1. 概念模型（四层，必须分开说）

| 层 | 定义 | 落点 |
| --- | --- | --- |
| **来源（source）** | 一个外部系统（Ghost / Emby / NeoDB / intervals / 自建 WebDAV…）。有凭据、有失败语义。 | `scripts/lib/sources/<id>.mjs` |
| **数据集（dataset）** | 一种**带版本契约**的产物形状，落到一个文件。如 `emby.viewing@1` → `src/data/emby.json`。 | 契约 `scripts/lib/ingest/contracts.mjs` |
| **输出（output）** | 一次同步真正写盘的文件。一源可有多输出（flux → flux.json + flux-lost.json）。 | 由 dataset 的 `file` 决定 |
| **消费者（consumer）** | 构建期读文件的代码（`src/api/store.ts`、`src/lib/*`、页面）。只认契约，不认来源。 | `src/` |

**一源多输出**：`flux` 是既有例子（同一批 Miniflux 数据派生「最新文章」和「失联订阅」）。
**多消费者**：同一 dataset 可被 store、RSS、search-data、时间线同时消费；来源不得假设只有一个消费者。
**来源不直接面向页面**：来源产出 dataset，页面只读 dataset。

## 2. 模块接口（唯一形状，不允许各写一套）

每个来源模块只导出两样东西，**模块导入不得有副作用**（不读 env、不建目录、不发请求、不写盘）：

```js
// scripts/lib/sources/emby.mjs
export const meta = {
    id: 'emby',
    optional: true,                       // 失败只告警、保留旧数据
    credentials: ['EMBY_BASE_URL', 'EMBY_USER_ID', 'EMBY_API_KEY'], // 声明需求，不是读操作
    optionalCredentials: ['TMDB_API_KEY'],// 缺失仍可跑，行为要写进模块注释
    datasets: ['emby.viewing'],           // 本模块产出的 dataset id
    description: '自建 Emby 观看记录（最近 90 天）'
};

export async function collect(ctx) {
    // ctx = { env, log, fetchJson, previous(datasetId), dryRun, now, state }
    // env 只含 credentials + optionalCredentials 中的键，由执行器注入
    return {
        outputs: [{ dataset: 'emby.viewing', data, complete: true }]
    };
}
```

硬约束：

1. `collect` 不依赖 UI、不 import 其它来源模块、不直接调用另一个来源（跨源组合放 `sync-data.mjs` 的编排层或独立派生源，且需显式登记）。
2. `collect` 不自行写盘、不自行创建目录（封面等二进制附属产物例外，但必须在 `meta.artifacts` 里声明目录，仅允许写 `public/<declared>/`，见 §6）。
3. 来源之间不共享可变全局状态；模块级变量只能做纯常量。
4. 已知基线差异：现存 `scripts/sync-emby.mjs` 用模块级 `BASE/USER_ID`（由 `syncEmby(env)` 赋值）——试点迁移时改成 `collect` 内的局部变量，不留可变全局。

## 3. 数据契约与版本

契约是**代码里的显式声明**，不是文档约定：

```js
export const contracts = {
  'emby.viewing': {
    version: 1,
    file: 'emby.json',
    writeMode: 'replace',        // replace | merge | append
    key: 'id',                   // merge/append 时的稳定主键字段
    allowEmpty: false,           // false = 空结果保留旧文件
    item: {                      // 字段 → 类型；'?' 结尾表示可选
      id: 'string', type: 'string', title: 'string',
      episodeCode: 'string?', episodeTitle: 'string?', meta: 'string?',
      overview: 'string?', minutes: 'number?', rating: 'number|null',
      seriesRating: 'number|null', seriesOverview: 'string?',
      played: 'boolean', playedPercent: 'number',
      lastPlayedAt: 'number|null', imageTag: 'string?', cover: 'string|null'
    }
  }
};
```

规则：

- 类型只允许 `string | number | boolean | null | 数组/对象（写 'array' / 'object'）`，加 `?` 表示可选。校验器自己实现（**不引入新依赖**）。
- `version` 是**契约版本**，不是数据版本：字段增删或语义变更必须 +1。模块 `meta.datasets` 与契约 `version` 不匹配 → 视为配置错误，硬失败（不静默写盘）。
- 稳定 ID：每条记录必须有 `id`，同一次输出内**不得重复**；重复视为硬失败（去重是来源的责任，执行器只报错）。ID 不得使用数组下标、时间戳或随机值。
- `writeMode` 语义：
  - `replace`：本次结果即全集，直接替换（上游必须保证分页完整，见 §4）。
  - `merge`：按 `key` 与旧数据合并，**旧记录保留**（只增不删），用于上游只返回增量且无删除信号的场景。
  - `append`：按 `key` 追加重放安全（重复 key 覆盖旧值，不产生副本），语义等同 merge 但显式声明「只追加」。
- **删除语义**：只有 `replace` 能表达删除（旧的不在新结果里就消失）。需要软删除的来源应在数据里加 `deleted: true` 字段并写进契约，由消费者过滤，**不要**用 merge 假装删除。
- 契约的消费者一侧：`src/api/types.ts` 的 TS 形状必须与契约一致；不一致由测试兜（`tests/scripts/contracts.test.ts` 至少校验键集合）。

## 4. 分页完整性、空结果、失败

| 情形 | 行为 |
| --- | --- |
| 分页未拉完 / 中途 4xx / 达到单页上限 | `collect` 返回 `complete: false` 或抛错 → **不写盘**，保留旧文件，告警写明页码/总数 |
| 上游返回 0 条（可能认证成功但确实为空） | 契约 `allowEmpty:false` → 保留旧文件 + 告警；`allowEmpty:true`（如派生数据）才写空 |
| 401 / 403 / 缺凭据 | 分类为 `auth`，可选源 → 告警；非可选源 → 硬失败；**绝不**用空数据覆盖 |
| 429 / 5xx / 超时 | 分类为 `upstream`，整源放弃本轮，旧数据保持（不做半截写入） |
| 同一源多输出，其中一个校验失败 | **整源都不写**（多输出一致性），已写的临时文件删除 |
| 部分条目字段缺失 | 可选字段允许缺；必填字段缺失 → 整源失败并报出首个错误条目 id |
| 旧数据过期 / 上游已删除 | `replace` 自然淘汰；`merge` 需要来源显式给出删除信号，否则保留并在报告里计数 |

**游标只在写盘成功后推进**：`state` 里的 `cursor/lastSuccessAt/etag` 必须在文件原子替换成功后写入；失败时不得推进，否则下一轮会漏数据。

## 5. 凭据

- 凭据来源：本地 `.env`（gitignore）+ GitHub Actions Secrets。**不建密钥后台、不加凭据 UI、不写数据库。**
- 模块只**声明**需要的键（`meta.credentials`），执行器按声明**只注入所需项**；`collect` 拿到的 `env` 不含其它源的键。
- 多实例 / 多账号：用命名空间键（如 `EMBY_2_BASE_URL`）在来源内部解析，**不把账号选择做成自动路由**；一个 registry 条目对应一个账号实例。
- 缺凭据 → 无人值守**不弹卡、不询问**，按 `optional` 决定告警或失败。
- 凭据不得出现在：JSON 数据、HTML、快照、日志、报告、带 token 的图片/链接 URL。日志统一脱敏：任何 `Authorization` / `api_key=` / `token=` 值替换为 `***`；错误信息里的 URL 也要过一遍。
- 认证请求只发往声明的目标源；`redirect: 'follow'` 时若跨域跳转，**必须**剥掉 `Authorization` 头（默认 `fetch` 跨域会丢，但仍要显式判断，防未来换实现）。
- 诚实边界：Node 模块**不是沙箱**。本规范只约束「模块应当做什么」，不提供隔离；第三方来源代码要按信任代码对待，进仓库前需评审。

## 6. 私有原始数据边界

- 公开目录白名单：`src/data/*.json`、`public/**`（组件引用的产物）、`dist/**`（构建产物）。除此之外任何原始数据（数据库、下载缓存、私有 vault）不得进入仓库或被构建读取。
- 未公开记录（如 Memos 的 UNLISTED / PRIVATE / DIRECT）**不得进入** `src/data`、`public`、`dist`；过滤在**来源侧**（落地前），并对消费者侧做防御性过滤（双保险）。
- 二进制附属产物（封面、缩略图）只能写进 `meta.artifacts` 声明的目录，文件名必须由稳定 ID 派生（禁止把上游 URL 或 token 拼进文件名/路径）。
- 管理元信息（最后同步时间、条数、耗时、失败原因）单独放 `.cache/sync-state.json`（gitignore），**不写进数据文件**，避免每次同步都产生无意义提交噪音。

## 7. 执行器职责（唯一写盘者）

执行器 `scripts/lib/ingest/executor.mjs` 负责、且只有它负责：

1. 读取 registry，按名字解析来源（`node scripts/sync-data.mjs emby,imagemeta`）。
2. 解析凭据：只注入声明项；缺失时按 `optional` 分类。
3. 调用 `collect`，带超时上限与 `dryRun`。
4. **契约校验**（版本、字段类型、必填、ID 唯一、排序/去重后置条件）。
5. 统一写盘：写完临时文件 → `fs.renameSync` 原子替换；`replace` 之外的模式先读旧数据合并再校验。
6. 写盘成功后才更新 `state`；生成一份脱敏报告（源、dataset、条数、耗时、warn/fail 分类）。
7. 并发保护：`.cache/sync.lock`（进程存在性 + 超时）；拿不到锁直接退出 2，**不并行写同一文件**。
8. `--dry-run`：走完 1–4 与 6 的「将要写入」报告，跳过 5、6 的落盘。

构建侧防御检查：`scripts/check-public-data.mjs`（构建前/CI 可跑）扫描 `src/data` 与 `dist`，命中「非公开记录特征」即非零退出。它只做兜底，不替代来源侧过滤。

## 8. 明确不做（本轮边界）

- 不做自动发现 / 插件目录扫描 / 动态 import 用户提供路径 / 插件市场 / 安装卸载。
- 不做凭据管理后台、不做多账号自动路由、不做同步 UI。
- 不全量迁移 10 个源：本轮只迁 **Emby** 与 **图片尺寸索引（imagemeta）**；其余源保持现状，登记在迁移清单里。
- 不把网络请求移入 Astro 构建期（构建仍零网络）。
- 不强制改用 Astro Content Collections（garden 已在用，可参考其 schema 写法，但本轮不改数据通道）。

## 9. 验收口径（本规范自身）

- 新增一个来源 = 新建 `scripts/lib/sources/x.mjs` + 在 `registry.mjs` 加一行 + 在 `contracts.mjs` 加契约；**不改** `executor.mjs`。这条要能实机演示（用 tweaked 的 fixture 跑一遍）。
- `node scripts/sync-data.mjs emby --dry-run` 与全量 CLI 行为不变；`--full`、`optional`、合法空输出语义不变。
- 缺凭据、超时、401、429、分页不全、重复 ID、空结果、多输出部分失败，各有自动化测试（用 `tests/helpers/mock-fetch.ts` 或等价 stub，不发真实网络）。
