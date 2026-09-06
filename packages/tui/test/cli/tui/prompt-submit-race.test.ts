import { expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { createFetch } from "../../fixture/tui-sdk"
import { createPromptSubmission, type SubmissionSnapshot } from "../../../src/component/prompt/submission"

function snapshot(): SubmissionSnapshot {
  return {
    id: "msg_original",
    sessionID: "ses_test",
    delivery: "queue",
    draft: { input: "follow up", parts: [] },
    prompt: { text: "follow up", selection: { agent: "build", model: { providerID: "test", id: "model" } } },
    create: false,
    editor: false,
  }
}

test("admission acknowledgement gates completion and concurrent submits do not create phantom messages", async () => {
  const acknowledged = Promise.withResolvers<void>()
  const received: SubmissionSnapshot[] = []
  const submission = createPromptSubmission({
    changed() {},
    async send(value) {
      received.push(value)
      await acknowledged.promise
      return { ...value, prompt: { text: value.prompt.text }, admittedSeq: 1, timeCreated: 0, status: "admitted" }
    },
  })
  const original = snapshot()
  const pending = submission.submit(() => original)
  original.prompt.text = "edited while sending"
  original.prompt.selection!.agent = "plan"
  expect(submission.state.type).toBe("admitting")
  expect(await submission.submit(snapshot)).toBeUndefined()
  expect(received).toHaveLength(1)
  expect(received[0].prompt.text).toBe("follow up")
  expect(received[0].prompt.selection?.agent).toBe("build")
  acknowledged.resolve()
  expect((await pending)?.draft.input).toBe("follow up")
  expect(submission.state.type).toBe("idle")
})

test("ambiguous admission retries the identical ID, delivery, attachments and selection and reconciles once", async () => {
  const received: SubmissionSnapshot[] = []
  const submission = createPromptSubmission({
    changed() {},
    async send(value) {
      received.push(value)
      if (received.length === 1) throw new TypeError("connection lost after commit")
      return { ...value, prompt: { text: value.prompt.text }, admittedSeq: 7, timeCreated: 0, status: "reconciled" }
    },
  })
  const original = snapshot()
  original.prompt.files = [{ uri: "data:text/plain;base64,QQ==", name: "a.txt" }]
  await expect(submission.submit(() => original)).rejects.toThrow("connection lost")
  expect(submission.state.type).toBe("uncertain")
  await submission.submit(() => ({ ...snapshot(), id: "msg_wrong", delivery: "steer" }))
  expect(received[1]).toEqual(received[0])
  expect(received[1].id).toBe("msg_original")
  expect(submission.state.type).toBe("idle")
})

test("a declared rejection preserves the draft and allows a corrected new submission", async () => {
  const received: SubmissionSnapshot[] = []
  const submission = createPromptSubmission({
    changed() {},
    async send(value) {
      received.push(value)
      if (received.length === 1) throw { _tag: "ConflictError", message: "conflicting ID" }
      return { ...value, prompt: { text: value.prompt.text }, admittedSeq: 8, timeCreated: 0, status: "admitted" }
    },
  })
  const original = snapshot()
  await expect(submission.submit(() => original)).rejects.toMatchObject({ _tag: "ConflictError" })
  expect(original.draft.input).toBe("follow up")
  expect(submission.state.type).toBe("error")
  await submission.submit(() => ({ ...snapshot(), id: "msg_corrected" }))
  expect(received[1].id).toBe("msg_corrected")
})

test("generated SDK wrapped request rejection is definite, while a server failure remains uncertain", async () => {
  for (const status of [409, 500]) {
    const sdk = createOpencodeClient({
      baseUrl: "http://test",
      fetch: createFetch(() =>
        Response.json(
          { _tag: status === 409 ? "ConflictError" : "UnknownError", message: "request failed" },
          { status },
        ),
      ).fetch,
    })
    const submission = createPromptSubmission({
      changed() {},
      async send(value) {
        const response = await sdk.v2.session.prompt(
          { sessionID: value.sessionID, id: value.id, prompt: value.prompt },
          { throwOnError: true },
        )
        return response.data.data
      },
    })
    await expect(submission.submit(snapshot)).rejects.toThrow("request failed")
    expect(submission.state.type).toBe(status === 409 ? "error" : "uncertain")
  }
})
