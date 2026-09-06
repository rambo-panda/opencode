/** @jsxImportSource @opentui/solid */
import { expect, test, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import type { GlobalEvent, SessionInputAdmitted } from "@opencode-ai/sdk/v2"
import { directory, json, mount, wait } from "./sync-fixture"

const sessionID = "ses_hydration_race"
const messageID = "msg_hydration_race"
const session = { id: sessionID, title: "race", time: { created: 0, updated: 0 }, version: "1.18.29", directory }
const assistant = {
  id: messageID,
  type: "assistant",
  agent: "build",
  model: { providerID: "test", id: "model" },
  time: { created: 1 },
  content: [{ type: "text", id: "text", text: "" }],
}

let temporary: Awaited<ReturnType<typeof tmpdir>>
beforeEach(async () => {
  temporary = await tmpdir()
  await Bun.write(`${temporary.path}/kv.json`, "{}")
})
afterEach(async () => temporary[Symbol.asyncDispose]())

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

function fixture(url: URL) {
  if (url.pathname === `/session/${sessionID}`) return json(session)
  if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
}

function admitted(id: string, delivery: "steer" | "queue", admittedSeq: number): SessionInputAdmitted {
  return { id, sessionID, delivery, admittedSeq, timeCreated: admittedSeq, prompt: { text: id } }
}

function admission(input: SessionInputAdmitted): GlobalEvent {
  return global({
    id: `evt_${input.id}`,
    type: "sync",
    syncEvent: {
      id: `evt_${input.id}`,
      type: "session.next.prompt.admitted.1",
      seq: input.admittedSeq,
      aggregateID: sessionID,
      data: {
        sessionID,
        messageID: input.id,
        delivery: input.delivery,
        prompt: input.prompt,
        timestamp: input.timeCreated,
      },
    },
  })
}

test("V2 hydration preserves durable projection order instead of sorting random message IDs", async () => {
  const { app, sync } = await mount((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`)
      return json({
        data: ["msg_a", "msg_z", "msg_b"].map((id) => ({ id, type: "user", text: id, time: { created: 1 } })),
        cursor: {},
      })
    return fixture(url)
  }, temporary.path)
  try {
    await sync.session.sync(sessionID)
    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_b", "msg_z", "msg_a"])
  } finally {
    app.renderer.destroy()
  }
})

test("V2 hydration replays live completion without duplicating content already in the snapshot", async () => {
  const response = Promise.withResolvers<Response>()
  const requested = Promise.withResolvers<void>()
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) {
      requested.resolve()
      return response.promise
    }
    return fixture(url)
  }, temporary.path)
  try {
    const hydrate = sync.session.sync(sessionID)
    await requested.promise
    emit(
      global({
        id: "evt_started",
        type: "session.next.text.started",
        properties: { sessionID, assistantMessageID: messageID, textID: "text", timestamp: 2 },
      }),
    )
    emit(
      global({
        id: "evt_delta",
        type: "session.next.text.delta",
        properties: { sessionID, assistantMessageID: messageID, textID: "text", delta: "live", timestamp: 3 },
      }),
    )
    emit(
      global({
        id: "evt_ended",
        type: "session.next.text.ended",
        properties: { sessionID, assistantMessageID: messageID, textID: "text", text: "live", timestamp: 4 },
      }),
    )
    response.resolve(
      json({ data: [{ ...assistant, content: [{ type: "text", id: "text", text: "live" }] }], cursor: {} }),
    )
    await hydrate
    await wait(() => sync.data.part[messageID]?.[0]?.type === "text")
    await app.renderOnce()
    expect(sync.data.part[messageID]).toHaveLength(1)
    expect(sync.data.part[messageID][0]).toMatchObject({ text: "live" })
  } finally {
    app.renderer.destroy()
  }
})

test("durable pending hydration restores STEER and FIFO queue and reconciles promotion", async () => {
  const steer = admitted("msg_steer", "steer", 4)
  const first = admitted("msg_first", "queue", 5)
  const second = admitted("msg_second", "queue", 6)
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/api/session/${sessionID}/state`)
      return json({ data: { execution: { type: "running" }, pending: [steer, first, second], after: 6 } })
    return fixture(url)
  }, temporary.path)
  try {
    await sync.session.sync(sessionID)
    expect(sync.data.session_pending[sessionID].map((input) => [input.delivery, input.id])).toEqual([
      ["steer", steer.id],
      ["queue", first.id],
      ["queue", second.id],
    ])
    expect(sync.data.session_status[sessionID]).toEqual({ type: "busy" })
    emit(
      global({
        id: "evt_promoted",
        type: "sync",
        syncEvent: {
          id: "evt_promoted",
          type: "session.next.prompted.1",
          seq: 7,
          aggregateID: sessionID,
          data: { sessionID, messageID: steer.id, prompt: steer.prompt, delivery: "steer", timestamp: 7 },
        },
      }),
    )
    emit(
      global({
        id: "evt_promoted",
        type: "session.next.prompted",
        properties: { sessionID, messageID: steer.id, prompt: steer.prompt, delivery: "steer", timestamp: 7 },
      }),
    )
    await wait(() => sync.data.session_pending[sessionID].length === 2 && sync.data.message[sessionID]?.length === 1)
    emit(admission(steer))
    await app.renderOnce()
    expect(sync.data.session_pending[sessionID].map((input) => input.id)).toEqual([first.id, second.id])
    expect(sync.data.message[sessionID][0].id).toBe(steer.id)
  } finally {
    app.renderer.destroy()
  }
})

test("stale pending snapshot cannot erase admission or regress a live stopping transition", async () => {
  const response = Promise.withResolvers<Response>()
  const requested = Promise.withResolvers<void>()
  const input = admitted("msg_new", "queue", 9)
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/api/session/${sessionID}/state`) {
      requested.resolve()
      return response.promise
    }
    return fixture(url)
  }, temporary.path)
  try {
    const hydrate = sync.session.state(sessionID)
    await requested.promise
    emit(admission(input))
    emit(
      global({
        id: "evt_stopping",
        type: "session.next.execution.changed",
        properties: { sessionID, status: { type: "stopping" } },
      }),
    )
    await wait(() => sync.data.session_status[sessionID]?.type === "stopping")
    response.resolve(json({ data: { execution: { type: "running" }, pending: [], after: 8 } }))
    await hydrate
    expect(sync.data.session_pending[sessionID]).toEqual([input])
    expect(sync.data.session_status[sessionID]).toEqual({ type: "stopping" })
  } finally {
    app.renderer.destroy()
  }
})

test("reconnect replaces stale pending state from the durable server snapshot", async () => {
  const first = admitted("msg_old", "steer", 1)
  const next = admitted("msg_new", "queue", 3)
  let pending = [first]
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/api/session/${sessionID}/state`)
      return json({ data: { execution: { type: "idle" }, pending, after: pending[0].admittedSeq } })
    return fixture(url)
  }, temporary.path)
  try {
    await sync.session.sync(sessionID)
    expect(sync.data.session_pending[sessionID]).toEqual([first])
    pending = [next]
    emit(global({ id: "evt_connected", type: "server.connected", properties: {} }))
    await wait(() => sync.data.session_pending[sessionID]?.[0]?.id === next.id)
    expect(sync.data.session_pending[sessionID]).toEqual([next])
  } finally {
    app.renderer.destroy()
  }
})

test("V2 interrupt preserves pending and refreshes the automatic successor state", async () => {
  const stop = Promise.withResolvers<Response>()
  const requested = Promise.withResolvers<void>()
  const input = admitted("msg_followup", "queue", 2)
  const { app, sync } = await mount((url) => {
    if (url.pathname === `/api/session/${sessionID}/state`)
      return json({ data: { execution: { type: "running" }, pending: [input], after: 2 } })
    if (url.pathname === `/api/session/${sessionID}/interrupt`) {
      requested.resolve()
      return stop.promise
    }
    return fixture(url)
  }, temporary.path)
  try {
    await sync.session.state(sessionID)
    sync.set("permission", sessionID, [
      { id: "per_cancelled", sessionID, permission: "bash", patterns: ["pwd"], always: [], metadata: {} },
    ])
    sync.set("question", sessionID, [{ id: "que_cancelled", sessionID, questions: [] }])
    const interrupt = sync.session.interrupt(sessionID)
    await requested.promise
    expect(sync.data.session_status[sessionID]).toEqual({ type: "stopping" })
    expect(sync.data.session_pending[sessionID]).toEqual([input])
    stop.resolve(new Response(null, { status: 204 }))
    await interrupt
    expect(sync.data.session_pending[sessionID]).toEqual([input])
    expect(sync.data.session_status[sessionID]).toEqual({ type: "busy" })
    expect(sync.data.permission[sessionID]).toEqual([])
    expect(sync.data.question[sessionID]).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})
