/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { batch, onCleanup, Show } from "solid-js"
import type { SessionInputAdmitted, V2SessionPromptData } from "@opencode-ai/sdk/v2"
import { ArgsProvider } from "../../../src/context/args"
import { SDKProvider } from "../../../src/context/sdk"
import { ProjectProvider } from "../../../src/context/project"
import { SyncProvider, useSync } from "../../../src/context/sync"
import { DataProvider } from "../../../src/context/data"
import { PermissionProvider } from "../../../src/context/permission"
import { ExitProvider } from "../../../src/context/exit"
import { RouteProvider } from "../../../src/context/route"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { LocalProvider } from "../../../src/context/local"
import { EditorContextProvider } from "../../../src/context/editor"
import { LocationProvider } from "../../../src/context/location"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { TuiConfigProvider } from "../../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap, useBindings, useOpencodeKeymap } from "../../../src/keymap"
import { PromptHistoryProvider } from "../../../src/prompt/history"
import { PromptStashProvider } from "../../../src/prompt/stash"
import { FrecencyProvider } from "../../../src/prompt/frecency"
import { Prompt, type PromptRef } from "../../../src/component/prompt"
import { PendingInputs } from "../../../src/routes/session/pending"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { QuestionPrompt } from "../../../src/routes/session/question"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { tmpdir } from "../../fixture/fixture"

async function wait(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw new Error("TUI did not reach expected state")
}

async function mount(input: {
  state: string
  interaction?: "permission" | "question"
  queueKey?: string
  failFirst?: boolean
}) {
  await Bun.write(`${input.state}/kv.json`, "{}")
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: "test",
            name: "Test",
            models: { model: { id: "model", name: "Model", variants: {} } },
          },
        ],
        default: { test: "model" },
      })
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", options: {}, permission: [] }])
  }, events)
  const received: V2SessionPromptData["body"][] = []
  const paths: string[] = []
  const ack = Promise.withResolvers<void>()
  const sent = Promise.withResolvers<void>()
  const submitted = Promise.withResolvers<void>()
  let sync!: ReturnType<typeof useSync>
  let ref: PromptRef | undefined
  let keymap!: ReturnType<typeof useOpencodeKeymap>
  let cycled = 0
  const pending: SessionInputAdmitted[] = []
  const fetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(request instanceof Request ? request.url : String(request))
    paths.push(url.pathname)
    if (url.pathname.endsWith("/prompt")) {
      const body = request instanceof Request ? await request.json() : JSON.parse(String(init?.body))
      received.push(body)
      sent.resolve()
      if (input.failFirst && received.length === 1) throw new TypeError("connection lost after admission")
      await ack.promise
      return json({
        data: { ...body, sessionID: "ses_test", admittedSeq: received.length, timeCreated: 0, status: "admitted" },
      })
    }
    if (url.pathname.endsWith("/state")) return json({ data: { execution: { type: "running" }, pending, after: -1 } })
    if (url.pathname.endsWith("/interrupt") || url.pathname.endsWith("/reply") || url.pathname.endsWith("/reject"))
      return new Response(null, { status: 204 })
    return calls.fetch(request, init)
  }) as typeof globalThis.fetch
  const config = createTuiResolvedConfig({
    keybinds: { session_interrupt: "ctrl+c", prompt_queue: input.queueKey ?? "tab" },
  })

  function Composer() {
    sync = useSync()
    keymap = useOpencodeKeymap()
    useBindings(() => ({
      commands: [
        {
          name: "agent.cycle",
          run: () => {
            cycled++
          },
        },
      ],
      bindings: config.keybinds.get("agent.cycle"),
    }))
    return (
      <>
        <PendingInputs inputs={sync.data.session_pending.ses_test ?? []} />
        <Show when={!input.interaction}>
          <Prompt
            sessionID="ses_test"
            ref={(value) => {
              ref = value
            }}
            onSubmit={() => submitted.resolve()}
          />
        </Show>
        <Show when={input.interaction === "permission"}>
          <PermissionPrompt
            request={{
              id: "per_test",
              sessionID: "ses_test",
              permission: "bash",
              patterns: ["pwd"],
              always: [],
              metadata: {},
            }}
          />
        </Show>
        <Show when={input.interaction === "question"}>
          <QuestionPrompt
            request={{
              id: "que_test",
              sessionID: "ses_test",
              questions: [
                { header: "Choose", question: "Continue?", options: [{ label: "Yes", description: "Continue" }] },
              ],
            }}
          />
        </Show>
      </>
    )
  }
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts paths={{ state: input.state }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <ArgsProvider>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider>
                    <ExitProvider exit={() => {}}>
                      <SDKProvider url="http://test" directory={directory} fetch={fetch} events={events.source}>
                        <PermissionProvider>
                          <ProjectProvider>
                            <DataProvider>
                              <SyncProvider>
                                <ThemeProvider mode="dark">
                                  <LocalProvider>
                                    <PromptStashProvider>
                                      <DialogProvider>
                                        <FrecencyProvider>
                                          <PromptHistoryProvider>
                                            <EditorContextProvider integration={{}}>
                                              <LocationProvider>
                                                <Composer />
                                              </LocationProvider>
                                            </EditorContextProvider>
                                          </PromptHistoryProvider>
                                        </FrecencyProvider>
                                      </DialogProvider>
                                    </PromptStashProvider>
                                  </LocalProvider>
                                </ThemeProvider>
                              </SyncProvider>
                            </DataProvider>
                          </ProjectProvider>
                        </PermissionProvider>
                      </SDKProvider>
                    </ExitProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ArgsProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }
  const app = await testRender(() => <Harness />, { width: 100, height: 30, kittyKeyboard: true })
  await wait(() => sync?.status === "complete" && (Boolean(input.interaction) || Boolean(ref?.focused)))
  return {
    app,
    sync,
    received,
    paths,
    ack,
    sent,
    submitted,
    pending,
    keymap,
    get ref() {
      return ref!
    },
    get cycled() {
      return cycled
    },
    dispose() {
      ref?.reset()
      app.renderer.destroy()
    },
  }
}

test("busy Enter durably submits steer and composer clears only after acknowledgement", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    tui.sync.set("session_status", "ses_test", { type: "busy" })
    tui.ref.set({ input: "steer A", parts: [] })
    tui.app.mockInput.pressEnter()
    await tui.sent.promise
    expect(tui.received[0].delivery).toBe("steer")
    expect(tui.received[0].prompt.selection).toEqual({ agent: "build", model: { providerID: "test", id: "model" } })
    expect(tui.ref.current.input).toBe("steer A")
    tui.ack.resolve()
    await tui.submitted.promise
    expect(tui.ref.current.input).toBe("")
    expect(tui.paths).not.toContain("/session/ses_test/message")
  } finally {
    tui.dispose()
  }
})

test("a terminal batch containing text then Tab queues without cycling the agent", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    tui.sync.set("session_status", "ses_test", { type: "busy" })
    batch(() => {
      tui.ref.set({ input: "q", parts: [] })
      tui.app.mockInput.pressTab()
    })
    expect(tui.cycled).toBe(0)
    await tui.sent.promise
    expect(tui.received[0].delivery).toBe("queue")
    expect(tui.received[0].prompt.text).toBe("q")
    expect(tui.cycled).toBe(0)
    tui.ack.resolve()
    await tui.submitted.promise
  } finally {
    tui.dispose()
  }
})

test("composer preserves newer edits made while admission is in flight", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    tui.ref.set({ input: "original", parts: [] })
    tui.app.mockInput.pressEnter()
    await tui.sent.promise
    tui.ref.set({ input: "newer draft", parts: [] })
    tui.ack.resolve()
    await tui.submitted.promise
    expect(tui.received[0].prompt.text).toBe("original")
    expect(tui.ref.current.input).toBe("newer draft")
  } finally {
    tui.dispose()
  }
})

test("composer retries an ambiguous HTTP admission with the same immutable request", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path, failFirst: true })
  try {
    tui.sync.set("session_status", "ses_test", { type: "busy" })
    tui.ref.set({ input: "original queue", parts: [] })
    tui.app.mockInput.pressTab()
    await tui.sent.promise
    await wait(() => tui.keymap.getCommands({ visibility: "active" }).length > 0)
    await tui.app.renderOnce()
    expect(tui.ref.current.input).toBe("original queue")
    tui.ref.set({ input: "newer draft", parts: [] })
    tui.app.mockInput.pressEnter()
    await wait(() => tui.received.length === 2)
    expect(tui.received[1]).toEqual(tui.received[0])
    tui.ack.resolve()
    await tui.submitted.promise
    expect(tui.ref.current.input).toBe("newer draft")
  } finally {
    tui.dispose()
  }
})

test.each(["busy", "stopping"] as const)(
  "%s Tab queues; idle Tab cycles and autocomplete Tab takes precedence",
  async (status) => {
    await using tmp = await tmpdir()
    const tui = await mount({ state: tmp.path })
    try {
      tui.ref.set({ input: "draft", parts: [] })
      tui.app.mockInput.pressTab()
      expect(tui.cycled).toBe(1)
      expect(tui.received).toHaveLength(0)
      tui.sync.set("session_status", "ses_test", { type: "busy" })
      tui.ref.set({ input: "/", parts: [] })
      await tui.app.renderOnce()
      tui.app.mockInput.pressTab()
      expect(tui.received).toHaveLength(0)
      expect(tui.cycled).toBe(1)
      tui.ref.set({ input: "queued B", parts: [] })
      tui.sync.set("session_status", "ses_test", { type: status })
      tui.app.mockInput.pressTab()
      await tui.sent.promise
      expect(tui.received[0].delivery).toBe("queue")
      expect(tui.ref.current.input).toBe("queued B")
      tui.ack.resolve()
      await tui.submitted.promise
      expect(tui.ref.current.input).toBe("")
    } finally {
      tui.dispose()
    }
  },
)

test("queue command uses its configured shortcut", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path, queueKey: "ctrl+y" })
  try {
    tui.sync.set("session_status", "ses_test", { type: "busy" })
    tui.ref.set({ input: "queued with custom shortcut", parts: [] })
    tui.app.mockInput.pressTab()
    expect(tui.cycled).toBe(1)
    expect(tui.received).toHaveLength(0)
    tui.app.mockInput.pressKey("y", { ctrl: true })
    await tui.sent.promise
    expect(tui.received[0].delivery).toBe("queue")
    tui.ack.resolve()
    await tui.submitted.promise
  } finally {
    tui.dispose()
  }
})

test("pending rendering distinguishes STEER from QUEUED and preserves durable FIFO order", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    tui.sync.set("session_pending", "ses_test", [
      {
        id: "msg_second",
        sessionID: "ses_test",
        delivery: "queue",
        admittedSeq: 3,
        timeCreated: 0,
        prompt: { text: "second" },
      },
      {
        id: "msg_first",
        sessionID: "ses_test",
        delivery: "queue",
        admittedSeq: 1,
        timeCreated: 0,
        prompt: { text: "first" },
      },
      {
        id: "msg_steer",
        sessionID: "ses_test",
        delivery: "steer",
        admittedSeq: 2,
        timeCreated: 0,
        prompt: { text: "now" },
      },
    ])
    await tui.app.renderOnce()
    const frame = tui.app.captureCharFrame()
    expect(frame).toContain("QUEUED  #1 first")
    expect(frame).toContain("STEER   now")
    expect(frame).toContain("QUEUED  #2 second")
    expect(frame.indexOf("#1 first")).toBeLessThan(frame.indexOf("#2 second"))
  } finally {
    tui.dispose()
  }
})

test("active Ctrl-C interrupts V2 without clearing draft or durable pending; idle Ctrl-C clears draft", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    tui.pending.push({
      id: "msg_queue",
      sessionID: "ses_test",
      delivery: "queue",
      admittedSeq: 9,
      timeCreated: 0,
      prompt: { text: "later" },
    })
    tui.sync.set("session_pending", "ses_test", [...tui.pending])
    tui.sync.set("session_status", "ses_test", { type: "busy" })
    tui.ref.set({ input: "keep draft", parts: [] })
    tui.app.mockInput.pressKey("c", { ctrl: true })
    await wait(() => tui.paths.includes("/api/session/ses_test/interrupt"))
    expect(tui.ref.current.input).toBe("keep draft")
    expect(tui.sync.data.session_pending.ses_test).toHaveLength(1)
    await wait(() => tui.sync.data.session_status.ses_test.type === "busy")
    tui.sync.set("session_status", "ses_test", { type: "idle" })
    tui.app.mockInput.pressKey("c", { ctrl: true })
    expect(tui.ref.current.input).toBe("")
  } finally {
    tui.dispose()
  }
})

test.each(["permission", "question"] as const)(
  "%s rejection and Ctrl-C use the V2 interaction and interrupt APIs",
  async (interaction) => {
    await using tmp = await tmpdir()
    const tui = await mount({ state: tmp.path, interaction })
    try {
      tui.sync.set("session_status", "ses_test", { type: "busy" })
      tui.app.mockInput.pressKey("c", { ctrl: true })
      await wait(() => tui.paths.includes("/api/session/ses_test/interrupt"))
      tui.app.mockInput.pressEscape()
      await wait(() =>
        tui.paths.includes(
          interaction === "permission"
            ? "/api/session/ses_test/permission/per_test/reply"
            : "/api/session/ses_test/question/que_test/reject",
        ),
      )
      expect(tui.paths.some((path) => path.startsWith(`/${interaction}/`))).toBe(false)
    } finally {
      tui.dispose()
    }
  },
)
