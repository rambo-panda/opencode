import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const base = {
  id: "ses_personal",
  projectID: "project",
  title: "Personal session fixture",
  agent: "build",
  model: { providerID: "demo", id: "model" },
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const location = { directory, project: { id: "project", directory, canonical: directory } }

async function fixture(state: string, mode: string) {
  const session = { ...base, id: `ses_${crypto.randomUUID()}` }
  const mutations: { type: string; body: unknown }[] = []
  const running = ["ctrl-c", "ctrl-c-empty", "escape", "queue", "steer", "autocomplete", "active"].includes(mode)
  const setup = await createAppFixture({
    state,
    config: { animations: false, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            { id: "model", providerID: "demo", name: "Demo model", variants: [], cost: [], time: { released: 0 } },
          ],
        })
      if (url.pathname === "/api/session/active")
        return json({
          data: running
            ? { [session.id]: { type: "running" } }
            : ["child", "child-page"].includes(mode)
              ? { ses_child: { type: "running" } }
              : {},
        })
      if (url.pathname === "/api/session")
        return json({
          data: url.searchParams.has("parentID")
            ? ["child", "child-page"].includes(mode) &&
              (mode !== "child-page" || url.searchParams.has("cursor")) &&
              url.searchParams.get("parentID") === session.id
              ? [{ ...session, id: "ses_child", parentID: session.id }]
              : []
            : [session],
          cursor:
            mode === "child-page" && url.searchParams.get("parentID") === session.id && !url.searchParams.has("cursor")
              ? { next: "page2" }
              : {},
        })
      if (url.pathname === `/api/session/${session.id}`) {
        if (request.method !== "DELETE") return json({ data: session })
        mutations.push({ type: "delete", body: undefined })
        if (mode === "failure") return json({ message: "Delete failed" }, { status: 503 })
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith("/message"))
        return json({
          data: [
            ...(mode.startsWith("interrupted")
              ? [
                  {
                    id: "msg_interrupted",
                    type: "assistant",
                    agent: "build",
                    model: session.model,
                    content: mode === "interrupted-text" ? [{ type: "text", text: "Partial answer" }] : [],
                    error: { type: "Interrupted", message: "Step interrupted" },
                    time: { created: 1, completed: 2 },
                  },
                ]
              : []),
            { id: "msg_initial", type: "user", text: "Initial request", time: { created: 0 } },
          ],
          cursor: {},
        })
      if (url.pathname.endsWith("/inbox"))
        return json({
          data:
            mode === "pending"
              ? [
                  {
                    id: "msg_queued",
                    sessionID: session.id,
                    type: "user",
                    delivery: "queue",
                    timeCreated: 1,
                    payload: { text: "Queued request" },
                  },
                ]
              : [],
        })
      if (url.pathname.endsWith("/permission")) return json({ data: [] })
      if (url.pathname.endsWith("/interrupt")) {
        mutations.push({ type: "interrupt", body: { resume: url.searchParams.get("resume") } })
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith("/prompt")) {
        const body = await request.json()
        mutations.push({ type: "prompt", body })
        return json({
          data: {
            id: body.id,
            sessionID: session.id,
            type: "user",
            delivery: body.delivery,
            timeCreated: 1,
            payload: { text: body.text },
          },
        })
      }
    },
  })
  return Object.assign(setup, { mutations })
}

test.each(["ctrl-c", "ctrl-c-empty", "escape"])(
  "one %s interrupts a running session without clearing its draft",
  async (mode) => {
    await using state = await tmpdir()
    await using setup = await fixture(state.path, mode)
    await setup.waitForFrame(
      (frame) =>
        frame.includes("interrupt") &&
        frame.includes("Build · Demo model") &&
        setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    if (mode !== "ctrl-c-empty") await setup.mockInput.typeText("Keep this draft")
    if (mode.startsWith("ctrl-c")) setup.mockInput.pressKey("c", { ctrl: true })
    if (mode === "escape") setup.mockInput.pressEscape()
    await setup.waitFor(() => setup.mutations.length === 1)
    expect(setup.mutations).toEqual([{ type: "interrupt", body: { resume: "true" } }])
    expect(setup.renderer.isDestroyed).toBe(false)
    expect((setup.renderer.currentFocusedRenderable as TextareaRenderable).plainText).toBe(
      mode === "ctrl-c-empty" ? "" : "Keep this draft",
    )
  },
)

test.each(["queue", "steer", "autocomplete"])("running prompt keyboard delivery: %s", async (mode) => {
  await using state = await tmpdir()
  await using setup = await fixture(state.path, mode)
  await setup.waitForFrame(
    (frame) =>
      frame.includes("interrupt") &&
      frame.includes("Build · Demo model") &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  if (mode === "autocomplete") {
    await setup.mockInput.typeText("/del")
    await setup.waitForFrame((frame) => frame.includes("Delete session"))
    setup.mockInput.pressKey("TAB")
    await setup.waitForVisualIdle()
    expect(setup.mutations).toHaveLength(0)
    expect(setup.captureCharFrame()).toContain("Delete this session?")
    return
  }
  await setup.mockInput.typeText("Follow-up request")
  if (mode === "queue") setup.mockInput.pressKey("TAB")
  if (mode === "steer") setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.mutations.length === 1)
  expect(setup.mutations[0]).toMatchObject({ type: "prompt", body: { text: "Follow-up request", delivery: mode } })
})

test.each(["keep", "delete", "active", "child", "child-page", "pending", "failure"])(
  "/delete confirmation: %s",
  async (mode) => {
    await using state = await tmpdir()
    await using setup = await fixture(state.path, mode)
    await setup.waitForFrame(
      (frame) =>
        frame.includes("Initial request") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
    )
    await setup.mockInput.typeText("/delete")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Delete this session?"))
    setup.mockInput.pressKey(mode === "keep" ? "1" : "2")
    if (["active", "child", "child-page", "pending"].includes(mode)) {
      await setup.waitForFrame((frame) => frame.includes("pending work."))
      expect(setup.mutations).toHaveLength(0)
      return
    }
    if (mode === "failure") {
      await setup.waitForFrame((frame) => frame.includes("UnexpectedStatus"))
      expect(setup.captureCharFrame()).toContain("Delete this session?")
      return
    }
    await setup.waitForFrame((frame) => !frame.includes("Delete this session?"))
    expect(setup.mutations).toEqual(mode === "keep" ? [] : [{ type: "delete", body: undefined }])
    if (mode === "keep") expect(setup.captureCharFrame()).toContain("Initial request")
    if (mode === "delete") expect(setup.captureCharFrame()).not.toContain("Initial request")
  },
)

test.each(["interrupted-text", "interrupted-empty"])("reloaded transcript marks %s", async (mode) => {
  await using state = await tmpdir()
  await using setup = await fixture(state.path, mode)
  const frame = await setup.waitForFrame((frame) => frame.includes("■ Conversation interrupted"))
  expect(frame).not.toContain("Error: Step interrupted")
  if (mode === "interrupted-text") await setup.waitForFrame((frame) => frame.includes("Partial answer"))
})
