import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { it } from "./lib/effect"

it.effect(
  "Issue #13520: a follow-up wake survives interruption without a manual prompt",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const continued = yield* Deferred.make<void>()
      const drains: string[] = []
      const coordinator = yield* SessionRunCoordinator.make<string, never>({
        drain: (sessionID) =>
          Effect.gen(function* () {
            drains.push(sessionID)
            if (drains.length > 1) {
              yield* Deferred.succeed(continued, undefined)
              return
            }
            yield* Deferred.succeed(started, undefined)
            yield* Effect.never
          }),
      })
      const running = yield* coordinator.run("ses_followup").pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* coordinator.wake("ses_followup")
      yield* coordinator.interrupt("ses_followup")
      yield* Fiber.await(running)
      yield* Deferred.await(continued)
      expect(drains).toEqual(["ses_followup", "ses_followup"])
    }),
  1500,
)
