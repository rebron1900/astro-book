# 数字花园部署

## 一次性仓库配置

1. 使用只授权私有仓库 `rebron1900/Obsidian` 的 fine-grained personal access token：Contents 为 Read-only，Metadata 保留 GitHub 要求的 Read-only。
2. `rebron1900/astro-book` → Settings → Secrets and variables → Actions：保存该令牌为 `GARDEN_VAULT_TOKEN`。令牌只能进入 Secret，不能放进代码、Issue、聊天或日志。
3. 保留现有 `CONFIG_FILE`、VPS 和各数据源 Secrets；GitHub 账号连接不等于配置了这些 Secrets。

## 每次部署

工作流安装锁定依赖、准备现有构建环境，然后用只读令牌经 HTTPS 读取私有笔记。
原始仓库仅临时存在于 `.garden/vault`；同步步骤退出时（成功或失败）删除临时认证脚本、原始仓库和拉取日志。
`.garden/`、`public/garden/` 不提交，不上传为 artifact，不单独缓存。

部署前必须依次通过：

- `yarn sync:garden`：按白名单生成公开镜像；CI 不得使用 `--write-published`。
- `yarn check:garden`：拒绝空内容、清单外新增路径或清单中缺失路径。
- `yarn astro check`、`yarn test`。
- 冷构建 `yarn build`，再运行 `yarn check:garden` 检查公开端点及站内链接。

只有上述全部成功，才执行原有 VPS 部署。缺少 Secret、只读拉取失败或任何检查失败，均不部署，线上保留上一版。
既有 VPS SSH 验证策略保持不变；读取笔记使用 HTTPS，不代表已加固 VPS 连接。

需要新增/撤回笔记时，先在本地确认公开范围并处理旧 URL，再人工更新 `src/config/garden-published.json`，审查后提交。
同步或校验只输出必要的统计；不要把原始笔记、私钥或调试日志粘贴到公开 Actions 日志。

## 上线核验

进入 Actions，检查本次提交对应的 CI 运行，确认取数、同步、构建、校验及部署全部成功；随后核对首页和 `/garden/`。
旧花园域名的重定向与服务器配置是独立运维步骤，不会因为本次代码部署自动完成。
