/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { DialogSessionDelete } from "../../../src/component/dialog-session-delete"
import { TuiConfigProvider } from "../../../src/config"
import { KVProvider } from "../../../src/context/kv"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { SDKProvider } from "../../../src/context/sdk"
import { ThemeProvider } from "../../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider, useToast } from "../../../src/ui/toast"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { eventSource, json } from "../../fixture/tui-sdk"

async function wait(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw new Error("Delete dialog did not reach expected state")
}

async function mount(input: {
  state: string
  execution?: "idle" | "running" | "stopping"
  pending?: boolean
  child?: boolean
  failure?: "http" | "network" | "state"
}) {
  await Bun.write(`${input.state}/kv.json`, "{}")
  const calls: string[] = []
  const deleted = Promise.withResolvers<void>()
  const sent = Promise.withResolvers<void>()
  const config = createTuiResolvedConfig()
  let route!: ReturnType<typeof useRoute>
  let dialog!: ReturnType<typeof useDialog>
  let toast!: ReturnType<typeof useToast>
  const fetch = (async (request: Request) => {
    const pathname = new URL(request.url).pathname
    calls.push(`${request.method} ${pathname}`)
    if (request.method === "DELETE") {
      sent.resolve()
      await deleted.promise
      if (input.failure === "network") throw new TypeError("Connection lost")
      if (input.failure === "http") return json({ message: "Cannot delete session" }, { status: 500 })
      return json(true)
    }
    if (pathname.endsWith("/children"))
      return json(input.child && pathname.includes("ses_test/") ? [{ id: "ses_child" }] : [])
    if (pathname.endsWith("/state")) {
      if (input.failure === "state") return json({ message: "State unavailable" }, { status: 500 })
      const target = !input.child || pathname.includes("ses_child/")
      return json({
        data: {
          execution: { type: target ? (input.execution ?? "idle") : "idle" },
          pending: target && input.pending ? [{ id: "msg_queued" }] : [],
          after: -1,
        },
      })
    }
    throw new Error(`Unexpected request: ${request.method} ${pathname}`)
  }) as typeof globalThis.fetch

  function Open() {
    route = useRoute()
    dialog = useDialog()
    toast = useToast()
    onMount(() => dialog.replace(() => <DialogSessionDelete sessionID="ses_test" />))
    return null
  }
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts paths={{ state: input.state }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <RouteProvider initialRoute={{ type: "session", sessionID: "ses_test" }}>
                    <SDKProvider url="http://test" fetch={fetch} events={eventSource()}>
                      <DialogProvider>
                        <Open />
                      </DialogProvider>
                    </SDKProvider>
                  </RouteProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }
  const app = await testRender(() => <Harness />, { width: 120, height: 30, kittyKeyboard: true })
  await wait(() => dialog?.stack.length === 1)
  await app.renderOnce()
  return { app, calls, route, dialog, toast, deleted, sent }
}

test("delete dialog shows irreversible child deletion warning and defaults to keeping the session", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    const frame = tui.app.captureCharFrame()
    expect(frame).toContain("Delete this session?")
    expect(frame).toContain("Cannot be undone. Subagent threads will also be deleted.")
    expect(frame).toContain("1. No, keep this session")
    expect(frame).toContain("2. Yes, delete and exit")
    tui.app.mockInput.pressEnter()
    expect(tui.dialog.stack).toHaveLength(0)
    expect(tui.route.data.type).toBe("session")
    expect(tui.calls).toEqual([])
  } finally {
    tui.app.renderer.destroy()
  }
})

test.each(["escape", "ctrl+c"])("%s cancels deletion even when Yes is selected", async (key) => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    tui.app.mockInput.pressArrow("down")
    if (key === "escape") tui.app.mockInput.pressKey("ESCAPE")
    if (key === "ctrl+c") tui.app.mockInput.pressKey("c", { ctrl: true })
    expect(tui.dialog.stack).toHaveLength(0)
    expect(tui.route.data.type).toBe("session")
    expect(tui.calls).toEqual([])
  } finally {
    tui.app.renderer.destroy()
  }
})

test("1 immediately keeps the session even when Yes is selected", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    tui.app.mockInput.pressArrow("down")
    tui.app.mockInput.pressKey("1")
    expect(tui.dialog.stack).toHaveLength(0)
    expect(tui.route.data.type).toBe("session")
    expect(tui.calls).toEqual([])
  } finally {
    tui.app.renderer.destroy()
  }
})

test("2 immediately deletes without Enter and repeated digits cannot duplicate or dismiss the pending request", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path })
  try {
    expect(tui.app.captureCharFrame()).toContain("1 keep · 2 delete")
    tui.app.mockInput.pressKey("2")
    tui.app.mockInput.pressKey("2")
    await tui.sent.promise
    tui.app.mockInput.pressKey("2")
    tui.app.mockInput.pressKey("1")
    expect(tui.route.data.type).toBe("session")
    expect(tui.dialog.stack).toHaveLength(1)
    expect(tui.calls.filter((call) => call.startsWith("DELETE"))).toEqual(["DELETE /session/ses_test"])
    tui.deleted.resolve()
    await wait(() => tui.route.data.type === "home")
    expect(tui.dialog.stack).toHaveLength(0)
  } finally {
    tui.deleted.resolve()
    tui.app.renderer.destroy()
  }
})

test("confirmed deletion checks children, deletes once and returns home only after acknowledgement", async () => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path, child: true })
  try {
    tui.app.mockInput.pressArrow("down")
    tui.app.mockInput.pressEnter()
    await tui.sent.promise
    tui.app.mockInput.pressEnter()
    expect(tui.route.data.type).toBe("session")
    expect(tui.dialog.stack).toHaveLength(1)
    expect(tui.calls).toContain("GET /api/session/ses_child/state")
    expect(tui.calls).toContain("GET /session/ses_child/children")
    expect(tui.calls.filter((call) => call.startsWith("DELETE"))).toEqual(["DELETE /session/ses_test"])
    tui.deleted.resolve()
    await wait(() => tui.route.data.type === "home")
    expect(tui.dialog.stack).toHaveLength(0)
  } finally {
    tui.deleted.resolve()
    tui.app.renderer.destroy()
  }
})

test.each(["http", "network", "state"] as const)("%s failure keeps the session and shows an error", async (failure) => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path, failure })
  try {
    tui.deleted.resolve()
    tui.app.mockInput.pressArrow("down")
    tui.app.mockInput.pressEnter()
    await wait(() => tui.toast.currentToast?.variant === "error")
    expect(tui.toast.currentToast?.title).toBe("Failed to delete session")
    expect(tui.route.data.type).toBe("session")
    expect(tui.dialog.stack).toHaveLength(1)
    if (failure === "state") expect(tui.calls.some((call) => call.startsWith("DELETE"))).toBe(false)
  } finally {
    tui.app.renderer.destroy()
  }
})

test.each([
  { execution: "running" as const },
  { execution: "stopping" as const },
  { pending: true },
  { child: true, execution: "running" as const },
  { child: true, pending: true },
])("2 cannot delete active or pending session/subagent work: %j", async (state) => {
  await using tmp = await tmpdir()
  const tui = await mount({ state: tmp.path, ...state })
  try {
    tui.app.mockInput.pressKey("2")
    await wait(() => tui.toast.currentToast?.variant === "warning")
    expect(tui.calls.some((call) => call.startsWith("DELETE"))).toBe(false)
    expect(tui.calls.some((call) => call.includes("interrupt"))).toBe(false)
    expect(tui.route.data.type).toBe("session")
    expect(tui.dialog.stack).toHaveLength(1)
  } finally {
    tui.app.renderer.destroy()
  }
})
