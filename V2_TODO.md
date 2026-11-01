# V2 TODO

## 跨 Session 引用与协作（调研于 2026-10-18）

- [ ] 跟进官方的跨 Session 引用能力。需要区分会话跳转、把历史上下文提供给模型、以及会话之间主动通信；它们是不同的功能。
- `@` 选择器与会话跳转：[PR #54466](https://github.com/anomalyco/opencode/pull/54466) 提议在 composer 输入 `@` 后按标题或 ID 选择当前服务器上的其他打开/运行中会话，并在消息中留下可点击引用。调研时 PR 仍开放、未合并，目标分支为 `beta`。PR 评审指出模型只收到被引用的 Session ID，没有内建工具读取其历史消息，因此这本身不等于上下文共享。
- 按需读取另一会话上下文：[Issue #53933](https://github.com/anomalyco/opencode/issues/53933) 仍开放，提出从当前 Session 选择另一个 Session，并让模型按需获取其中相关决策、发现和约束。官方回复称 V2 尚无内建工作流。
- 会话间主动协作：[Issue #52297](https://github.com/anomalyco/opencode/issues/52297) 仍开放，提出为会话设置稳定别名，并允许一个会话询问或委托另一个会话、沿用其现有上下文。
- Session ID 链接：[Issue #56419](https://github.com/anomalyco/opencode/issues/56419) 讨论助手回复中提到另一个 Session 时直接打开它。官方回复称 Web UI v2.0.26 可将助手消息中的完整 `ses_…` ID 显示为打开会话的按钮；这只解决跳转。助手只提到标题时仍无法自动链接。相关的标题 pill 改进 [PR #55648](https://github.com/anomalyco/opencode/pull/55648) 调研时仍开放，目标分支为 `dev`。
- 旧的 `@` 提案 [Issue #3227](https://github.com/anomalyco/opencode/issues/3227) 已关闭，但后续 #53933 仍明确表示上下文引用尚无内建流程；不能仅凭旧 Issue 的关闭状态判定功能已实现。

以上状态以 2026-10-18 的官方仓库页面为准；开始实现前重新核对 Issue/PR 状态及正式 V2 发布内容。


## 后台子任务状态可见性（核查于 2026-10-27）

- [ ] 跟进 [Issue #57097](https://github.com/anomalyco/opencode/issues/57097)（OPEN）：父会话停止输出、父工具调用已完成，不代表后台子会话已经完成；需要更持续、明显的子任务状态提示。按个人规则仅记录并等待官方，不自行实现。
- 本地已有原生 `N subagents` 计数：`packages/tui/src/feature-plugins/prompt/footer.tsx` 按子会话自身的 running 状态统计，即使父会话 idle 也显示；现有 `prompt-footer.test.tsx` 覆盖该场景。本次仅核查源码与测试定义，未进行运行时复现。问题应描述为可发现性不足，而非完全没有子任务状态功能。
- 当前 `session.sidebar=hide` 隐藏 slim 侧栏，`animations=false` 关闭动画，但两者不直接隐藏原生计数。可点击 `N subagents` 或通过命令面板的 `Toggle subagent picker` 查看子任务；本次未改配置。
- 相关但不同的问题：[Issue #48826](https://github.com/anomalyco/opencode/issues/48826)（OPEN）与 [PR #57418](https://github.com/anomalyco/opencode/pull/57418)（OPEN、未合并）处理后台工作尚未结束却提前报告完成，不等同于常驻 UI 提示修复。状态以核查日为准，后续重新核对。

## 备忘录
1. slim 默认已把 `oracle` 注册为 `subagent`。因此如果不在jsonc中明确标注 `"oracle": { "mode": "all" }` 正常使用如下
  - 可以用 `@oracle` 指定它作为子 agent。
  - Orchestrator 也可以自动委派任务给它。
  - `/agents` 主 agent 切换菜单不会显示它。

  `mode: "all"` 只是额外允许你在 `/agents` 中把 Oracle 选为当前会话的主 agent，同时保留子 agent 能力。

  因此，如果你只需要子 agent 用法，可以删除这段覆盖；slim preset 中的模型、提示词等配置仍然生效。

## Node.js 构建与代理行为（核查于 2026-11-01）

- [ ] 跟进 Node.js 构建及 macOS x64 支持；切换构建后重新验证模型请求和代理行为，不因仓库支持 Node 就认定本机运行时已经切换。
- 当前源码保留两条构建路线：`packages/cli/script/build.ts` 使用 Bun 编译；`packages/cli/script/build-node.ts` 提供 Node.js 构建，固定 Node 版本为 `26.4.0`。
- 当前 `build-node.ts` 明确拒绝 macOS x64 的 SEA 独立可执行文件构建（提示 `Node 26.4 SEA does not support macOS x64`）；此限制不等于所有 Node.js 运行方式均不支持 macOS x64。
  本次排查在服务重启前观察到，本机运行的是 2026-11-01 生成的 `dist/cli-darwin-x64/bin/opencode`，内嵌 Bun，并非 Node 构建。
