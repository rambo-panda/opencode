import type { LocationRef, PromptInput, SessionInputReceipt } from "@opencode-ai/sdk/v2"
import type { PromptInfo } from "../../prompt/history"

export type SubmissionSnapshot = {
  id: string
  sessionID: string
  delivery: "steer" | "queue"
  prompt: PromptInput
  draft: PromptInfo
  location?: LocationRef
  create: boolean
  editor: boolean
}

export type SubmissionState =
  | { type: "idle" }
  | { type: "admitting" | "uncertain" | "error"; snapshot: SubmissionSnapshot }

export function createPromptSubmission(input: {
  send: (snapshot: SubmissionSnapshot) => Promise<SessionInputReceipt>
  changed: (state: SubmissionState) => void
  uncertain?: SubmissionSnapshot
}) {
  let state: SubmissionState = input.uncertain ? { type: "uncertain", snapshot: input.uncertain } : { type: "idle" }
  return {
    get state() {
      return state
    },
    async submit(snapshot: () => SubmissionSnapshot) {
      if (state.type === "admitting") return
      const current = state.type === "uncertain" ? state.snapshot : structuredClone(snapshot())
      state = { type: "admitting", snapshot: current }
      input.changed(state)
      return input.send(current).then(
        (receipt) => {
          if (
            (receipt.status !== "admitted" && receipt.status !== "reconciled") ||
            receipt.id !== current.id ||
            receipt.sessionID !== current.sessionID ||
            receipt.delivery !== current.delivery
          ) {
            state = { type: "uncertain", snapshot: current }
            input.changed(state)
            throw new Error("Admission acknowledgement did not match the submitted message")
          }
          state = { type: "idle" }
          input.changed(state)
          return current
        },
        (error: unknown) => {
          // Declared request errors prove rejection; transport/server failures may follow a committed admission.
          const body =
            error instanceof Error && typeof error.cause === "object" && error.cause !== null && "body" in error.cause
              ? error.cause.body
              : error
          const definite =
            typeof body === "object" &&
            body !== null &&
            "_tag" in body &&
            ["ConflictError", "InvalidRequestError", "SessionNotFoundError", "UnauthorizedError"].includes(
              String(body._tag),
            )
          state = { type: definite ? "error" : "uncertain", snapshot: current }
          input.changed(state)
          throw error
        },
      )
    },
  }
}

export function canQueuePrompt(input: { status: string; text: string; autocomplete: boolean; mode: string }) {
  return input.status !== "idle" && input.text.length > 0 && !input.autocomplete && input.mode === "normal"
}
