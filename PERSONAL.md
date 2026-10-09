# Personal V2

个人分支：`personal-v2`，基线为官方稳定标签 `v2.0.26`（`9b4ec5714d`），发布源码 SHA 为 `5e73d5cb1f`。
2026-10-09 从 `personal-beta`（`db8a026f5a`）迁移，12 个个人提交全部保留；原分支留作备份。
日常只使用正式 V2 的 `opencode`，旧版本仅作归档，不再维护 V1/beta 日常入口。

本文件记录个人修改及维护背景；开始工作前阅读，重要行为、配置和维护流程变化必须同步更新。
详细采用审查见 [opencode-v2-adoption.md](opencode-v2-adoption.md)。

## 跟随官方稳定发布

功能修改前必须依次完成：

1. 执行 `bin/rebase-v2.sh` 获取最新正式 V2 并完成 rebase，不跳过同步或未完成的 rebase。
2. 检索官方 Issue/PR，包括已关闭和已合并记录，核对稳定发布及最新 `upstream/v2` 是否已有相同工作。
3. 找到重复或实质重叠时停止功能修改，说明关联并提供链接，等待我决定是否继续。同步/检索失败不能视作没有相关工作。

先提交本次相关修改，再从个人分支运行：

```sh
bin/rebase-v2.sh
# 无法自动识别旧基线时：
bin/rebase-v2.sh <old-stable-commit>
```

脚本读取官方 `https://opencode.ai/update/api/latest/cli/npm`，fetch 正式标签及 `upstream/v2`，
创建 `v2-backup-<时间>` 再 rebase；已是最新稳定版时不 rebase。不 push，不自动丢弃冲突提交。
冲突解决后运行 `git rebase --continue`，也可 `git rebase --abort`。
正式版本同步提交不合回开发分支，基线取 HEAD 最近的稳定 `v2.*` 祖先标签，不能用开发分支 merge-base 代替。
`rebase-beta.sh` 已删除，直接使用 V2 脚本；构建不自动同步 Git。
每次更新核对个人补丁是否已被官方完整覆盖。定期审查使用 [opencode-v2-review-prompt.md](opencode-v2-review-prompt.md)。

## Provider 多账号

使用 V2 原生字段，独立 key 表示独立账号；`canonical` 指定要继承的目录。
个人补丁让别名自动继承完整模型列表，不必逐个填写 `models`。

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

未指定名称时显示配置 key；后层配置不覆盖前层显式名称。
模型选择器的 Provider 分组名称按 `name → 配置 key（Provider ID）` 决定，并支持按 ID 或显示名搜索。
普通自定义 Provider 和 `canonical` 别名都遵循这条规则，不依赖 Integration 连接；`canonical` 只决定继承来源。
继承时移除源 provider、模型及 variant 的 `apiKey`、`accessToken`、`authToken`，再应用本账号配置。
这是普通 API key 多账号支持，专用 OAuth、云平台认证插件和自定义授权 headers 仍按官方规则处理。

原来的 `provider.claude-b.id` / `options` 写法也会迁移为 `providers.claude-b.canonical` / `settings`。
迁移后遵循 V2 `canonical` 的语义，请用独立别名 key，不要给现有官方 provider 配另一个 `id`。
模型级配置仍优先于 provider 级配置；建议把 `canonical`、账号、`package`、`baseURL` 放在同一处定义。

## HTTP 请求插件

直接使用官方 `ctx.session.hook("http.request", ...)`，无需维护旧的 `llm.request.before` 内核补丁。
旧插件需改为 V2 的 `Plugin.define` 接口。下面是 `.opencode/plugins/request.ts` 的示例：

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

`event` 包含当前 `sessionID`、`model`、`kind` 和真实 Request；按网关要求修改示例中的参数。
这是 HTTP 请求钩子，不是任意 WebSocket frame 拦截接口。

2026-09-14 跟随官方 [PR #47663](https://github.com/anomalyco/opencode/pull/47663)，将个人 HTTP 插件回归测试
从已移除的 `SessionModelRequest.prepare()` 迁到 `primary()`，保留 body/headers 修改与请求身份断言。
这只适配测试使用的内部接口，插件仍使用官方 `http.request`，无需修改配置。

本地插件建议放在自动发现的 `.opencode/plugins/` 中。正式 V2 的 `plugins` 配置接受本地插件目录，
会忽略单个文件路径；目录入口可使用 `index.js` / `index.ts`。不要照搬旧文档里的 `dist/server.js` 单文件配置。

## 构建正式 V2 个人版

```sh
bin/build-macos.sh darwin-x64
bin/build-macos.sh darwin-arm64 --outdir=/tmp/opencode-build
```

产物为 `dist/cli-darwin-<架构>/bin/opencode`，默认包含 Web UI。命令名统一为 `opencode`，
保留个人 `local` 服务渠道；版本从 HEAD 最近的稳定 V2 祖先标签推导，不再使用 beta 工作流编号。
脚本使用仓库要求的 Bun；版本不匹配时通过 npm 执行对应版本。
`--skip-web-ui` 跳过 Web UI，`--skip-install` 在依赖就绪时跳过跨平台依赖安装。

```sh
OPENCODE_CHANNEL=local OPENCODE_VERSION=2.0.26 bun run packages/cli/script/build.ts \
  --only=darwin-arm64,darwin-x64 --outdir=/tmp/opencode-build
```

保留 `--only`、`--outdir` 和目录安全检查。直接 builder 的相对输出路径基于 `packages/cli`，
包装脚本基于仓库根目录；直接 builder 需显式提供对应版本。有效构建会清空输出目录，无效目标先报错。

## 日常配置与服务

`~/.local/bin/opencode` 指向本仓库 `dist/cli-darwin-x64/bin/opencode`。
fish 的 `opencode` 使用原 `_opencode_run` 设置现有凭证和环境，读取 `~/.config/opencode`。
凭证函数保持原样；`opencode2` 测试函数已删除，旧 beta 二进制已移入备份。
已打开的终端可刷新配置，之后直接使用 `opencode`：

```fish
functions -e opencode2
source ~/.config/fish/conf.d/omf.fish
```

主配置已转换为 V2 原生字段，关闭自动升级。保留三个 Provider 的 22、24、10 个模型、
模型设置、variants、slim presets/fallback/council、commands、skills 和现有模型凭证。
CLI 偏好使用 `cli.json`，保留中断快捷键、统一 diff、隐藏 sidebar、显示 thinking 和关闭动画。

个人 `local` 渠道使用 `~/.local/share/opencode/opencode-local.db`、
`~/.local/state/opencode/service-local.json` 和 `~/.config/opencode/service-local.json`。
日常函数不设置 `OPENCODE_DB`。该渠道保留个人构建的独立服务、数据库和日志。
当前后台服务版本为 `2.0.26`，地址通过 `opencode service status` 获取。
同一正式版本下重新构建个人代码后，也须在任务结束时重启服务；不要在每次启动时自动重启。
服务连接密码由官方生成，与模型 API key 无关，不应放入代码或提交。

全局 `plugins/inherit-models.js` 已适配正式 `ctx.model.transform`，为已知模型提供默认图片/PDF/视频能力。
维护副本在 [bin/plugins/inherit-models.js](bin/plugins/inherit-models.js)；修改后复制到全局插件目录。
全局和项目显式 capabilities 优先，未知模型保留官方默认。配置热刷新已实测。
47 处仅由旧 `tool_call: true` 产生的完整 capabilities 改为 `{ "tools": true }`，避免覆盖默认映射。
旧 `reasoning/temperature/attachment` 能力标记由官方归一化省略，实际模型设置和 variants 保留。
本次编译服务在启动后新建插件文件时，热加载和显式 reload 两次报模块解析失败；
文件预先放好再启动服务，加载及 HTTP hook 均正常。因此新增本地插件后，在服务空闲时重启。

## 历史保全（2026-10-09）

原 V1 `~/.local/share/opencode/opencode.db` 未修改。先在线备份，再在独立副本运行官方
`V1Migration.run()`，核对后装为 V2 日常库；此前 local 测试库为空，覆盖前也已备份。

备份：`~/.local/share/opencode/backups/v2-adoption-20261009-135300/`。
包含迁移前主库、local 库、配置、插件、fish、旧日常可执行文件及 beta 二进制；限制当前用户访问，不提交内容。

- 214 个 Session ID、标题、时间及父子关系全部一致。
- 原始 5990 条 message、24791 条 part 的所有公共字段逐条一致，含 50 条文件附件记录。
- V2 投影共 6157 条：8 条摘要合并到 compaction、2 条旧 task 包装按官方语义转换，并增加 synthetic/system 记录；数量不与旧表一对一对应。原 message/part 表仍完整保留在迁移副本中。
- `quick_check=ok`，外键零错误，inbox/执行恢复标记为零。
- 日常 API 可列出全部 214 个会话，最早、最新及已压缩历史读取通过。

2026-09-08 曾因混用旧版/V2 可写数据库导致 schema 冲突，相关恢复备份仍保留。
保留官方迁移实现；以后历史迁移继续只在在线备份副本上进行，不把 V2 库交给旧版客户端。

## oh-my-opencode-slim

Server 和 TUI 均固定为 `oh-my-opencode-slim@3.0.3`，真实 2.0.26 服务中已验证 active。
已修复旧审查的 `event.data` 和历史 `message.text` 适配问题。
前台 fallback 的旧 abort/replay 路径在 V2 禁用；3.0.3 通过官方 retry hook 和 `switchModel` 支持原位切换，
保留用户原有 fallback 开关与模型链，不按过时文档关闭全部 fallback。

已知限制：Interview 仍监听 `session.next.text.*`，宿主发 `session.text.*`；
`/reflect --sessions` 仍依赖旧历史表；stock plugin context 不暴露全部 Session list/remove 和 form reply，子任务提问需宿主 UI。
不将 active 或 mock 测试通过解释为全功能兼容。未修改第三方源码，未用付费模型验证 fallback/council 长任务。
证据见 [采用报告](opencode-v2-adoption.md)。

## TUI 个人习惯

- Enter steer；运行时 Tab FIFO，补全时仍为 Tab 补全。
- 单 Ctrl+C/Esc 中断，保留草稿，继续已接收 FIFO；无后续输入时不重试刚中断的消息。
- 红色 `■ Conversation interrupted`；去掉官方重复 inline 提示。
- `/delete` 用 `1` 保留、`2` 删除退出；活动或待处理工作拒删。
- 源码用官方 `@文件名`；图片/PDF 路径采用官方附件机制。

保留官方持久化 inbox、调度器、客户端提交及配置体系。
本次 rebase 适配 theme 的 `base/muted` 与无旧参数的 `useTheme()`。

## 正式 V2 验证（2026-10-09）

Frozen lockfile 安装、客户端生成无净差异；Core 125 项、TUI 42 项全部通过。
根 `bun run check` 通过，36 个类型检查任务成功，lint 零错误，上游 advisory warnings 未扩展修复。
macOS x64 完整构建、版本及服务命令正常；slim 的 5 个适配测试文件共 204 项通过，含 mock。
真实独立服务验证能力优先级/热刷新、本地 HTTP SSE 的持久 prompt、23 个工具的注册和 body/headers hook。
编译 TUI 在 120/70 列启动、模型菜单和调整尺寸正常；日常版本、插件、56 个个人模型及历史均已核对。
未调用付费模型，未交互验证桌面或 Web；完整边界见采用报告。

## 低优先级待办

- [ ] 类似 Codex `ephemeral` 的临时会话；先确认持久化边界，本次仅记录。
