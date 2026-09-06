import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"

async function wait(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw new Error("TUI did not reach expected state")
}

test.each(["navigation", "digits"])("Primary TUI /delete confirms using %s", async (input) => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await createTestRenderer({ width: 120, height: 32, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const session = {
    id: "ses_delete",
    title: "Delete command fixture",
    slug: "delete-command",
    projectID: "proj_test",
    directory,
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers")
      return json({
        providers: [{ id: "test", name: "Test", models: { model: { id: "model", name: "Model", variants: {} } } }],
        default: { test: "model" },
      })
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", options: {}, permission: [] }])
    if (url.pathname === "/provider")
      return json({ all: [{ id: "test", name: "Test", models: {} }], default: { test: "model" }, connected: ["test"] })
    if (url.pathname === "/session") return json([session])
    if (url.pathname === "/session/ses_delete") return json(session)
    if (["/session/ses_delete/children", "/session/ses_delete/todo", "/session/ses_delete/diff"].includes(url.pathname))
      return json([])
  }, events)
  const requests: string[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push(`${request.method} ${new URL(request.url).pathname}`)
    if (request.method === "DELETE") return json(true)
    return calls.fetch(input, init)
  }) as typeof globalThis.fetch
  const ready = Promise.withResolvers<TuiPluginApi>()
  let dispose = () => {}
  const { run } = await import("../../../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch,
      events: events.source,
      args: { sessionID: session.id },
      pluginHost: {
        async start(input) {
          dispose = input.runtime.setupSlots(input.api).dispose
          ready.resolve(input.api)
        },
        async dispose() {
          dispose()
        },
      },
    }).pipe(Effect.provide(Global.layerWith({ home: tmp.path, data: tmp.path, state: tmp.path }))),
  )

  try {
    const api = await ready.promise
    await wait(
      () => api.route.current.name === "session" && setup.renderer.currentFocusedEditor instanceof TextareaRenderable,
    )
    await setup.renderOnce()
    await setup.mockInput.typeText("/delete")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Delete session")

    setup.mockInput.pressEnter()
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Delete this session?")
    expect(setup.captureCharFrame()).toContain("Cannot be undone. Subagent threads will also be deleted.")
    expect(setup.captureCharFrame()).toContain("1. No, keep this session")
    expect(setup.captureCharFrame()).toContain("2. Yes, delete and exit")
    expect(requests.filter((request) => request.startsWith("DELETE"))).toEqual([])

    setup.mockInput.pressKey(input === "digits" ? "1" : "RETURN")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("Delete this session?")
    expect(api.route.current).toEqual({ name: "session", params: { sessionID: session.id } })
    expect(requests.filter((request) => request.startsWith("DELETE"))).toEqual([])

    await wait(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = setup.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused composer")
    expect(textarea.plainText).toBe("")
    await setup.mockInput.typeText("12")
    expect(textarea.plainText).toBe("12")
    expect(requests.filter((request) => request.startsWith("DELETE"))).toEqual([])
    setup.mockInput.pressBackspace()
    setup.mockInput.pressBackspace()

    await setup.mockInput.typeText("/delete")
    await setup.renderOnce()
    setup.mockInput.pressEnter()
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Delete this session?")
    if (input === "navigation") setup.mockInput.pressArrow("down")
    setup.mockInput.pressKey(input === "digits" ? "2" : "RETURN")
    await wait(() => api.route.current.name === "home")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("Delete this session?")
    expect(requests.filter((request) => request.startsWith("DELETE"))).toEqual(["DELETE /session/ses_delete"])
    expect(requests).toContain("GET /api/session/ses_delete/state")
    expect(requests).toContain("GET /session/ses_delete/children")
    expect(requests.some((request) => request.endsWith("/prompt") || request.endsWith("/interrupt"))).toBe(false)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await task
    mock.restore()
  }
})
