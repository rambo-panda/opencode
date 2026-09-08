import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test.each(["live-b", "Work account"])("API-key provider aliases are labeled and selectable by %s", async (query) => {
  await using state = await tmpdir()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const providers = [
    { id: "live-upstream", name: "Live upstream" },
    { id: "live-a", name: "Personal account", canonical: "live-upstream", settings: { apiKey: "test-a" } },
    { id: "live-b", name: "Work account", canonical: "live-upstream", settings: { apiKey: "test-b" } },
  ]
  const session = {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Provider alias fixture",
    agent: "build",
    model: { providerID: "live-upstream", id: "qa-model" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const mutations: { type: string; body: unknown }[] = []
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false, tabs: { enabled: false }, keybinds: { "model.list": "f8" } },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/integration") return json({ location, data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: providers })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: providers.map((provider) => ({
            id: "qa-model",
            providerID: provider.id,
            name: "Live QA model",
            variants: [],
            cost: [],
            time: { released: 0 },
          })),
        })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname.endsWith("/model") && request.method === "POST") {
        mutations.push({ type: "model", body: await request.json() })
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
            timeCreated: 1,
            payload: { text: body.text },
            delivery: "steer",
          },
        })
      }
    },
  })
  await setup.waitForFrame((frame) => frame.includes("Build · Live QA model Live upstream"))
  setup.mockInput.pressKey("F8")
  const listing = await setup.waitForFrame(
    (frame) =>
      frame.includes("Select model") &&
      frame.includes("Work account") &&
      setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  expect(listing).toContain("Personal account")
  expect(listing).toContain("View all integrations")
  await setup.mockInput.typeText(query)
  await setup.waitForFrame((frame) => frame.includes(query) && !frame.includes("Personal account"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Build · Live QA model Work account") &&
      setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  await setup.mockInput.typeText("Use selected account")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => mutations.some((item) => item.type === "prompt"))
  expect(mutations[0]).toEqual({ type: "model", body: { model: { providerID: "live-b", id: "qa-model" } } })
})
