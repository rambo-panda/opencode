# Personal V2

个人分支：`personal-v2`，当前源码基线为官方稳定标签 `v2.0.30`（`f16ef9ad88`）。日常使用正式 V2。

本文件记录仍影响个人分支维护、构建和使用的差异。开始修改前阅读；个人行为、重要兼容性或维护流程变化时同步更新。

## V2 开发与稳定版维护

- 开发分支和 worktree 遵循根目录 [AGENTS.md](AGENTS.md) 的 `dev` 分支规则。`bin/rebase-v2.sh` 用于有意更新 `personal-v2` 的稳定版基线，不用于日常 V2 开发任务。
- 修改个人分支行为前，检查官方 Issue/PR（包括关闭和已合并记录）及 `upstream/v2`。发现相同或实质重叠的工作时，先提供链接并讨论是否继续。
- 有意同步最新稳定版时运行 `bin/rebase-v2.sh`。它读取官方更新 API、fetch 稳定标签和 `upstream/v2`，创建 `v2-backup-<时间>` 后 rebase；不 push，也不自动丢弃冲突提交。冲突后继续或 abort。
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

## TUI 个人行为

- Enter steer；运行时 Tab FIFO，补全时 Tab 仍用于补全。
- Ctrl+C/Esc 单次中断，保留草稿并继续已接收 FIFO；没有后续输入时不重试刚中断的消息。中断显示 `■ Conversation interrupted`，移除重复 inline 提示。
- `/delete` 用 `1` 保留、`2` 删除退出；活动会话、活动子任务或有待处理 inbox 时拒绝删除。空白首页没有当前会话，不注册此命令。个人 `cli.json` 将 `session.delete` 设为 `none`，取消 Ctrl+D 删除会话。
- 保留官方 `@文件名` 和图片/PDF 附件机制。
- Ctrl+K：光标后有正文时删除到逻辑行尾；空行、行尾或只剩空格/Tab 时删除到下一行开头；末尾没有换行时保留原删除行为。完整 TUI、mini 和对话框共用此命令，原生撤销继续有效。
