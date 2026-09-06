import { Cause, Effect, Layer, Stream } from "effect"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"
import { SessionInput } from "../input"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { SessionEvent } from "../event"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      pending: Effect.fnUntraced(function* (sessionID, continuation) {
        return (
          (yield* SessionInput.hasPending(database.db, sessionID, "steer", continuation.attempted)) ||
          (yield* SessionInput.hasPending(database.db, sessionID, "queue", continuation.attempted))
        )
      }),
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force, continuation) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force, continuation })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),
    })

    yield* coordinator.changes.pipe(
      Stream.runForEach((change) =>
        events.publish(SessionEvent.ExecutionChanged, { sessionID: change.key, status: change.status }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    return SessionExecution.Service.of({
      active: coordinator.active,
      status: coordinator.status,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, Database.node, EventV2.node],
})

export * as SessionExecutionLocal from "./local"
