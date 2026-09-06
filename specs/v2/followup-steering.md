# Primary TUI Follow-up Steering

## Status

**Proposed implementation specification** for baseline `v1.18.29-11-g51287d4d7b`.

This specification replaces the current interrupt behavior that may strand an already-admitted follow-up until a later prompt supplies another wake. It is intentionally an end-to-end Primary TUI change, not a queue-only change.

Before editing, every implementation owner must re-discover the named symbols on the target commit. Paths in this document describe expected ownership, not permission to blindly patch an older implementation.

## Problem

The desired Primary TUI behavior matches Codex/PI-style follow-up steering:

- Users may submit additional input while a session is executing.
- `Enter` admits a follow-up as `steer`.
- `Tab` admits an explicit `queue` item when the composer is non-empty, the session is busy/stopping, and autocomplete is not active.
- `Ctrl-C` stops only the active provider/tool ownership chain. It never deletes admitted follow-ups.
- After interruption, tool cancellation, or a rejected permission/question, eligible admitted inputs run automatically. Users must not send a synthetic "continue" prompt.

The existing V2 durable inbox is the source of truth. Advisory wakes, local TUI state, and transcript heuristics are not.

## Goals

1. Preserve exactly-once durable prompt admission and exact retry by message ID.
2. Preserve V2 `steer` safe-boundary and `queue` FIFO semantics.
3. Ensure an active interrupt cannot strand an admitted or already-promoted follow-up.
4. Move the Primary TUI's normal execution path to V2 prompt, interrupt, state, and interaction APIs.
5. Make admitted-but-unprojected inputs visible and recoverable after TUI reconnect.
6. Lock Issue #13520 (rejected tool/permission leaves messages stuck) with deterministic regression coverage.

## Non-goals

- Post-crash retry/recovery of in-flight provider or tool work.
- Clustered/distributed session execution ownership.
- Inserting a user message into an active `llm.stream(request)`.
- Editing, removing, or reordering an already-admitted input.
- A permanent V1/V2 dual runtime in the Primary TUI.
- Redesigning queue into a priority queue.

## Required semantics

### Admission

1. The client creates one immutable `messageID` before request submission.
2. The server durably writes the `session_input` admission before issuing an advisory wake.
3. The composer clears only after an `admitted` or exact-retry `reconciled` response.
4. A definite failure preserves the draft and attachments. An ambiguous transport failure preserves the same `messageID` and original payload for exact retry.
5. Reusing an ID is valid only for the same session, normalized prompt, and delivery mode. A mismatch fails explicitly.

### Delivery

| Delivery | Meaning | Promotion |
| --- | --- | --- |
| `steer` | Follow-up for the active continuation | Batch all eligible steers at the next provider-turn safe boundary. |
| `queue` | Explicit non-preemptive follow-up | At an otherwise-idle boundary, promote exactly one FIFO item, then re-evaluate continuation. |

- A batch of promoted steers resets the selected agent's turn allowance once.
- A steer admitted after the provider-turn cutoff is deferred to the next safe boundary.
- Queues retain FIFO ordering across interruption, reconnect, and refresh.
- Every provider turn continues to issue one explicit `llm.stream(request)` call.

### Interrupt and continuation

`interrupt(sessionID)` is ownership-scoped and process-local:

- It interrupts only the active V2 provider/tool owner for that Session ID.
- Idle/missing ownership is a no-op.
- It never deletes, cancels, or marks durable inbox input as failed.
- It does not restart the interrupted provider turn merely because it was interrupted.
- It does schedule one successor drain when eligible follow-up work or a continuation obligation exists.

The coordinator must maintain an explicit process-local **restart intent** (for example `restartAfterInterrupt` or a semantically upgraded existing `pendingWake`). Its meaning is:

> Once the current drain settles, re-evaluate whether this session must drain again.

It is set by a wake/admission received while a drain is running or stopping. Interrupt must not clear it. It may be cleared only after settlement confirms there is no continuation obligation and no eligible durable work.

At settlement, start at most one successor drain when any condition is true:

1. restart intent is set;
2. runner/history continuation state requires a next provider turn; or
3. durable inbox contains eligible steer; or
4. the session is otherwise idle and contains an eligible FIFO queue item.

This three-source decision is required. Merely retaining a boolean wake can lose intent in some stop/settle paths; merely scanning pending inbox rows misses the **promoted-before-interrupt** case, where the inbox row was promoted but its provider continuation did not finish.

Provider/tool cancellation, permission rejection, question rejection, and provider failure must publish their normal settlement state before the successor drain reads history and continues.

## Primary TUI behavior

### Composer

The Primary TUI must use V2 for normal prompt admission and V2 session interrupt. It must not submit through V1 while interrupting through V2, or vice versa.

Maintain local submission state equivalent to:

```ts
type SubmissionState =
  | { type: "idle" }
  | { type: "admitting"; messageID: string; delivery: "steer" | "queue" }
  | { type: "uncertain"; messageID: string; delivery: "steer" | "queue" }
  | { type: "error"; messageID: string; delivery: "steer" | "queue" }
```

The submission snapshot must include message ID, prompt parts, delivery, and the chosen agent/model state. Do not read mutable composer state after an asynchronous boundary.

Agent/model selection must be atomically associated with admission, either as part of the durable admitted input or through an existing equivalent V2 atomic operation. Do not implement `switch agent/model`, then `prompt` as separate racing requests.

### Keybinding precedence

1. **Enter**: submit non-empty normal composer content with `delivery: "steer"`. This remains valid while idle and starts work normally.
2. **Tab**:
   - autocomplete/completion with an accept action owns Tab;
   - otherwise, a non-empty composer in `busy` or `stopping` submits `delivery: "queue"`;
   - otherwise preserve existing agent-cycle/focus behavior.
3. **Ctrl-C**:
   - with active V2 provider/tool work, call V2 session interrupt and show `stopping`;
   - do not remove pending inputs or clear an admitted submission;
   - when idle, preserve current draft-clear/cancel behavior.

The queue action must be a named, configurable command rather than an unscoped hard-coded key handler. The footer/help must use the configured shortcut rather than hard-code `esc` or another key.

### Pending and execution rendering

The TUI must hydrate server-owned state on open/reconnect and render admitted-but-unprojected inputs separately from normal projected user messages. It must not infer pending state from the last incomplete assistant message.

Minimum rendering:

```text
Working: running tool …
  STEER   Follow up text
  QUEUED  #1 Later request
  QUEUED  #2 Another request
```

- `STEER` and `QUEUED` are visually distinct.
- Queue order comes from durable admission sequence.
- A pending item disappears from this area only when the corresponding durable promotion is observed, then appears as its normal user message.
- Local optimistic entries are provisional and reconcile by durable message/input ID.
- `stopping` must communicate that admitted follow-ups will continue automatically.

The read/event model must provide, directly or through an existing session snapshot:

- execution status (`idle`, `running`, `stopping`, and waiting/error states as applicable);
- pending admitted inputs with delivery and durable order;
- durable admission and promotion events;
- V2 permissions/questions and their V2 reply paths.

Do not expose database internals to the TUI. If the current API does not provide this state, add the smallest typed Protocol/Server/Client surface and regenerate clients.

## Compatibility decisions

- Primary TUI prompt, interrupt, status, pending-input, permission, and question paths must converge on V2.
- Shell/slash/skill/compact/wait paths must be classified during discovery. Do not let a legacy command start a V1 loop concurrently with V2 ownership. Implement an equivalent V2 path, safely guard it, or explicitly exclude it from the migrated normal composer until supported.
- Existing non-TUI V1 consumers are outside this migration unless separately approved.
- V2 interrupt may differ from legacy abort background-job behavior. Preserve or change that behavior only through an explicit product decision and test.

## Implementation plan

### Phase 0 — discovery and decision record

On the exact target commit, map real symbols and callers for:

- V2 admission, `session_input`, prompt delivery, exact retry, promotion, and history reload;
- coordinator wake/interrupt/settlement and active ownership;
- V2 Protocol/Server/Client prompt, interrupt, events, snapshots, permissions, and questions;
- Primary TUI compose, submit, keybindings, status, event reducers, reconnect, permissions/questions;
- any legacy paths still reachable from the normal TUI composer.

Record the actual symbol map before writers start. Reconcile this spec with current APIs instead of creating duplicate abstractions.

### Phase 1 — core correctness

In the V2 coordinator/runner only:

1. Introduce explicit restart-intent semantics.
2. Preserve it across active interrupt and cleanup.
3. Re-evaluate continuation and eligible durable work after interruption, tool failure, permission rejection, question rejection, and provider failure.
4. Preserve one active drain per Session ID and one successor at most.
5. Update old tests that codify clearing an active follow-up wake.

### Phase 2 — typed API and read model

Expose or confirm typed V2 APIs for:

- admission receipt/reconciliation and delivery;
- session-scoped interrupt;
- execution snapshot/transition state;
- pending admitted-input snapshot and durable events;
- V2 permission/question interaction.

If a public Protocol or Server `HttpApi` changes, run `bun run generate` in `packages/client`. Never hand-edit generated files.

### Phase 3 — Primary TUI vertical migration

Replace legacy normal prompt/abort usage with the V2 contract. Add durable submission acknowledgement, exact retry, pending rendering, reconnect hydration, status states, V2 permission/question flow, and context-sensitive Enter/Tab/Ctrl-C behavior.

### Phase 4 — integration and rollout

Run deterministic cross-layer tests, then a controlled TUI smoke test. Use an existing feature-flag mechanism only if one already fits; do not create a permanent dual-execution path merely for rollout.

## Required test matrix

### Core coordinator and runner

- wake → interrupt → settle automatically processes a steer;
- interrupt → admission/wake during stopping automatically processes input;
- promoted-before-interrupt continues without an inbox row remaining pending;
- repeated wakes during stopping create at most one successor;
- no pending/continuation after interrupt starts no extra provider turn;
- steer cutoff, batch allowance reset, queue FIFO, and one-queue-per-idle-boundary behavior remain correct;
- tool cancellation/provider failure/permission rejection/question rejection with steer and queue continue automatically;
- same Session never runs two drains; different Sessions can run concurrently;
- exact retry does not duplicate admission, promotion, or execution.

### Protocol, server, and client

- default delivery is steer; explicit queue round-trips;
- conflicting ID reuse fails; exact reuse reconciles;
- interrupt is Session-ID scoped and idle-safe;
- event/snapshot replay reconstructs pending delivery/order;
- generated client typechecks after public API changes.

### Primary TUI

- busy Enter submits steer;
- busy/stopping, non-empty Tab submits queue;
- autocomplete owns Tab; idle Tab preserves agent-cycle/focus behavior;
- composer clears only after admission/reconciliation;
- uncertain submission retries the same ID;
- active Ctrl-C uses V2 interrupt and preserves pending items;
- idle Ctrl-C preserves existing draft behavior;
- pending labels/order reconcile into projected messages;
- reconnect hydrates pending state;
- permission rejection transitions into follow-up work without manual continue.

### End-to-end regression

Use a controlled provider/tool and barriers rather than sleeps:

1. Begin a turn that waits for a permission-gated tool.
2. Submit steer A with Enter and queue B with Tab.
3. Interrupt or reject the permission.
4. Assert A and B were admitted exactly once; A runs at a safe boundary; B runs later FIFO; no manual prompt wakes execution; transcript and pending state converge.

Name this test as an Issue #13520 regression.

Run tests and `bun typecheck` only from owning package directories, never the repository root. Record exact commands and outcomes in the implementation PR.

## Acceptance gates

The feature is not complete until all conditions are true:

1. #13520 regression passes.
2. promoted-before-interrupt and no-double-drain tests pass.
3. TUI has no normal-composer V1/V2 mixed execution path.
4. reconnect restores pending steer/queue state.
5. keybinding precedence tests pass.
6. affected packages typecheck; client generation is clean when applicable.
7. manual TUI smoke test demonstrates Enter → steer, Tab → queue, Ctrl-C → stop current work and automatically consume follow-ups.

## Work appointments

| Appointment | Owner | Dependency | Write scope | Validation owner |
| --- | --- | --- | --- | --- |
| A — discovery map | Explorer / technical lead | None | Read-only design record | Technical lead |
| B — core continuation | Core fixer | A | `packages/core` V2 session/coordinator/runner and tests | Core owner |
| C — API/read model | API fixer | A; final semantics from B | Protocol, Server, Client, generation inputs/tests | API owner |
| D — Primary TUI | TUI designer/fixer | C contract stable | Primary TUI and direct tests | TUI owner |
| E — integration regression | Test fixer | B/C/D interfaces | Integration/E2E tests and fixtures | Release owner |
| F — rollout | Release owner | B/C/D/E complete | Docs/release/observability only | Release owner |

No two writers may concurrently change the coordinator, generated client surface, or TUI submission/keybinding reducer.
