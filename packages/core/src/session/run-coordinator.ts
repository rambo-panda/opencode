export * as SessionRunCoordinator from "./run-coordinator"

import { Deferred, Effect, Exit, Fiber, FiberSet, PubSub, Scope, Stream } from "effect"
import type { SessionInput } from "@opencode-ai/schema/session-input"

/** Lives only for one process-local ownership chain, never reconstructed after a crash. */
export type Continuation = { required: boolean; attempted?: number }

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, E> {
  /** Snapshots keys with an execution owned by this coordinator. */
  readonly active: Effect.Effect<ReadonlySet<Key>>
  readonly status: (key: Key) => Effect.Effect<SessionInput.Execution>
  readonly changes: Stream.Stream<{ key: Key; status: SessionInput.Execution }>
  /** Starts execution while idle or joins the active execution. */
  readonly run: (key: Key) => Effect.Effect<void, E>
  /** Registers one coalesced follow-up after newly recorded work. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Stops active execution and waits for its cleanup. */
  readonly interrupt: (key: Key) => Effect.Effect<void>
}

type Entry<E> = {
  readonly done: Deferred.Deferred<void, E>
  readonly continuation: Continuation
  owner?: Fiber.Fiber<void, never>
  restartRequested: boolean
  stopping: boolean
}

export const make = <Key, E>(options: {
  readonly drain: (key: Key, force: boolean, continuation: Continuation) => Effect.Effect<void, E>
  readonly pending?: (key: Key, continuation: Continuation) => Effect.Effect<boolean>
}): Effect.Effect<Coordinator<Key, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<E>>()
    const changes = yield* PubSub.unbounded<{ key: Key; status: SessionInput.Execution }>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    let closed = false
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true
      }),
    )

    const makeEntry = (continuation: Continuation = { required: false }): Entry<E> => ({
      done: Deferred.makeUnsafe<void, E>(),
      continuation,
      restartRequested: false,
      stopping: false,
    })

    const start = (key: Key, entry: Entry<E>, force: boolean, successor = false) => {
      PubSub.publishUnsafe(changes, { key, status: { type: "running" as const } })
      const ready = Deferred.makeUnsafe<void>()
      const owner = fork(
        (successor ? Effect.yieldNow : Deferred.await(ready)).pipe(
          Effect.andThen(Effect.suspend(() => options.drain(key, force, entry.continuation))),
          Effect.onExit((exit) => settle(key, entry, exit)),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }

    const settle = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) =>
      Effect.gen(function* () {
        const pending = !closed && options.pending ? yield* options.pending(key, entry.continuation) : false
        const restart = !closed && (entry.restartRequested || entry.continuation.required || pending)
        if (Exit.isSuccess(exit) && !entry.stopping && restart) {
          entry.restartRequested = false
          start(key, entry, false, true)
          return
        }

        const successor = restart ? makeEntry(entry.continuation) : undefined
        if (successor === undefined) {
          active.delete(key)
          PubSub.publishUnsafe(changes, { key, status: { type: "idle" as const } })
        } else {
          active.set(key, successor)
          start(key, successor, false, true)
        }
        Deferred.doneUnsafe(entry.done, exit)
      })

    const run = (key: Key): Effect.Effect<void, E> =>
      Effect.uninterruptibleMask((restore) => {
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping) return restore(Deferred.await(entry.done).pipe(Effect.andThen(run(key))))
          return restore(Deferred.await(entry.done))
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, true)
        return restore(Deferred.await(next.done))
      })

    const wake = (key: Key) =>
      Effect.sync(() => {
        const entry = active.get(key)
        if (entry !== undefined) {
          entry.restartRequested = true
          return
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, false)
      })

    const interrupt = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry?.owner === undefined) return Effect.void
        entry.stopping = true
        PubSub.publishUnsafe(changes, { key, status: { type: "stopping" as const } })
        return Fiber.interrupt(entry.owner)
      })

    return {
      active: Effect.sync(() => new Set(active.keys())),
      status: (key) =>
        Effect.sync(() => ({ type: active.get(key)?.stopping ? "stopping" : active.has(key) ? "running" : "idle" })),
      changes: Stream.fromPubSub(changes),
      run,
      wake,
      interrupt,
    }
  })
