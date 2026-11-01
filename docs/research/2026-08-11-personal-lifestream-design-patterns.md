# 个人 Lifestream / Activity Feed 首页设计模式调研

> 日期：2026-08-11  
> 问题：一个同时聚合 Ghost 长文、Memos 短帖及图片、NeoDB 影音书记录、Strava 活动的窄栏 Astro 首页，怎样既保持统一，又不落入「裸文本拼盘」或「所有内容套同一张卡」的割裂感？

## 结论

推荐采用 **「日期章节 + 开放式条目 + 类型化内容块」**：统一的是时间、左侧基线、间距、元信息位置和链接反馈；变化的是条目内部的内容句法，而不是四套外框。长文用标题与摘要，短帖用正文与自适应图片，NeoDB 用小封面与评分行，Strava 用一行紧凑指标。条目之间用细分隔线或日期留白，不使用四个相同的有底色圆角卡。

这比统一卡壳更能解决当前问题：卡壳只统一了轮廓，却把不同信息量强行做成同样大小、同样层级的「组件实例」，重复的来源头、边框、阴影持续提醒读者内容来自四套模板；日期章节方案把**时间序列**变成主结构，把**类型差异**限制在内容最需要不同的局部。Simon Willison、Adactio、Daring Fireball 都证明了：共享排版与分隔即可形成整体，不必共享容器造型。[S1][S2][S6]

## 对比矩阵

| 案例 | 组织方式 | 共享语法 / 类型变化 | 卡片 | 最值得借鉴 | 主要风险 |
|---|---|---|---|---|---|
| Simon Willison | 单一倒序混合流 | 同宽、同分隔、同页脚；文章/链接/引用/发布记录各有句法 | 基本无 | 「统一节奏，不统一轮廓」 | 超长条目会吞没后续内容 |
| Jeremy Keith / Adactio | 按日分组的混合流 | 同一 `h-entry` 与时间页脚；长文、短记、照片自然展开 | 无 | 日期是章节，不是每条重复的徽章 | 首页全文过长、标签过密 |
| Aaron Parecki | 多类型倒序流 | 同卡壳；签到、照片、事件、文章内部高度定制 | 有 | 类型变化应由内容模型驱动 | 正是「统一卡」易模板化的反例；高频类型淹没其他内容 |
| Tantek Çelik | 极简倒序流 | 几乎全是文本行；回复上下文、观看、喜欢等靠语言/符号变化 | 无 | 最低限度的外壳也能表达异质行为 | 密度高、类型辨识过度依赖文字与符号 |
| Jamie Tanna | 多 kind 倒序流 | 每条固定 kind 标签、正文、统一元信息；引用内容可折叠 | 轻分隔 | 明确的类型标签和渐进披露 | 自动活动连发造成单一类型刷屏 |
| Daring Fireball | 按日混排文章与链接帖 | 链接帖用 `dt/dd`，长文用文章标题；共同字体和日期带 | 无 | 链接目的地与站内永久链接可分工 | 外链标题与永久链接的行为需清楚标示 |
| Robb Knight | 首页分区而非全混流 | Posts / Links / Projects 各自语法，列表以点线连接日期 | 仅项目图块 | 当来源频率悬殊时，分区比硬混排更稳 | 失去严格的全站单一时间线 |
| Maggie Appleton | 花园式内容分区 | Essay、Note、Pattern、Library 各有语义和媒介比例 | 局部使用 | 用「内容承诺」而非平台名解释类型 | 非时间流；视觉素材成本高，不宜直接照搬 |

## 案例分析

### 1. Simon Willison：同一流中的多种排版句法

- **现场**：https://simonwillison.net/ ；**源码**：https://github.com/simonw/simonwillisonblog ，混合流模板见 https://github.com/simonw/simonwillisonblog/blob/main/templates/includes/blog_mixed_list.html ，样式见 https://github.com/simonw/simonwillisonblog/blob/main/static/css/all.css 。[S1]
- **共享与变化**：所有条目占同一主栏、使用相同底部分隔和日期/标签页脚；`entry` 有标题、摘要和字数入口，`blogmark` 以外链标题开头，`quotation` 使用引用排版，`note` 直接显示正文，软件发布/外部动态又使用紧凑的 label + title + meta 行。类型变化发生在信息结构，不发生在外框。[S1]
- **时间与来源**：条目页脚提供永久链接、日期/时间、标签；顶部提供 Entries / Links / Quotes / Notes / Elsewhere 分类入口。它强调「这是我的站内内容类型」，而不是每条重复平台品牌。[S1]
- **媒体与密度**：图片、视频限制在栏宽内；长文只给首段/截断，引用和链接帖字号略小，软件发布更紧凑，因此同一流内存在有意义的密度梯度。[S1]
- **链接/悬停**：标题承担主操作，`#` 或日期承担站内永久链接；不是整条可点击。这样正文中的链接仍保持独立语义。[S1]
- **移动端**：源码在 800px 以下把主栏改为 100%、侧栏移至其后，并显示移动日期；不是缩小卡片，而是重排页面结构。[S1]
- **避免**：不要把完整长文无限铺开；也不要复制过多标签，否则窄栏页脚会比正文更吵。

### 2. Jeremy Keith / Adactio：以「日」做章节

- **现场**：https://adactio.com/ ；站点未发现公开的完整源码仓库，作者的一方 GitHub 主页为 https://github.com/adactio 。[S2]
- **共享与变化**：首页先以 “Monday, August 10th, 2026” 这样的日标题分组，再放多个 `article.h-entry`。Journal 有标题和正文，Notes 可只有短文或照片；它们共享正文宽度、段落节奏和底部时间元信息，不共享卡片背景。[S2]
- **时间与来源**：日期只在组标题出现一次，条目页脚仅保留具体时刻；顶部另有 Journal / Links / Articles / Notes 分类及活动量 sparkline。来源是站内内容分类，不用平台图标反复占据首行。[S2]
- **媒体**：照片使用响应式 `srcset`，单图可满栏，多图为简单网格；图像参与正文流，不被固定缩略图槽裁成同一种比例。[S2]
- **密度与链接**：长文当前会在首页完整展开，标题和时间分别链接到永久地址；普通文本链接按传统下划线/颜色行为工作，没有整条覆盖式链接。[S2]
- **移动端**：活动概览在窄屏变成表格式行，主内容本身保持单栏，媒体 `max-width: 100%`；宽屏才启用更复杂的页栏布局。[S2]
- **避免**：本项目每页 10 条时不应照搬「全文全部展开」；Ghost 仅显示摘要，否则一个长文即可占满一页。

### 3. Aaron Parecki：统一外壳可以容纳差异，但也会暴露其代价

- **现场**：https://aaronparecki.com/ ；未发现该站完整公开源码，作者的一方 GitHub 主页为 https://github.com/aaronpk 。[S3]
- **共享与变化**：所有活动进入同一 `.content-area` 白色圆角描边壳；但签到有头像、地点和可选照片，照片帖以大图为主，文章字号更大，事件/统计类有专用内部模块。即：真正有效的仍是内部类型模板，不是统一边框。[S3]
- **时间与来源**：底部 `metaline` 放永久链接时间、天气/地点、同步目的地等；当前首页大量签到直接按精确时间倒序。[S3]
- **媒体**：单图满宽，多图根据 2/3/更多张使用不同比例拼贴，而不是都塞进固定 16:9 横幅。[S3]
- **链接/悬停**：地点、图片、时间各自可点击；正文保持多个链接目标。并未把整个卡片变为一个大链接。[S3]
- **移动端**：687px 以下让 feed 向屏幕边缘延伸，移除左右边框与圆角，形成 edge-to-edge 内容；这比在手机继续堆悬浮卡更节省宽度。[S3]
- **避免**：当前页面连续大量 check-in，清楚展示高频来源可淹没其他类型；静态聚合页应考虑同类连续 3 条后的压缩/合并。其统一圆角卡也正说明：只统一壳会显得像产品 feed，而不像书页。

### 4. Tantek Çelik：用语句本身表达行为

- **现场**：https://tantek.com/ ；站点说明其发布系统为 Falcon：https://indieweb.org/Falcon ，作者的一方代码主页为 https://github.com/tantek 。[S4]
- **共享与变化**：主流是无卡片的有序列表；普通笔记、回复、likes 合并行、观看记录、比赛记录都采用同一文本基线。回复在正文前明确 “In reply to…”，观看记录由动词与内容开头表达，海报按需内嵌。[S4]
- **时间与来源**：每项尾部都是站内永久链接时间和日期；互动对象链接到原站。没有来源 icon 条，但上下文链接本身说明来源。[S4]
- **媒体与密度**：媒体只在有证据价值时出现；likes 等低价值活动会按日压成一句，而不是每个动作一张卡。[S4]
- **链接/悬停**：内容中的对象链接与底部永久链接分开；传统链接行为，没有整行 hover 面板。[S4]
- **移动端**：默认就是单栏；40em 以上才渐进增强为 62% stream + 33% aside，因此小屏不是桌面布局的缩水版。[S4]
- **避免**：符号/emoji 不能成为唯一类型编码；对本项目应使用可读的中文动词（“看过”“读完”“跑了”）并保留无障碍文本。

### 5. Jamie Tanna：显式 kind 标签与折叠上下文

- **现场**：https://www.jvt.me/ ；**站点设计源码**：https://gitlab.com/jamietanna/www.jvt.me-theme ，feed 模板见 https://gitlab.com/jamietanna/www.jvt.me-theme/-/blob/main/layouts/index.html 、类型标签见 https://gitlab.com/jamietanna/www.jvt.me-theme/-/blob/main/layouts/partials/kind.html 、feed 样式见 https://gitlab.com/jamietanna/www.jvt.me-theme/-/blob/main/assets/scss/www.jvt.me/_feed.scss 。[S5]
- **共享与变化**：每项共享分隔、kind 行、正文和 post-meta；Article、Note、Bookmark、Repost、Listen 的内容模板不同。外部条目的摘要和封面放在原生 `details` 中，可渐进披露。[S5]
- **时间与来源**：kind 由图标+文字同时表达，时间永久链接位于底部；引用对象显示标题和作者，来源不是只有 favicon。[S5]
- **媒体与密度**：文章可有 featured image，listen/bookmark 引用可带外站封面；元信息字体略小。当前首页连续多个 Listen，且 `details` 默认 open，页面密度明显失衡。[S5]
- **链接/悬停**：类型、对象、永久链接分别可点击；没有整卡单链接。
- **移动端**：主容器按断点改变最大宽度，feed 始终单列；这是窄主栏可直接借鉴的稳定模型。[S5]
- **避免**：`details` 应默认关闭或只在短内容时展开；高频自动日志必须限量或合并，否则类型标签也救不了信息噪声。

### 6. Daring Fireball：两种主链接目的地，共享一张“纸”

- **现场**：https://daringfireball.net/ ；未提供公开站点源码。[S6]
- **共享与变化**：同一首页按日标题分组。链接帖使用 `dl.linkedlist` 的标题/正文结构，标题直达外站，旁边星号链接到站内永久页；长文则用更大的文章标题和完整正文。二者共享字体、栏宽、日期带和留白，没有卡片。[S6]
- **时间与来源**：日期是组标题；链接来源在正文自然引用。星号是稳定的站内 permalink 机制，但符号含义需要 `title`，不宜在新设计中无解释照搬。[S6]
- **媒体与密度**：以文字为主，引用用 blockquote；长文与短链接通过标题尺寸和段落长度自然形成密度差。
- **链接/悬停**：标题目的地因类型不同，这是其最鲜明也最容易误触的设计。项目若采用，Ghost 标题应进站内文章；NeoDB/Strava 标题可直达原站，同时给日期一个站内/原动态的明确入口。
- **移动端**：响应式样式压缩导航和边距，保持单一阅读列；内容不依赖横向卡片组件。[S6]
- **避免**：不要让不同类型的标题在无外链标记时产生不同目的地；可用 `↗` 或“在 NeoDB 查看”的可见/辅助文本消除歧义。

### 7. Robb Knight：当全混流不再有利时，改用首页分区

- **现场**：https://rknight.me/ ；**源码**：https://github.com/rknightuk/rknight.me ，首页模板 https://github.com/rknightuk/rknight.me/blob/main/src/pages/index.njk ，列表样式 https://github.com/rknightuk/rknight.me/blob/main/src/assets/css/components/_entryitem.css 。[S7]
- **共享与变化**：首页不强求一条总时间线，而把 Posts、Links、Projects 分区。Posts/Links 都使用“标题 — 点线填充 — ISO 日期”的轻列表；Projects 才使用有背景图的图块。卡片只给真正视觉化的项目，而不是给所有内容。[S7]
- **时间与来源**：日期稳定地右对齐，点线把标题与日期在窄栏中绑定；外链加 `↗`，站内日期仍可进入 link 的永久页。[S7]
- **媒体与密度**：文字列表高密度，项目图低密度；首页先展示摘要集合，再去独立栏目看完整流。
- **链接/悬停**：仅标题和日期是链接，不把空白区域变成点击面。
- **移动端**：项目网格在 650px 以下从三列改为一列；文字列表的三列 grid（标题/填充线/日期）可自然收缩。[S7]
- **避免**：若产品目标明确要求严格 chronological pagination，就不能完全改成分区首页；但可把它作为“同日同源连续项折叠”的局部策略。

### 8. Maggie Appleton：按内容承诺划分，而不是按数据供应商划分

- **现场**：https://maggieappleton.com/ ；公开仓库：https://github.com/MaggieAppleton/maggieappleton.com 。当前线上为 Astro 输出，但公开仓库默认分支与线上构建可能不同步，因此源码仅作版本相关参考。[S8]
- **共享与变化**：首页明确解释 Essays 是有立场的长文、Notes 是尚未完全理解的松散笔记、Patterns 是观察研究、Library 是读过/想读的书。每区使用不同呈现：essay 大图、note 紧凑行、pattern 图标条、book 封面。[S8]
- **时间与来源**：它不以时间为主，也不突出平台来源；核心标签说明读者将获得什么。这对本项目的启发是把 “Ghost / Memos / NeoDB / Strava” 改写为 “文章 / 随记 / 书影音 / 运动”，平台名退到次级元信息。
- **媒体与密度**：媒体比例服从对象：essay 插画为方图，书籍保持 2:3 封面；移动端有 768px/576px 的边距调整，网格按可用宽度收缩。[S8]
- **链接/悬停**：卡片内部有局部图片缩放/外链提示，卡片本身按内容类型设计，而非一个通用万能卡。
- **避免**：不要把其多栏视觉花园直接塞入本项目的窄主栏；也不要为每条 Ghost/Memo 人工制作插画。应借其“语义分型”，不借其首页版式。

## 三个可实施方向

### 方向 A（推荐）：日期章节 + 开放式类型块

**骨架**

```text
8 月 11 日 周二
────────────────────────
文章  重新设计我的首页                         10:20
      2 行摘要……                          阅读全文 →

随记  今天终于……                              09:05
      [自然比例单图 / 最多 2×2 图组]

看过  [2:3 小封面]  电影名                 ★ 8/10
      “三行以内短评……”                         00:12

跑步  河边慢跑                                  07:30
      6.21 km  ·  34:12  ·  5′30″/km  ·  ↑42 m
```

- 每个日期只显示一次；同日条目用 `row-gap` 和细线组织，跨日用更大留白。
- 统一：`article` 左边界、元信息字号、标题字重、时间右对齐、分隔线、焦点样式。
- 变化：四种 body 模板；**没有统一背景、圆角、阴影和固定高度**。
- 类型首词用中文语义标签（文章、随记、看过/读过、跑步），平台名放到次级链接或 `aria-label`，图标可选且保持单色 `currentColor`。
- Ghost：标题 + 2–3 行摘要 + “阅读全文”；Memos：正文 + 自然比例媒体；NeoDB：64–72px 宽 2:3 封面 + 评分 + 3 行短评；Strava：名称 + 一行可换行指标，地图若无静态图则不预留空槽。
- hover 仅作用于真实链接（标题、日期、图片），不让整条变色；键盘焦点使用 `outline: 2px solid var(--color-link)`。
- 移动端日期标题保持，时间可移到类型标签同行末端；NeoDB 封面缩至 56–64px；Strava 指标允许 2×2 换行；图片满栏。无需 JS。

**为何最适合**：主栏窄、外侧已有书页式三栏，开放式条目会继续像“书页上的边注与段落”，而不是在书页里再堆一个产品 dashboard。每页固定 10 条时，日期组也不会产生无限长页面。样式只需现有 CSS 变量：正文/背景继续用 `--body-font-color`、`--body-background`，分隔和次级文本用 `--gray-*`，交互用 `--color-link`；不需要为每个主题硬编码卡片底色。

### 方向 B：编辑部式“主次版面”

- 保持全局倒序，但把 Ghost 视为“feature”：标题、摘要和可选头图占完整栏宽；随后连续出现的轻活动（Memo、NeoDB、Strava）采用紧凑 ledger 行。
- 若同日连续出现 2–4 条自动日志，用一个带日期的小节容纳，但每条仍独立链接；例如“今日活动”内含看过/跑步两行。不要跨日期合并，也不要隐藏评分/距离等关键数据。
- 优点：长文获得应有的编辑权重，自动日志不与文章争夺同样面积；最不像社交产品卡流。
- 风险：时间排序的视觉权重不再完全中性；必须保证 HTML 顺序仍严格 chronological，视觉强调不能改变阅读顺序。
- 移动端所有内容单列；feature 图变为 `width: 100%`，ledger 的时间移到第二行。

### 方向 C：细时间轨 + 无框内容岛

- 在条目左侧放 1px 时间轨和小刻度；日期为轨道节点，条目内容仍无卡片。
- 类型只通过节点形状/短标签与内部模板区别，禁止四种品牌色竖线。可让 Ghost 节点稍大、Memo 圆点、NeoDB/Strava同尺寸图标，但都使用 `--gray-*` / `--color-link`。
- 媒体可越过正文左边界贴近时间轨，形成“剪贴簿”感；NeoDB 封面和 Memo 图片仍保持各自比例。
- 优点：最明确地把四源统一为“我的生活时间”；比卡片更有 lifestream 身份。
- 风险：窄栏会损失 20–28px；移动端应隐藏竖线或把轨道缩到 12px，不能让正文宽度低于舒适阅读尺度。

## 跨方向的具体规则

1. **统一语法，不统一盒子**：所有类型共享 `<article>`、类型/时间 meta、间距 token、分隔线；body 使用 discriminated template。
2. **平台退后，行为前置**：显示“文章 / 随记 / 看过 / 读过 / 跑步”，必要时次级显示“来自 Memos / NeoDB / Strava”。读者关心内容行为，不关心同步管道。
3. **日期去重**：同日只显示一次完整日期；条目只显示时刻。跨页第一组仍显示完整日期，避免分页后失去上下文。
4. **密度预算**：Ghost 摘要最多 3 行；NeoDB 评论最多 3 行；Strava 指标最多 4 个；Memo 正文可完整显示但图片最多首屏 4 张，其余显示“另有 N 张”。所有裁切均保留详情入口。
5. **媒体按对象比例**：书/电影封面用 2:3；单张 Memo 图按固有比例并设最大高度；多图使用 2×2；运动不凭空造图卡。避免所有媒体统一成 16:9。
6. **链接边界清楚**：不套整条 `<a>`。Ghost 标题进站内正文；Memo 日期去原动态；NeoDB 标题/封面去 NeoDB；Strava 名称或明确的“查看活动”去 Strava。外链统一有文本或 `↗`，不能只靠 hover。
7. **主题安全**：不新增固定浅灰卡底。分隔线可用 `var(--gray-200)`，次级文字用 `var(--gray-700)`，正文/背景使用现有变量；评分星可优先 `var(--color-link)` 或由主题派生的 `color-mix()`，并同时显示数字，不能只靠黄色。
8. **静态实现**：构建期把四源归一为 `kind`, `publishedAt`, `title`, `summary`, `media`, `metrics`, `canonicalUrl`；排序、日期分组、同类连续折叠均在 Astro 构建时完成。10 条静态分页不需要客户端状态或运行时 API。
9. **避免**：四种品牌色、重复头像、每条来源图标底座、统一圆角阴影、整卡 hover 抬升、所有类型同样大的标题、自动日志连发十条、外链目的地不一致却无标识。

## 证据与来源（均为一级来源，访问于 2026-08-11）

- **[S1] Simon Willison**：现场首页 https://simonwillison.net/ ；作者站点源码 https://github.com/simonw/simonwillisonblog ；混合流模板 https://github.com/simonw/simonwillisonblog/blob/main/templates/includes/blog_mixed_list.html ；CSS https://github.com/simonw/simonwillisonblog/blob/main/static/css/all.css 。支持其类型模板、共同分隔/页脚、媒体约束和 800px 移动重排等描述。
- **[S2] Jeremy Keith / Adactio**：现场首页 https://adactio.com/ ；作者代码主页 https://github.com/adactio 。现场 HTML/CSS 明示按日 `<section>`、`article.h-entry`、Journal/Links/Articles/Notes 活动概览、响应式图片与时间页脚。未验证到完整公开站点仓库。
- **[S3] Aaron Parecki**：现场首页 https://aaronparecki.com/ ；作者代码主页 https://github.com/aaronpk 。现场 HTML/CSS 明示 `post-type-checkin` / `post-type-photo` 等类型、统一 `.content-area`、多图布局及 687px 以下去圆角/左右边框。未验证到完整公开站点仓库。
- **[S4] Tantek Çelik**：现场首页 https://tantek.com/ ；作者代码主页 https://github.com/tantek ；其站点所链接的 Falcon 说明 https://indieweb.org/Falcon 。现场 HTML/CSS 明示 `h-entry`、回复上下文、likes 合并、观看/运动文本以及 mobile-first、40em 以上两栏增强。
- **[S5] Jamie Tanna**：现场首页 https://www.jvt.me/ ；设计源码 https://gitlab.com/jamietanna/www.jvt.me-theme ；首页 feed https://gitlab.com/jamietanna/www.jvt.me-theme/-/blob/main/layouts/index.html ；kind partial https://gitlab.com/jamietanna/www.jvt.me-theme/-/blob/main/layouts/partials/kind.html ；feed SCSS https://gitlab.com/jamietanna/www.jvt.me-theme/-/blob/main/assets/scss/www.jvt.me/_feed.scss 。支持 kind 标签、统一 meta、分隔和多种内容 partial 等描述。
- **[S6] Daring Fireball**：现场首页 https://daringfireball.net/ 。现场 HTML/CSS 明示日期 heading、`dl.linkedlist`、外链标题旁永久链接和独立长文块。未提供公开站点源码。
- **[S7] Robb Knight**：现场首页 https://rknight.me/ ；源码 https://github.com/rknightuk/rknight.me ；首页模板 https://github.com/rknightuk/rknight.me/blob/main/src/pages/index.njk ；entry list CSS https://github.com/rknightuk/rknight.me/blob/main/src/assets/css/components/_entryitem.css ；首页响应式项目网格 https://github.com/rknightuk/rknight.me/blob/main/src/assets/css/_home.css 。支持分区、标题—点线—日期语法和 650px 单列项目等描述。
- **[S8] Maggie Appleton**：现场首页 https://maggieappleton.com/ ；公开仓库 https://github.com/MaggieAppleton/maggieappleton.com 。现场页面明确给出 Essays / Notes / Patterns / Library 的内容承诺与不同媒体布局；源码与线上版本可能不同步，故具体线上样式以现场为准。

## 已验证、版本相关与未决问题

- **已验证**：上述现场在调研日的 DOM/CSS 与可见内容；Simon、Robb、Jamie 的相关模板/样式源码；当前项目约束下无需运行时 API 即可完成分组和模板分派。
- **版本相关**：个人首页会随最新活动变化；Aaron/Jamie 当前的“同类刷屏”是调研日快照，不代表永久内容比例。Maggie 的公开仓库默认分支可能落后于线上 Astro 版本。移动分析来自一方 CSS 断点与 DOM，而非多设备视觉回归截图。
- **未决策**：是否允许“同日连续同源 3 条以上”折叠为一组；Memo 多图超过 4 张时是截断还是保持现有最多 9 张；NeoDB 标题主链接直达外站还是先进入本站详情。推荐先实现方向 A，不做跨条目折叠，观察一页 10 条的真实来源分布后再决定。
