# PC 状态 WebSocket 后端改造 Handoff

> 日期：2026-08-10  
> 面向：HAPI / PC 状态后端 Agent  
> 状态：后端已部署，Astro 前端已完成迁移

## 实施结果

- HAPI 已下发 `app: { id, title, url, action }` 或 `app: null`；
- 新 WebSocket 连接已能立即收到当前状态快照；
- Astro 前端已改为只消费 `app` 字段；
- `public/app.json` 和 `src/config/apps.ts` 已删除；
- 前端不再获取或判断白名单。

## 目标

让 HAPI 成为 PC 状态白名单判定和应用元数据的唯一权威来源。

后端应在广播 WebSocket 消息前完成应用识别和白名单过滤，并把标准化后的完整应用信息放进消息。Astro 前端后续只负责展示，不再请求白名单、不再维护 `app.json` 或本地应用清单。

## 当前接口

- 白名单：`GET https://hapi.190102.xyz:4433/pc-update?action=whitelist`
- WebSocket：`wss://hapi.190102.xyz:4433/ws/pc-status`

白名单接口当前返回以应用 ID 为键的对象，例如：

```json
{
  "centbrowser": {
    "title": "Cent Browser",
    "url": "chrome.png",
    "action": "冲浪"
  }
}
```

## 当前问题与实测证据

WebSocket 当前广播的是原始窗口信息，没有提供可直接展示的标准化应用信息。

切换到 Cent Browser 时实测收到：

```json
{
  "type": "current_process",
  "timestamp": "",
  "process": "",
  "title": "只是玩玩 | 今天该把哪颗灯泡扭进脑袋...? - Cent Browser",
  "media": ""
}
```

另外还收到过不在白名单中的：

```json
{
  "type": "current_process",
  "timestamp": "",
  "process": "",
  "title": "PixPin",
  "media": ""
}
```

这迫使前端重复承担以下职责：

1. 获取并缓存白名单；
2. 从完整窗口标题中识别应用；
3. 过滤未知应用；
4. 根据应用 ID 查找图标和展示文案。

这些职责应归后端所有。

## 已确认的职责边界

### 后端负责

- 维护和读取白名单；
- 把原始 `process` / 窗口标题解析为标准化应用 ID；
- 过滤不允许的应用；
- 从服务端白名单填充可信的 `title`、`url`、`action`；
- 广播可直接供前端渲染的消息；
- 向新 WebSocket 连接立即发送当前状态快照；
- 在切换到未知应用时发送明确的“清空状态”消息。

### 前端负责

- 根据后端消息显示或隐藏状态图标；
- 拼接图片 CDN 地址并执行进退场动画；
- 不再自行判断应用是否获准；
- 不再请求白名单接口；
- 不再维护 `public/app.json` 或 `src/config/apps.ts`。

## 推荐 WebSocket 协议

### 允许展示的应用

建议新增 `app` 字段作为规范数据，同时暂时保留旧字段以便分阶段发布：

```json
{
  "type": "current_process",
  "timestamp": "2026-08-10T08:00:00.000Z",
  "process": "centbrowser",
  "title": "Cent Browser",
  "media": "",
  "app": {
    "id": "centbrowser",
    "title": "Cent Browser",
    "url": "chrome.png",
    "action": "冲浪"
  }
}
```

字段约束：

| 字段         | 说明                                                   |
| ------------ | ------------------------------------------------------ |
| `type`       | 固定为 `current_process`                               |
| `timestamp`  | 优先使用有效上报时间；为空时由服务端生成 ISO 8601 时间 |
| `process`    | 兼容字段，值改为标准化应用 ID，而不是原始进程名        |
| `title`      | 兼容字段，值改为白名单中的展示标题                     |
| `media`      | 保留现有语义；没有内容时为空字符串                     |
| `app.id`     | 白名单对象的键，例如 `centbrowser`                     |
| `app.title`  | 只取服务端白名单中的值，不信任客户端上报值             |
| `app.url`    | 图标文件名，例如 `chrome.png`                          |
| `app.action` | 展示动作；没有时为空字符串                             |

### 未允许、无法识别或没有活动应用

不能简单地“不广播”。否则用户从允许应用切到未知应用时，浏览器会永久保留旧图标。

应广播明确的清空消息：

```json
{
  "type": "current_process",
  "timestamp": "2026-08-10T08:00:05.000Z",
  "process": "",
  "title": "",
  "media": "",
  "app": null
}
```

`app: null` 是规范清空信号。旧字段保持为空，以便旧前端也能隐藏状态。

## 应用识别规则

建议将识别逻辑集中为一个无副作用的领域函数，例如：

```text
resolveWhitelistedApp(rawStatus, whitelist) -> app | null
```

按以下顺序匹配：

1. 标准化原始 `process`：去首尾空格、转小写；
2. 优先用完整进程名精确匹配白名单键；
3. 未匹配时，再尝试进程文件名和不带 `.exe` 的文件名；
4. `process` 为空或未匹配时，使用窗口标题：
   - 与白名单 `title` 忽略大小写精确匹配；
   - 或以 `" - <白名单 title>"` 结尾；
5. 标题匹配时按白名单标题长度从长到短尝试，避免短名称抢先命中；
6. 仍无法匹配则返回 `null`。

Cent Browser 的必要回归样例：

```text
输入 process: ""
输入 title: "只是玩玩 | 今天该把哪颗灯泡扭进脑袋...? - Cent Browser"
结果 app.id: "centbrowser"
```

微信的必要回归样例：

```text
输入 process: ""
输入 title: "微信"
结果 app.id: "wechat" 或服务端明确指定的唯一规范 ID
```

如果 `wechat` 与 `weixin` 都存在，请在服务端确定唯一规范 ID；不要让对象遍历顺序决定结果。

## 白名单数据要求

- `pc-update?action=whitelist` 使用的数据存储应与 WebSocket 解析器使用同一份权威数据；
- 后端内部不要通过 HTTP 请求自己的公开接口，直接复用存储层或服务层；
- 白名单更新后，新状态消息应立即使用新数据，不要求重启服务；
- 服务端只使用白名单中的 `title`、`url`、`action` 构造公开消息；
- 不要把上报请求中的 API Key、原始敏感参数或未过滤元数据广播给前端。

## 当前状态快照

新 WebSocket 连接建立后，后端应立即发送最近一次规范化状态：

- 最近状态允许展示：发送带完整 `app` 的消息；
- 最近状态未知、已清空或尚无状态：发送 `app: null`。

这可以解决用户首次打开页面时必须等待下一次 PC 切换才看到图标的问题。

后端保存的应该是规范化后的公开消息，而不是带凭据的原始上报请求。

## 发布顺序

为避免前后端协议切换期间中断：

1. 后端先发布带 `app` 的新消息，同时保留规范化后的 `process`、`title` 兼容字段；
2. 用真实 Cent Browser、微信、未知应用验证 WebSocket 输出；
3. 再修改 Astro 前端，改为只消费 `app`；
4. 前端发布后删除 `public/app.json`、`src/config/apps.ts` 和白名单 HTTP 请求；
5. 确认旧客户端不再需要兼容后，后端可在后续版本评估是否删除旧字段。

## 后端测试要求

至少覆盖以下公开行为：

1. `process` 精确命中白名单时返回完整 `app`；
2. `process` 大小写不同仍能命中；
3. `process` 为空、窗口标题以 ` - Cent Browser` 结尾时命中 `centbrowser`；
4. 窗口标题精确等于 `微信` 时命中确定的规范 ID；
5. 未知应用（例如 `PixPin`）广播 `app: null`；
6. 从允许应用切换到未知应用时一定产生清空帧；
7. `app.title/url/action` 来自服务端白名单，而不是客户端伪造值；
8. 白名单更新后下一条状态立即使用更新后的配置；
9. 新 WebSocket 连接立即收到当前状态快照；
10. 多个 WebSocket 客户端收到相同的规范化消息；
11. 消息中不包含 API Key 或其他鉴权信息。

## 验收示例

监听：

```bash
npx wscat -c 'wss://hapi.190102.xyz:4433/ws/pc-status'
```

切换到 Cent Browser 后，应收到：

```json
{
  "type": "current_process",
  "process": "centbrowser",
  "title": "Cent Browser",
  "media": "",
  "app": {
    "id": "centbrowser",
    "title": "Cent Browser",
    "url": "chrome.png",
    "action": "冲浪"
  }
}
```

切换到不在白名单中的 PixPin 后，应收到：

```json
{
  "type": "current_process",
  "process": "",
  "title": "",
  "media": "",
  "app": null
}
```

随后重新建立 WebSocket 连接，应立即收到最近一条状态，而不是等待 PC 再次切换。

## 完成定义

以下条件全部满足后，后端改造才算完成：

- 白名单解析只存在于后端；
- WebSocket 消息包含可信的完整应用展示数据或明确的 `app: null`；
- Cent Browser 的真实窗口标题能识别为 `centbrowser`；
- 未知应用会清除旧状态；
- 新连接能立即获得当前快照；
- 回归测试覆盖上述行为；
- 新协议已部署，并保留兼容字段供前端平滑迁移。
