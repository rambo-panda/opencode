# Personal beta

个人开发分支：`personal-beta`，初始基线为官方 `upstream/beta` 的 `11e2e0a59f`。
旧实现保留在 `feat/provider-id-alias` 和备份 `before-beta-0908`。

## 跟随官方

### 功能修改前的严格约束

今后每次收到新增功能、修改功能或修复问题的请求，必须在开始实现前严格按以下顺序执行：

1. **先同步并 rebase。** 执行 `bin/rebase-beta.sh`，拉取官方最新 `upstream/beta`，并完成当前个人开发分支的 rebase。不得仅依赖本地已有的远程引用，也不得跳过未完成的 rebase 开始修改功能。
2. **再检查官方是否已有相同工作。** 检索官方仓库的 Issue、PR（包括已关闭或已合并的记录），并核对最新 beta 的代码与提交，判断是否已有相同问题、相同需求或实质重叠的修改。
3. **发现重复就停止。** 只要找到上述相关工作，立即停止本次功能修改，向我说明关联、当前状态，并提供 Issue、PR 或提交链接，等待我决定是否继续。只有 rebase 和检索均已完成、且未发现相同工作时，才按最小改动原则开始实现。

同步或检索失败不等于“没有相同工作”，不得据此绕过上述约束。

先把个人修改整理为小提交，再从个人分支运行：

```sh
bin/rebase-beta.sh
```

脚本先识别旧 beta 基线，再 fetch 最新 beta，创建 `beta-backup-<时间>` 备份并 rebase。
有冲突时停下：解决后 `git rebase --continue`，或 `git rebase --abort` 回到开始状态。
不会自动丢弃冲突提交，也不会 push。基线无法自动识别时可传入上次使用的官方提交：

```sh
bin/rebase-beta.sh <old-beta-commit>
```

每次更新后检查官方是否已覆盖个人补丁；已覆盖的补丁移除，避免长期维护两套实现。
构建脚本与 Git 同步分开，构建不会偷偷 rebase。

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
模型选择器也显示账号别名，并支持按 Provider ID 或显示名搜索，包括直接在配置中填写 API key 的账号。
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

本地插件建议放在自动发现的 `.opencode/plugins/` 中。当前 beta 的 `plugins` 配置接受本地插件目录，
会忽略单个文件路径；目录入口可使用 `index.js` / `index.ts`。不要照搬旧文档里的 `dist/server.js` 单文件配置。

### oh-my-opencode-slim 兼容性记录（2026-09-08）

本机已安装 `2.2.18`，核对时也是 NPM latest。包提供 V2 `./server` 入口，但内部仍通过适配器调用 V1 实现。
与当前 beta 的静态比对发现三处不匹配，需要插件侧修复，改用户配置无法解决：

- 事件转换读取 `event.properties`，当前 V2 载荷在 `event.data`。
- 历史转换只读取 `message.content`，遗漏当前 user/system/synthetic 消息的 `message.text`。
- Interview 桥接监听 `session.next.text.*`，当前事件为 `session.text.*`。

因此，能加载不代表全部功能正常。此次未安装、改写或运行该插件及其 MCP；上述结论来自实际安装包和当前 API 的源码核对。
用户提供的[迁移文档](https://github.com/alvinunreal/oh-my-opencode-slim/blob/v2-migration-docs/docs/opencode-v2-compatibility.md)
属于[未合并且已关闭的 PR #1089](https://github.com/alvinunreal/oh-my-opencode-slim/pull/1089)，部分描述已落后于 `2.2.18`，不作为已完成迁移的依据。

## 构建 opencode2

```sh
bin/build-macos.sh darwin-x64
bin/build-macos.sh darwin-arm64 --outdir=/tmp/opencode-build
```

默认产物为 `dist/cli-darwin-<架构>/bin/opencode2`。
脚本使用仓库要求的 Bun 版本；本机版本不匹配时，通过 npm 执行对应版本。
版本号使用当前 `upstream/beta` 代码基线对应的官方发布版本，保留个人 `local` 服务渠道。
例如初始基线 `11e2e0a59f` 对应官方 `0.0.0-beta-19289`；个人补丁不追加版本后缀。
脚本通过官方发布工作流匹配源码提交，并确认 NPM 中存在该版本，不直接套用最新发布号。
离线构建时可显式设置 `OPENCODE_VERSION=<对应的官方版本>`。官方 beta 本身使用 `0.0.0-beta-*` 编号，
它并不是源码 `package.json` 中的 `1.x` 版本；插件仍需支持官方 beta 的版本规则。
`--skip-web-ui` 可跳过内嵌 Web UI，`--skip-install` 可在依赖已就绪时跳过 builder 的跨平台依赖安装。

多目标直接使用官方 builder，保留个人 `--only` 参数：

```sh
OPENCODE_CHANNEL=local OPENCODE_VERSION=0.0.0-beta-19289 npm exec --yes --package=bun@1.4.2 -- bun run \
  packages/cli/script/build.ts \
  --only=darwin-arm64,darwin-x64 --outdir=/tmp/opencode-build
```

直接运行 builder 时，相对输出路径基于 `packages/cli`；包装脚本则基于仓库根目录。
直接调用 builder 需自行提供当前基线对应的 `OPENCODE_VERSION`。
有效构建开始前会清空输出目录，无效目标会先报错，不清空目录。

## 本机启动与历史

`~/.config/fish/conf.d/omf.fish` 统一定义 `opencode` 和 `opencode2`，通过同一个函数设置现有模型凭证和环境变量。
`opencode2` 调用本仓库的 `dist/cli-darwin-x64/bin/opencode2`，并设置：

```fish
set -lx OPENCODE_CONFIG_DIR ~/.config/opencode2
set -lx XDG_DATA_HOME ~/.local/share
set -lx OPENCODE_DB ~/.local/share/opencode/opencode.db
```

官方标准 beta 默认使用 `opencode.db`；本机 local 构建原本默认使用 `opencode-local.db`，因此显式指定原库。
V2 会迁移原库中的 V1 历史。这是一次迁移，不是 V1/V2 双向历史同步；后续以 V2 为主使用。
切换前已通过 SQLite 在线备份保存原库到 `~/.local/share/opencode/backups/`，并验证完整性。
此次配置过程未启动或停止已有服务，也未迁移原库；已有 `opencode-local.db` 保留。

新配置目录复制了 `opencode.jsonc`、`cli.json`、slim 配置和 skills，commands 仍链接到 `~/.agents/commands`。
自定义插件迁到 `~/.config/opencode2/plugins/inherit-models.js`，保留集中维护的模型输入能力映射。
它使用 V2 `catalog.transform` 读取相邻 `opencode.json(c)`，为已配置模型提供默认能力，官方随后应用显式配置。
新增全局模型仍可复用映射；项目中的显式能力配置优先。映射针对这份全局配置，项目独有的模型需另行定义。
配置重载时重新读取文件，不需要另写 watcher。之前临时固化的 11 处 modalities 已撤回。
同时移除了新副本中四处冗余 `tool_call: true`：V2 默认已启用工具，而该旧字段会触发完整默认 capabilities，
覆盖插件提供的输入能力。显式 `modalities` / `capabilities` 仍优先；原 V1 文件不变。
其余受支持的 V1 配置继续由官方在内存中转换，不强制改写成 V2 格式。slim 本身的兼容性问题见上文。

重新打开 fish 或执行 `source ~/.config/fish/conf.d/omf.fish` 后，新函数生效。
已有后台服务保留启动时的配置路径和环境；等现有任务结束后执行一次 `opencode2 service restart`，再运行 `opencode2`。
同一官方版本下再次构建个人补丁时，也需重启服务才能使用新二进制；官方版本号不会随个人修改变化。
重启会停止该服务的任务和持久终端；不要放进每次启动的包装函数。

`service-local.json` 的 password 是官方自动生成、跨重启复用的本地服务连接密码，与模型 API key 无关。
模型凭证无需放入该文件。手动修改用 `opencode2 service set password '新密码'`；重新随机生成用
`opencode2 service unset password`。这两个命令会停止服务，随后执行 `opencode2 service start`。

## TUI 个人习惯

- 运行中 Enter 使用官方 steer，Tab 将输入放入官方 FIFO 队列；补全菜单打开时保留 Tab 补全。
- Ctrl+C / Esc 单次中断当前生成，并继续已接收的后续输入；没有后续输入时不重试刚中断的消息。
- 中断消息显示红色 `■ Conversation interrupted`。
- `/delete` 打开确认框，`1` 保留，`2` 删除并退出当前会话；有活动或待处理工作时拒绝删除。

普通源码文件使用官方的 `@文件名` 引用；已实测 `@sample.sh` 正文进入模型上下文。
直接粘贴路径目前只对图片和 PDF 自动附件化，`.sh` 路径仍作为普通文字保留。

保留官方的持久化 inbox、调度器、客户端提交机制及配置体系，只修改上述差异。

## 真实终端验证（2026-09-08）

使用编译后的 macOS x64 `opencode2`、PTY 终端及独立真实 V2 服务/SQLite。
模型端使用本地可控 HTTP SSE 响应，以确认请求内容与队列顺序，未调用外部付费模型。
已验证单键中断、草稿保留、steer/FIFO 顺序、无待处理输入时不重试、删除守卫与数字确认、
重启后的中断记录、`.sh` 文件引用、两个别名账号的独立凭证，以及插件修改 body/headers。
真实测试发现并修复了无 Integration 连接时模型选择器无法区分别名、无法按别名搜索的问题。
自定义 `inherit-models.js` 另经真实隔离 V2 服务验证：插件处于 active，缺省能力补齐、显式配置优先、
项目覆盖、未知模型保留及配置热刷新均通过；未调用模型或操作本机已有服务。

## 低优先级待办

- [ ] 实现类似 Codex `ephemeral` 的临时会话能力；后续先确认会话、消息和相关数据的持久化边界。本次仅记录。
