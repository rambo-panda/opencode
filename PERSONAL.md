# Personal V2

个人分支：`personal-v2`，当前源码基线为官方稳定标签 `v2.1.4`（`68bc26b7da`）。日常使用正式 V2。

本文件记录仍影响个人分支维护、构建和使用的差异。开始修改前阅读；个人行为、重要兼容性或维护流程变化时同步更新。

## V2 开发与稳定版维护

- 开发分支和 worktree 遵循根目录 [AGENTS.md](AGENTS.md) 的 `dev` 分支规则。`bin/rebase-v2.sh` 用于有意更新 `personal-v2` 的稳定版基线，不用于日常 V2 开发任务。
- 开发功能或修改个人分支行为前，先检查官方对应 Issue/PR（包括 open、closed、merged）及 `upstream/v2`，向用户反馈链接和状态；未找到也需反馈。若有对应 open Issue，仅本地记录并等待官方，不自行设计或实现，除非用户明确改变决定。其他状态或未找到时，先反馈，再与用户讨论是否自行设计本地方案，不能默认直接实现。
- 有意同步最新稳定版时运行 `bin/rebase-v2.sh`。它读取官方更新 API、fetch 稳定标签和 `upstream/v2`，创建 `v2-backup-<时间>` 后 rebase；不 push，也不自动丢弃冲突提交。冲突后继续或 abort。
- 2026-10-27 从 `v2.0.32` rebase 到 `v2.1.4`，保留全部 18 个个人提交。模型选择器保留上游新样式、免费模型分组和个人 Provider 名称/搜索补丁；构建保留目录保护与上游 `--libc="*"` 安装参数。
- 本机 V2 个人版更新流程：

  ```sh
  cd /Users/rambo/work_space/opencode-fork
  bin/rebase-v2.sh
  bun install --frozen-lockfile
  bun run check
  bin/build-macos.sh darwin-x64 --skip-install
  ```

  ARM Mac 将目标改为 `darwin-arm64`。构建完成并确认没有运行任务后再执行 `opencode service restart`。

## Provider 多账号

使用 V2 原生 `providers` 字段，独立 key 表示独立账号；`canonical` 指定继承的模型目录。个人补丁使别名自动继承完整模型列表，并在继承后清除源 Provider、模型及 variant 的 `apiKey`、`accessToken`、`authToken`，再应用本账号配置。

```jsonc
{
  "providers": {
    "claude-b": {
      "canonical": "anthropic",
      "settings": { "apiKey": "{env:ANTHROPIC_B_API_KEY}" },
    },
    "claude-c": {
      "canonical": "anthropic",
      "name": "Claude C",
      "settings": { "apiKey": "{env:ANTHROPIC_C_API_KEY}" },
    },
  },
}
```

模型选择器的 Provider 名称按 `name → 配置 key（Provider ID）` 决定，并支持按 ID 或显示名搜索；不依赖 Integration 连接。后层配置不覆盖前层显式名称。旧 `provider.<id>.id/options` 配置会迁移到 V2 的 `canonical/settings`；不要给现有官方 Provider 再配置一个 `id`。专用 OAuth、云平台认证和自定义授权 headers 仍遵循官方规则。

## HTTP 请求插件

使用官方 `ctx.session.hook("http.request", ...)`，不维护旧的 `llm.request.before` 内核补丁。插件需使用 V2 的 `Plugin.define`；例如：

```ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "personal.request",
  async setup(ctx) {
    await ctx.session.hook("http.request", async (event) => {
      if (event.model.providerID !== "claude-b") return
      if (!event.request.headers.get("content-type")?.includes("application/json")) return
      const body = await event.request.clone().json()
      if (typeof body !== "object" || body === null || Array.isArray(body)) return
      const headers = new Headers(event.request.headers)
      headers.set("x-personal-account", "claude-b")
      headers.delete("content-length")
      event.request = new Request(event.request, {
        headers,
        body: JSON.stringify({ ...body, metadata: { user_id: "personal" } }),
      })
    })
  },
})
```

本地插件放入自动发现的 `.opencode/plugins/` 目录，使用 `index.js` 或 `index.ts` 入口；配置里的本地插件路径应指向目录。

## 构建与本机运行

- `~/.local/bin/opencode` 启动 `dist/cli-darwin-x64/bin/opencode`；本机配置目录为 `~/.config/opencode`。
- 模型凭证、网关地址和插件环境变量放在 `~/.config/opencode/service-local.json` 的 `env` 中，文件权限为 `0600`，不提交凭证。
- 个人 `local` 渠道使用独立数据库 `~/.local/share/opencode/opencode-local.db` 和服务状态文件 `~/.local/state/opencode/service-local.json`。日常 shell 不设置 `OPENCODE_DB`。
- 直接调用 CLI builder 时，版本必须显式指定；相对 `--outdir` 基于 `packages/cli`，有效构建会清空输出目录。常用包装脚本负责仓库根目录和目标安全检查。

## 个人模型能力插件

`bin/plugins/inherit-models.js` 使用官方 `ctx.model.transform` 为已知模型补充默认图片、PDF 和视频能力。更新后同步到全局插件目录。全局和项目显式 capabilities 优先；未知模型保留官方默认。模型级配置仍优先于 Provider 级配置。

## oh-my-opencode-slim

个人配置的 Server 和 TUI 使用同一版 `oh-my-opencode-slim@3.0.3`。上次兼容性审查针对宿主 V2.0.26（2026-10-09），更换插件或宿主版本后应重新核对。已知限制包括：Interview 监听 `session.next.text.*` 而宿主发 `session.text.*`；`/reflect --sessions` 依赖旧历史结构；插件 context 未暴露完整 Session list/remove 和 form reply。不要把插件 active 或 mock 测试通过当成完整兼容证明。

## Session 保留

核查日期：2026-10-27。当前官方 V2 和本地分支均不按会话年龄或数量自动删除普通 Session，无需额外配置，由用户自行管理。上下文压缩不删除原消息，但工具/Shell 外置的完整输出会按 7 天保留期清理，Shell 另有数量淘汰；这不代表所有相关文件永久保存。本地 slim 的 `pruneEvictedSessions` 默认 `false`，当前无覆盖。

复核参考：[官方压缩限制](https://opencode.ai/v2/docs/compaction/#limits)、`packages/core/src/session.ts`、`packages/core/src/tool-output.ts`、`packages/core/src/shell.ts`。

## TUI 个人行为

- Enter steer；运行时 Tab FIFO，补全时 Tab 仍用于补全。
- Ctrl+C/Esc 单次中断，保留草稿并继续已接收 FIFO；没有后续输入时不重试刚中断的消息。中断显示 `■ Conversation interrupted`，移除重复 inline 提示。
- 个人 `/delete` 复用官方 `session.delete` 命令 ID 和删除 API，确认框用 `1` 保留、`2` 删除退出；活动会话、活动子任务或有待处理 inbox 时拒绝删除。空白首页没有当前会话，不注册此命令。全局 `cli.json` 将 `session.delete` 设为 `<leader>d`（Ctrl+X 松开再 D）；Sessions 列表共用此绑定，但使用两次快捷键确认，不经过个人保护框。Ctrl+D 仍只用于字符删除，`app.exit` 绑定保持不变；配置热加载，无需重启。
- 保留官方 `@文件名` 和图片/PDF 附件机制。
- Ctrl+K：光标后有正文时删除到逻辑行尾；空行、行尾或只剩空格/Tab 时删除到下一行开头；末尾没有换行时保留原删除行为。完整 TUI、mini 和对话框共用此命令，原生撤销继续有效。
