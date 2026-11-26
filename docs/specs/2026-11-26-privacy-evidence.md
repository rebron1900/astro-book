# 隐私核验：本地证据与边界（2026-11-26）

**结论先行：只证明了「本地仓库与本地构建产物里存在非公开 Memos 内容」，没有证明线上可见性，也没有证明历史泄露页数。**
下文所有数字均为 2026-11-26 在本机 `/data/workspace/bots/知行/astro-book` 上量得，可复现命令附在每节末尾。

## 1. 本地量到的数字

| 项 | 数值 | 说明 |
| --- | --- | --- |
| `src/data/memos.json` 总条数 | 2910 | 字段含 `visibility` |
| PUBLIC | 2668 | 明确公开 |
| UNLISTED | 85 | 不列入公开列表，但可凭链接访问（Memos 语义） |
| PRIVATE | 109 | 私有 |
| DIRECT | 48 | 仅指定可见 |
| 非公开合计 | 242 | 全部被写进 `src/data/memos.json` |
| 该文件是否在 git 里 | 是（`git ls-files` 命中） | 非公开正文因此也在仓库历史里 |
| `dist/` 中命中的非公开条目 | ≥ 78 条（可检出样本 223 条） | 用「去标签后前 40 字」做子串匹配，实际条数只会更多 |
| 命中的产物文件 | 47 个 HTML + `search-data.json`(3 条) + `rss.xml`(1 条) | 集中在 `/timeline/memo/*`、`/now/*` |
| `dist/` 文件总数 | 2369（其中 html/json/xml 2241） | |

复现：

```bash
node -e "const m=require('./src/data/memos.json');const c={};for(const x of m)c[x.visibility]=(c[x.visibility]||0)+1;console.log(m.length,c)"
git ls-files src/data/memos.json
# 命中统计见交付说明中的一次性脚本（按去标签 40 字子串匹配，不输出正文）
```

## 2. 为什么不能说「1134 页泄露」

- 页面数与记录数不是一一对应：072 条非公开内容会散落在多个分页，也会被 RSS / search-data 重复收录；「命中文件数」不等于「独立泄露页面数」。
- 线上站点（部署后的公开地址）**未被核验**：本次没有抓取线上 URL、没有比对线上 HTML，也没有检查 CDN/缓存。
- 远端可见性（Git 托管方、Actions 日志、私有/公开仓库设置）**未被核验**。
- 本机 `dist/` 是本地构建产物，历史 `dist` 已被覆盖，无法据此推断线上历史。

因此本轮只报：**本地确认存在非公开内容进入数据文件与构建产物**；线上与历史泄露为「未核验」。

## 3. 本轮已授权 / 未授权的处置

| 动作 | 状态 |
| --- | --- |
| 来源侧过滤（只保留明确公开记录） | 本轮实施（默认 `PUBLIC`） |
| 消费者侧防御过滤（store 读取时再滤一次） | 本轮实施 |
| 构建期/CI 防御检查脚本（命中即失败） | 本轮实施 |
| 清理 `src/data/memos.json` 里已有的非公开条目 | 本轮实施；旧文件另存本地备份（不进仓库） |
| 清理 `dist/` 旧产物 | 仅本地重新构建覆盖，不删他人文件 |
| 重写 git 历史 / 强推 / 更换远端 | **未授权，本轮不做** |
| 线上下线、CDN 清缓存、搜索收录移除 | **未授权，本轮不做** |
| 远端仓库公开性变更 | **未授权，本轮不做** |

## 4. 残余风险（交老板决策，不由执行方擅自处理）

1. **git 历史**：即使工作区过滤生效，`src/data/memos.json` 的旧提交仍含 242 条非公开正文。彻底处置需要重写历史或改用私有仓库 + 过滤后再发布，两者都需单独授权。
2. **已部署产物**：此前部署过的 `dist` 若仍在线，页面与 RSS/search-data 仍可访问，直到下一次部署覆盖；缓存与搜索索引可能保留更久。
3. **第三方读取**：仓库若为公开，任何克隆者已可取得旧数据；这与「线上是否可访问」是两件事，需分开评估。
4. **Memos 语义**：UNLISTED 在 Memos 里「不列出但可凭链接访问」。若业务上认为 UNLISTED 等同可公开，需显式配置放开，**默认不放**。

## 5. 部署提示：旧分页 URL 会 404（2026-11-26 由筑成补记，知行要求）

**本节是筑成按知行要求补记的实测记录，不改动上文知行的原始结论。**

**事实：页面数不是「未变」，而是「只减不增」。** 用同一份 `node_modules` 分别构建基线 `128e6a9` 与本分支（`feat/data-modular-pilot`），对比 `dist/` 下的 HTML 与 URL 集合：

| 口径 | 基线 `128e6a9` | 本分支 | 差 |
| --- | --- | --- | --- |
| `dist/` 下 `*.html` 文件数 | 2231 | 2174 | −57 |
| 同上，不计 `404.html`、`500.html`、根 `index.html`（构建日志口径） | 2228 | 2171 | −57 |
| 只在基线里存在的 URL | — | — | 57 |
| 只在本分支里存在的 URL（新增路由） | — | — | **0** |

57 个消失的 URL 全部是分页末尾页，来源与隐私过滤直接相关（非公开 Memos 被剔除后，总页数变少）：

| 路由 | 数量 | 基线上的旧 URL |
| --- | --- | --- |
| 首页分页 `/` | 23 | `/393/` … `/416/`（区间内共 24 个，其中 `/404/` 是既有 404 页，两版都在，不计入） |
| `/now/` 分页 | 16 | `/now/179/` … `/now/194/` |
| `/timeline/memo/` 分页 | 18 | `/timeline/memo/212/` … `/timeline/memo/229/` |
| 合计 | 57 | — |

复现（在仓库根执行；基线检出放 `/tmp`，不进仓库）：

```bash
# URL 集合对比（把 .html 还原成目录式 URL）
find dist -name '*.html' | sed 's|^\./||; s|\.html$||; s|/index$|/|' | sort > /tmp/branch-urls.txt
# 基线：在 128e6a9 的独立检出里跑同一条命令，输出 /tmp/base-urls.txt
comm -23 /tmp/base-urls.txt /tmp/branch-urls.txt | wc -l   # 只在基线的：57
comm -13 /tmp/base-urls.txt /tmp/branch-urls.txt | wc -l   # 只在本分支的：0
```

**上线影响（已知，交部署与运维角色核验）：**

- 这 57 个旧分页 URL 上线后返回 404，**本分支没有做重定向**（`astro.config` 与 `public/` 均未新增规则）。
- 属于隐私过滤的**预期结果**：总条数变少，末尾分页自然消失；不是渲染或分页逻辑出错。
- **不建议用「空页兜底」**（把这些 URL 渲染成 200 的空列表页）：那会把本该消失的页面变成 200 空页，既误导用户，也让搜索引擎继续收录无内容 URL，还掩盖真实 404。
- 若需要保留搜索权重，可选做法是 301 到各栏目第一页或对应栏目首页，但**要不要做、怎么做由主负责人/老板定**，本轮不实施（属对外发布行为，需授权）。
- 已知效应仅限这 57 个 URL；其余 URL（含 `/reading/18`、329 个时间线页面）集合与基线一致。


## 6. 补记：两处「默认放行」已按规范改正（2026-11-26，筑成）

| 位置 | 改前 | 改后 | 影响 |
| --- | --- | --- | --- |
| `scripts/sync-data.mjs` `gtsStatusToMemo`（Memos 来源映射） | `String(status.visibility \|\| 'public').toUpperCase()` —— 上游没给 visibility 时兜底成 `PUBLIC`，被下游放行 | `normalizeMemoVisibility(status.visibility)` —— 缺字段/非字符串/空白一律落成 `''`（= 非公开） | 无 visibility 的记录不再进入 `src/data/memos.json`，因此也不再进入 `/now/`、`/timeline/memo/`、搜索与 RSS |
| `src/api/store.ts` `isPublishableNeodbMark`（NeoDB 标记） | `Number(m.visibility ?? 0) === 0` —— 缺字段当成 0（public）而放行 | 只认数字 `0` 或数字字符串 `'0'`；缺字段、`null`、空白、布尔、数组、对象、1/2 一律不发布 | 当前 `neodb.json` 1035 条全部显式 `visibility: 0`，页面条数与 URL 均无变化；仅关闭了未来缺字段时默认公开的路径 |

同批检查过的其它来源，**未发现同类兜底**：Ghost tag/author 的 `visibility` 只做 `=== 'public'` 正向筛选（缺失即不展示，fail-closed）；NeoDB 条目裁剪（`trimNeodb`）原样透传字段、不做默认值。

已加单测（`yarn test` 全绿）：`tests/scripts/privacy.test.ts` 的「来源映射不兜底公开（scripts/sync-data.mjs）」5 条，`tests/api/privacy-store.test.ts` 的「store 只展示明确公开的 NeoDB 标记」3 条。
