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
| 未发布开发进度     | 最终 fetch 为 `upstream/v2=93a7c8404f`，2026-10-09 04:51 UTC            |
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
备份已移至 `/tmp/opencode-v1-archive-20261009-143532/backups/v2-adoption-20261009-135300/`，含数据库、配置、插件、fish 和旧二进制。
保留备份，V2 库不交给旧版客户端使用。

现在直接运行 `opencode`。已打开的 fish 可执行 `functions -e opencode opencode2 _opencode_run` 再
`source ~/.config/fish/conf.d/omf.fish`。维护直接使用 `bin/rebase-v2.sh`；
审查提示改名为 [opencode-v2-review-prompt.md](opencode-v2-review-prompt.md)。本次不推送远端。

## 配置整理与后续使用

按用户要求，旧 `~/.config/opencode2`、V1 的 `tui.json`、旧 SDK 依赖及相关 fish 文件移至
`/tmp/opencode-v1-archive-20261009-143532/`。日常只有 `~/.config/opencode` 一套 V2 配置。
fish 中的 OpenCode 包装函数和旧插件环境文件均已移除；模型环境放在 V2 原生
`service-local.json.env`，权限 `0600`，不提交凭证。命令入口仅保留外部编辑器的默认环境。
服务在清除模型环境的进程中重启，三个 Provider 的 apiKey/baseURL 均按 native env 正确解析；
56 个模型、两个插件和 214 个历史会话仍正常。原 V1 数据库及 V2 内的原始历史记录未更改。

更新并构建本机最新正式 V2：

```sh
cd /Users/rambo/work_space/opencode-fork
bin/rebase-v2.sh
bun install --frozen-lockfile
bun run check
bin/build-macos.sh darwin-x64 --skip-install
```

构建完成并确认当前任务结束后执行 `opencode service restart`。
日常启动 `opencode`，指定项目用 `opencode /path/to/project`；版本检查用 `opencode --version`。

## 补充核对：界面、skills 与完整个人差异

2026-10-09 再次运行 `bin/rebase-v2.sh`：官方稳定版仍为 2.0.26，没有进行新的 rebase。
比较快照为个人 HEAD `46d0d8b962` 对正式标签 `v2.0.26`；本轮只修改本机 agent 配置及补充文档。

### 实际界面与本机配置

| 项目 | 核对及处理结果 |
| --- | --- |
| 空白首页没有 `/delete` | 首页没有当前会话，命令在 Session 路由注册；用户已确认历史会话中存在。 |
| 历史会话 `/delete` | 日常编译客户端实测补全、数字确认框和 `1` 保留正常；未删除用户历史。15 项个人 TUI 回归通过。 |
| slim 专家不在 `/agents` | 原来六个专家均为 `subagent`，官方选择器只接受主 agent 或 `all`；并非插件未加载或模型丢失。 |
| 直接使用专家 | 原生 `agents` 对 oracle/librarian/explorer/designer/fixer/council 仅配置 `mode: "all"`；同时支持主会话选择和子任务委派。 |
| 配置保全与真实界面 | 六个 agent 除 mode 外的全部 API 字段哈希一致；编译 TUI 实测九个可选 agent、直接选择 Oracle、六个 `@agent` 补全及 `/preset` 入口正常。 |
| skills 目录为空 | slim 3 在 V2 上注册插件包内置技能后，自动清理旧 manifest 管理的磁盘副本；OpenCode V2 仍加载用户自建的 skill/skills 目录。 |
| skills 是否丢失 | 八个内置技能均已从 3.0.3 包加载；旧受 Git 跟踪的 16 个文件与旧 2.2.18 包及归档副本逐字节一致。五个 `~/.agents/skills` 技能也在。 |
| 日常历史与任务 | 补测结束 API 仍为 214 个会话，活动会话为零；没有调用外部付费模型或重启服务。 |

本机 agent 覆盖的结构是：

```jsonc
{
  "agents": {
    "oracle": { "mode": "all" },
    "librarian": { "mode": "all" },
    "explorer": { "mode": "all" },
    "designer": { "mode": "all" },
    "fixer": { "mode": "all" },
    "council": { "mode": "all" }
  }
}
```

原有 explore/general 的 disabled 配置保留；模型、variant、提示词继续由 slim preset 提供。
内置 skills 为 `simplify`、`codemap`、`clonedeps`、`deepwork`、`verification-planning`、`reflect`、
`oh-my-opencode-slim`、`worktrees`。自定义技能仍可放到 `~/.config/opencode/skills/<name>/SKILL.md`。
插件清理及注册的源码证据：[注册入口](https://github.com/alvinunreal/oh-my-opencode-slim/blob/4733ed77092fa0b0368257aa76d13167dcc7c854/src/v2/setup.ts#L2451)、
[受管副本清理](https://github.com/alvinunreal/oh-my-opencode-slim/blob/4733ed77092fa0b0368257aa76d13167dcc7c854/src/cli/custom-skills.ts#L80)。
没有恢复旧副本覆盖新包；配置仓库中 16 个旧副本的删除状态来自插件清理。

### 对官方稳定版的全部差异

该 HEAD 对 `v2.0.26` 共 **28 个文件，+1252 / -104**：运行代码 11 个文件（+180 / -87），
测试 8 个文件（+474 / -17），文档和个人维护脚本 9 个文件（+598 / -0）。

| 运行差异 | 具体保留行为 | 文件 |
| --- | --- | --- |
| Provider 多账号 | legacy id 迁为 canonical；完整模型目录继承；清除源账号三类凭证；保持分层显式名称。 | core/config/normalize.ts、core/config/plugin/provider.ts、core/v1/config/migrate.ts |
| 模型选择器 | 没有 Integration 连接时仍显示 Provider 名称，并按 ID/显示名搜索。 | tui/component/dialog-model.tsx |
| 中断后续执行 | 中断后继续已接收 FIFO；没有待处理输入时不重试刚中断的消息；Protocol 改动仅为说明文字。 | core/session/execution.ts、protocol/groups/session.ts |
| 输入与中断提示 | Enter 复用官方 steer；运行时 Tab FIFO、补全时仍补全；单次 Ctrl+C/Esc 中断保留草稿；红色中断行。 | tui/component/prompt/index.tsx、tui/config/keybind.ts、tui/routes/session/index.tsx |
| `/delete` | 当前会话的 1/2 确认；拒删活动会话、活动子任务和待处理 inbox；成功返回首页。 | tui/component/dialog-session-delete.tsx、tui/routes/session/index.tsx |
| 构建参数 | 保留多目标 `--only`；官方 `--outdir` 上增加禁止祖先目录及先验证目标再清空目录的检查；统一命令名。 | cli/script/build.ts |

上表省略了共同前缀 `packages/<包>/src/`；构建文件实际为 `packages/cli/script/build.ts`。
官方历史 [PR #39750](https://github.com/anomalyco/opencode/pull/39750) 曾实现 `/delete`，
但该命令不在当前稳定源码及最新开发源码中；个人补丁仍有实际差异，不能依据旧 PR 合并状态删除。

八个测试文件：

```text
packages/core/test/config/normalization.test.ts
packages/core/test/config/provider.test.ts
packages/core/test/session-execution.test.ts
packages/core/test/session-model-request-hooks.test.ts
packages/tui/test/cli/tui/prompt-interrupt-status.test.tsx
packages/tui/test/config-v2.test.tsx
packages/tui/test/model-alias.test.tsx
packages/tui/test/session-personal.test.tsx
```

九个文档/脚本文件：

```text
AGENTS.md
PERSONAL.md
bin/build-macos-arm64.sh
bin/build-macos-x64.sh
bin/build-macos.sh
bin/plugins/inherit-models.js
bin/rebase-v2.sh
opencode-v2-adoption.md
opencode-v2-review-prompt.md
```

本机配置、fish 和数据库的迁移不属于 Git 补丁；其实际结果在前文记录。
本轮补齐的原生 agent mode 覆盖也仅在本机配置中，不需要修改 fork 的选择器或第三方插件。

### 旧个人改动：保留、替代与未迁入

`git range-diff e5ecb5719d..personal-beta v2.0.26..46d0d8b962` 确认旧 beta 的 12 个个人提交全部保留，
其中主题、Provider 测试和构建上下文做了必要适配；正式采用及配置整理另有两个提交。

| 旧改动 | 当前结果 |
| --- | --- |
| Provider 别名、默认名称、构建参数 | 保留，并适配 V2 原生字段与包目录。 |
| `llm.request.before` 内核补丁 | 改用官方 `http.request`，保留 body/headers 回归；旧接口名不再提供。 |
| 集中模型输入能力映射 | 迁到原生 `ctx.model.transform`；维护文件为 `bin/plugins/inherit-models.js`，已部署全局副本。 |
| models.dev DNS 绕过和构建时抓取目录 | 没有照搬。正式 V2 在 core/models-dev.ts 内嵌受版本控制的 snapshot，构建不再依赖旧在线抓取步骤。 |
| 构建时同步 Git/beta 版本推导/opencode2 名称 | 改为独立 `rebase-v2.sh`、最近稳定标签和统一 opencode；local 数据渠道保留。 |
| 旧 V1 曾加入后回退的鼠标滚动、TUI 执行、delete 提交 | 不能按历史提交数认定有效改动。当前个人 V2 明确保留上述输入/中断/delete；滚动沿用官方实现。 |
| `debug_timer_cost` 的额外 logger/启动耗时补丁 | 在另一个保留分支，未合入选定的 personal-beta，因此未迁入 personal-v2；不是本次 rebase 漏掉的提交。 |
| 原生专家 agent 的直接选择覆盖 | 本轮补齐六个 mode: all。 |
| ephemeral | 一直仅为待办，当前未实现。 |

### 对最新远程开发分支的区别

本轮 fetch 的官方 `upstream/v2` 为 `ee0e614221`；共同发布源码祖先为 `5e73d5cb1f`。
从该源码到开发 tip 有 23 个提交（含一个同步版本提交）；标签与开发分支的完整树比较为
152 个文件、+2988 / -2612，不能将这批官方未发布变化算成个人补丁。

这些变化主要涉及子任务通知的 Location 淘汰恢复、Vertex Mistral/思考 variants、worktree 工具迁入 Core、
Web PWA、timeline 文件链接/完整工具错误、桌面冷启动及浏览器面板。
TUI 执行错误行的加入和随后回退须看最终源码；当前个人字段、agent 过滤和 delete 入口没有被这批变化完整覆盖。
正式使用仍以稳定版为基线，没有追入这批未发布代码。

用户远程 `origin` 指向个人 fork，现有 `origin/dev` 是旧 V1 引用；官方 V2 比较应使用 `upstream/v2` 或正式标签，
而不是把 V1/V2 整体目录迁移误列成个人差异。无关工作区文件 bak/diff.md/v1_v2.md 未修改。

复查命令：

```sh
git diff --stat v2.0.26 HEAD
git diff v2.0.26 HEAD -- packages
git range-diff e5ecb5719d..personal-beta v2.0.26..46d0d8b962
git log --oneline 5e73d5cb1f..upstream/v2
```

核对快照的完整补丁及逐文件统计保存在 `/tmp/opencode-v2-ui-audit/`：
`personal-v2-v2.0.26.patch`（全部 28 个文件）、`personal-v2-runtime.patch`（运行代码）、
`personal-v2-v2.0.26-files.txt`、`beta-v2-range-diff.txt`、`official-unreleased.txt`。
