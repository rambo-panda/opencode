# OpenCode V2 正式采用审查

**结论：2.0.26 已适合本机 macOS TUI 日常使用；已保留个人改动并完成切换。slim 3.0.3 已发布 V2 适配，但 Interview 等功能仍有限制。**

检查及实施日期：2026-10-09（Asia/Shanghai）。采用结论针对本机 Provider、TUI 和个人工作流；未验证所有桌面平台或付费长任务。

## 1. 稳定版本与基线

| 项目               | 实际核对结果                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| 官方稳定 CLI/SDK   | `@opencode/cli@2.0.26`、`@opencode/plugin@2.0.26`                       |
| 官方更新渠道       | `latest`、`cli`、`npm`，版本 `2.0.26`，active                           |
| 正式标签           | `v2.0.26`，提交 `9b4ec5714d481559990db0a816d5dec19541a814`              |
| 发布源码           | `5e73d5cb1f788637b1b3d5cf1298ea694cbad0c5`，构建 run `37829762115`      |
| 发布时间           | CLI npm：2026-10-08 19:43:12 UTC；版本提交：19:45:43 UTC                |
| 未发布开发进度     | 检查时 `upstream/v2=eefe85d257`，2026-10-09 03:04 UTC                   |
| 原个人分支         | `personal-beta=db8a026f5a`，官方基线 `e5ecb5719d`，保留为备份           |
| 当前分支和运行版本 | `personal-v2`，12 个个人提交重放到正式标签；日常 CLI/Server 均为 2.0.26 |

[官方 V2 安装脚本](https://opencode.ai/v2/install) 通过
[更新 API](https://opencode.ai/update/api/latest/cli/npm) 获取新的 `@opencode/cli` 包。
旧 `opencode-ai` 的 latest 仍为 V1，不能据此判断 V2 未正式发布。
本次使用 [正式标签](https://github.com/anomalyco/opencode/tree/v2.0.26)，对应
[npm CLI 2.0.26](https://www.npmjs.com/package/@opencode/cli/v/2.0.26)。
版本同步提交没有合回 `v2` 开发分支，维护脚本以 HEAD 最近的稳定祖先标签识别基线。

## 2. 重要更新及影响

以下实现已核对进入本次稳定源码：

| 更新                            | 对当前工作流的影响                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 非法工具参数与未完成调用处理    | 更早拒绝异常参数并收束未完成调用，减少非法历史残留。[#53685](https://github.com/anomalyco/opencode/pull/53685) |
| Media.Asset 图片/附件层         | 附件结构变化，需要同步插件；slim 已有相应修复。[#49181](https://github.com/anomalyco/opencode/pull/49181)      |
| Compaction 尊重 agent 模型      | 指定的压缩模型按配置使用，长上下文处理更可控。[#53276](https://github.com/anomalyco/opencode/pull/53276)       |
| 默认 header/chunk 超时 5 分钟   | 慢网关或长生成不再过早触发默认等待期限。[#49229](https://github.com/anomalyco/opencode/pull/49229)             |
| 快照捕获提速及错误处理          | 降低会话步骤中的快照开销。[#51996](https://github.com/anomalyco/opencode/pull/51996)                           |
| Provider policies 进入 settings | 本机配置已按正式布局归一化。[#49666](https://github.com/anomalyco/opencode/pull/49666)                         |
| CLI/服务/插件正式发布渠道       | CLI 有独立包，插件 Server/TUI 分别加载；本地构建不再猜 beta 编号。                                             |
| 新主题接口                      | `base/muted` 取代旧字段，`useTheme()` 不再接收旧参数；个人组件已适配。                                         |

公开但本机未复现的问题包括
[自定义 openai-compatible 长任务 arguments 400 #54025](https://github.com/anomalyco/opencode/issues/54025)、
[旧 agent frontmatter 颜色未兼容 #54057](https://github.com/anomalyco/opencode/issues/54057)。
后者不影响当前 inline agent 配置。Windows desktop 的
[401 报告 #53834](https://github.com/anomalyco/opencode/issues/53834) 未在本机 macOS TUI 验证。

## 3. 个人补丁与官方对照

| 个人改动                                              | 处理决定及具体差异                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| canonical 别名完整继承、源账号凭证清理                | 官方有 canonical 基础，完整目录继承及个人凭证隔离仍需补丁；保留。     |
| 无 Integration 也显示 Provider 名称、按 ID/显示名搜索 | 官方基础选择器仍需个人显示逻辑；保留。                                |
| Enter steer、运行时 Tab FIFO、补全时 Tab 补全         | 复用官方持久化 inbox，保留个人按键习惯。                              |
| 单键中断、保留草稿、继续已接收 FIFO、不重试刚中断消息 | 复用官方 interrupt/resume，保留个人默认行为和守卫。                   |
| 红色中断提示                                          | 保留 `■ Conversation interrupted`，去掉官方重复 inline 提示。         |
| `/delete` 数字确认及忙碌守卫                          | 保留，适配正式主题接口。                                              |
| HTTP body/headers 修改                                | 官方 `http.request` 已覆盖内核需求；使用官方 hook，保留个人回归测试。 |
| 构建 `--only/--outdir` 与目录检查                     | 保留；产物统一为 `opencode`，版本来自正式标签。                       |
| 集中模型能力映射                                      | 适配正式 `ctx.model.transform`，全局/项目显式配置仍优先。             |
| beta 维护入口                                         | 删除 `rebase-beta.sh`，直接使用 `rebase-v2.sh` 跟随稳定发布。         |

以具体源码差异判断保留，不因相同文件或相似 PR 标题误删补丁。ephemeral 仍是观察项，本次未实现。

## 4. slim 已发布适配与残余限制

[oh-my-opencode-slim 3.0.3](https://www.npmjs.com/package/oh-my-opencode-slim/v/3.0.3)
发布于 2026-10-06 19:11:49 UTC，源码 SHA `4733ed77092fa0b0368257aa76d13167dcc7c854`。
V2 入口声明支持 2.0.7+。本次直接审核 npm 发布包，在真实 2.0.26 Server 中验证 active，
并用编译 TUI 验证加载、模型菜单和终端尺寸变化。Server/TUI 均固定同一版本。

旧审查中的 `event.data` 和 user/system/synthetic `message.text` 转换问题已修复。
正式包包含 [Media.Asset 修复 #1463](https://github.com/alvinunreal/oh-my-opencode-slim/pull/1463)、
[soft task steering #1462](https://github.com/alvinunreal/oh-my-opencode-slim/pull/1462)、
[retry hook fallback #1415](https://github.com/alvinunreal/oh-my-opencode-slim/pull/1415)。
**前台 fallback 已用 retry hook 和 switchModel 支持原位切换；禁用的是旧 abort/replay 路径。**
用户原有开关、presets、fallback 模型链和 council 配置已保留，未按过时文档关闭全部 fallback。

| 功能                                  | 确认的限制或验证边界                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Interview 流式/续问桥接               | 发布源码仍监听 `session.next.text.*`，宿主发 `session.text.*`；适配器未映射这组名称，不能认为可靠兼容。                                 |
| `/reflect --sessions`                 | 仍读旧历史结构，[#1475](https://github.com/alvinunreal/oh-my-opencode-slim/issues/1475)；迁移副本保留旧表，但新 V2 会话不持续写入旧表。 |
| Session list/remove、子任务 form 回复 | stock plugin context 未暴露全部方法；子任务提问依赖宿主 UI。                                                                            |
| 多模型 fallback、后台长任务、council  | 源码及适配测试已核对，没有用付费模型做端到端验证。                                                                                      |

Interview 直接证据：
[slim 发布源码](https://github.com/alvinunreal/oh-my-opencode-slim/blob/4733ed77092fa0b0368257aa76d13167dcc7c854/src/v2/interview-bridge.ts#L303) 与
[宿主正式事件](https://github.com/anomalyco/opencode/blob/v2.0.26/packages/schema/src/session-event.ts#L393)。
这些限制不阻止基础 TUI 和普通编码工作流采用 V2；不能把插件 active 解释为全功能等价。
未修改第三方插件，也未用未发布 master 替代稳定包。

## 5. 已完成的切换与验证

- 12 个个人提交 rebase 到正式标签，冲突涉及 Provider 测试、prompt 主题及中断 footer，已逐项适配。
- Frozen lockfile 安装成功，客户端重新生成无净差异。
- Core 125 项、TUI 42 项回归全部通过；根 `bun run check` 通过，36 个类型检查任务成功，lint 零错误。上游 advisory warnings 未扩展修复。
- macOS x64 完整构建通过，包含 Web UI，版本及服务命令正常。
- slim 的 5 个适配测试文件共 204 项通过，含 mock；另以真实宿主验证加载。
- 独立服务验证默认图片/PDF/视频能力、全局显式覆盖、项目覆盖、新增/未知模型及热刷新。
- 修正 47 处旧 tool_call 转换产生的完整能力覆盖，保留 tools-only 声明，避免覆盖个人 PDF/视频映射。
- 本地确定性 HTTP SSE 完成真实持久 prompt、23 个工具的注册和 HTTP body/headers hook，没有请求付费模型。
- 编译 TUI 在 120/70 列 PTY 启动、打开模型菜单和调整尺寸，无运行异常。
- 日常 `opencode` 已部署，后台服务 2.0.26；slim 与个人插件 active，56 个个人模型和全部历史已核对。

实测限制：运行中新增本地插件文件时，两次报模块解析失败，显式 reload 未解决；文件放好后启动新服务，
加载和 HTTP hook 均通过。普通模型配置热刷新正常。日常插件已在服务启动前就位；以后新增插件在空闲时重启。
Web UI 已内嵌，未做浏览器/桌面交互验证；实际图片/PDF 模型内容解析未请求外部模型验证。

### V1 历史完整性

原 `opencode.db` 保持原样；在线备份后只在副本中运行官方迁移，再装为日常 `opencode-local.db`。
此前 local 测试库为空，覆盖前也已备份。

| 核对项     | 结果                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| Session    | 214 个 ID、标题、创建/更新时间和父子关系全部一致                                                 |
| 原 message | 5990 条完整保留，所有公共字段逐条一致                                                            |
| 原 part    | 24791 条完整保留，含 50 条文件附件记录，所有公共字段逐条一致                                     |
| V2 投影    | 6157 条；8 个摘要合并到 compaction、2 个旧 task 包装按官方语义转换，另增加 synthetic/system 记录 |
| SQLite     | quick_check=ok，外键零错误，迁移后 inbox/执行恢复标记均为零                                      |
| 日常读取   | API 列出全部 214 个会话，最早、最新和压缩过的历史可读                                            |

原 message/part 表仍完整保留在迁移副本中，没有因投影合并而删除。
备份在 `~/.local/share/opencode/backups/v2-adoption-20261009-135300/`，含数据库、配置、插件、fish 和旧二进制。
保留备份，V2 库不交给旧版客户端使用。

现在直接运行 `opencode`。已打开的 fish 可执行 `functions -e opencode2` 再
`source ~/.config/fish/conf.d/omf.fish`。维护直接使用 `bin/rebase-v2.sh`；
审查提示改名为 [opencode-v2-review-prompt.md](opencode-v2-review-prompt.md)。本次不推送远端。
