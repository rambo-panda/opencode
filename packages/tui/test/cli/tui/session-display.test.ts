import { expect, test } from "bun:test"
import type { Session, SessionMessage } from "@opencode-ai/sdk/v2"
import { permissionDisplay, sessionDisplay } from "../../../src/context/session-display"

const session: Session = {
  id: "ses_display",
  projectID: "proj_test",
  slug: "display",
  directory: "/tmp/display",
  version: "1.18.29",
  title: "Display",
  time: { created: 0, updated: 0 },
}

test("V2 terminal presentation preserves attachment identity, tools, usage and history order", () => {
  const messages: SessionMessage[] = [
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "test" },
      time: { created: 2, completed: 3 },
      finish: "stop",
      cost: 1,
      content: [
        { type: "text", id: "text", text: "Done" },
        { type: "reasoning", id: "reason", text: "Reason" },
        {
          type: "tool",
          id: "call",
          name: "bash",
          time: { created: 2, ran: 2, completed: 3 },
          state: {
            status: "completed",
            input: { command: "pwd" },
            structured: {},
            content: [{ type: "text", text: "/tmp/display" }],
          },
        },
      ],
    },
    {
      id: "msg_user",
      type: "user",
      text: "Hello",
      files: [{ uri: "file:///tmp/test.txt", mime: "text/plain", name: "test.txt" }],
      time: { created: 1 },
    },
  ]
  const display = sessionDisplay(session, messages)
  expect(display.messages.map((message) => message.id)).toEqual(["msg_user", "msg_assistant"])
  expect(display.messages[1]).toMatchObject({ parentID: "msg_user", cost: 1, finish: "stop" })
  expect(display.parts.msg_user[1]).toMatchObject({ type: "file", filename: "test.txt", mime: "text/plain" })
  expect(display.parts.msg_assistant[2]).toMatchObject({
    tool: "bash",
    state: { status: "completed", output: "/tmp/display" },
  })
  expect(sessionDisplay(session, messages).parts).toEqual(display.parts)
})

test("V2 historical shell and compaction remain visible without displaying internal context", () => {
  const display = sessionDisplay(session, [
    {
      id: "msg_compact",
      type: "compaction",
      reason: "auto",
      summary: "summary",
      recent: "recent",
      time: { created: 3 },
    },
    {
      id: "msg_shell",
      type: "shell",
      callID: "call",
      command: "pwd",
      output: "/tmp/display",
      time: { created: 2, completed: 2 },
    },
    { id: "msg_context", type: "system", text: "internal context", time: { created: 1 } },
  ])
  expect(display.messages.map((message) => message.id)).toEqual(["msg_shell", "msg_compact"])
  expect(display.parts.msg_shell[0]).toMatchObject({ type: "text", text: "$ pwd\n/tmp/display" })
  expect(display.parts.msg_compact[0]).toMatchObject({ type: "compaction", auto: true })
})

test("durable V2 interruptions retain partial output and recover cancellation styling on reload", () => {
  const interrupted: SessionMessage = {
    id: "msg_interrupted",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "test" },
    time: { created: 2, completed: 3 },
    finish: "error",
    error: { type: "unknown", message: "Provider turn interrupted" },
    content: [{ type: "text", id: "partial", text: "Partial response" }],
  }
  for (const message of [interrupted, structuredClone(interrupted), { ...interrupted, content: [] }]) {
    const display = sessionDisplay(session, [message])
    expect(display.messages[0]).toMatchObject({
      time: { completed: 3 },
      error: { name: "MessageAbortedError", data: { message: "Provider turn interrupted" } },
    })
    expect(display.parts.msg_interrupted.map((part) => part.type === "text" && part.text)).toEqual(
      message.content.map((part) => part.type === "text" && part.text),
    )
  }
  const failed = sessionDisplay(session, [
    { ...interrupted, error: { type: "unknown", message: "Provider unavailable" } },
  ])
  expect(failed.messages[0]).toMatchObject({
    error: { name: "UnknownError", data: { message: "Provider unavailable" } },
  })
})

test("V2 permission presentation retains session scoped tool identity", () => {
  expect(
    permissionDisplay({
      id: "per_test",
      sessionID: session.id,
      action: "bash",
      resources: ["pwd"],
      source: { type: "tool", messageID: "msg_assistant", callID: "call" },
    }),
  ).toMatchObject({ permission: "bash", patterns: ["pwd"], tool: { messageID: "msg_assistant", callID: "call" } })
})
