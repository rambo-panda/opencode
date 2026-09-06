# Follow-up steering implementation record

Design authority: [followup-steering.md](./followup-steering.md).

## Discovery (before implementation)

Inspected HEAD: `27d2407e92` (`v1.18.29-12-g27d2407e92`). It is one
commit after the specified baseline; the additional commit only changes
`bin/build-macos.sh`. Existing `bun.lock` changes and the untracked design
specification belong to the user and are preserved.

| Area                | Actual ownership and call chain                                                                                                                                                                          | Existing tests                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Admission           | `packages/core/src/session.ts`: `SessionV2.prompt` normalizes the prompt, calls `SessionInput.admit`, checks exact equivalence, then calls `SessionExecution.wake`                                       | `packages/core/test/session-prompt.test.ts`                                                                                 |
| Durable inbox       | `session/input.ts`, `session/sql.ts`, `session/projector.ts`: `PromptAdmitted` projects `session_input`; `Prompted` records promotion using durable admission/promotion sequences                        | `session-prompt.test.ts`, `session-projector.test.ts`                                                                       |
| Ownership           | `session/execution/local.ts` resolves Session placement at drain start; `session/run-coordinator.ts` serializes each Session, coalesces wakes, and interrupts its current owner                          | `session-run-coordinator.test.ts`                                                                                           |
| Provider turns      | `session/runner/llm.ts`: `run` → `runTurn` → `runTurnAttempt`; promotion uses steer cutoff or one FIFO queue, history is reloaded, then one explicit `llm.stream` executes                               | `session-runner.test.ts` includes controlled provider/tool barriers, FIFO, cutoff, allowance, and rejection cases           |
| Public API          | `packages/protocol/src/groups/session.ts` → `packages/server/src/handlers/session.ts`; prompt, interrupt, active, history/events, and V2 permission/question APIs already exist                          | `packages/client/test/promise.test.ts`, `effect.test.ts`, existing opencode server tests                                    |
| Embedded server     | `packages/opencode/src/server/routes/instance/httpapi/server.ts` already mounts V2 handlers and binds the process-global local execution service; `event-v2-bridge.ts` forwards events to the TUI worker | Existing opencode server and TUI transport fixtures                                                                         |
| Composer            | `packages/tui/src/component/prompt/index.tsx`: `submit`/`submitInner`; currently V1 prompt/shell/command, fire-and-forget admission, immediate composer clearing                                         | `packages/tui/test/cli/tui/prompt-submit-race.test.ts` currently mirrors implementation rather than calling production code |
| Keybindings         | `packages/tui/src/config/keybind.ts`, `src/keymap.tsx`; autocomplete has a dedicated mode; current interrupt is double Escape/V1 abort, Ctrl-C clears composer, Tab cycles agents                        | `packages/tui/test/keymap.test.tsx`                                                                                         |
| State and reconnect | `packages/tui/src/context/sdk.tsx`, `event.ts`, `sync.tsx`, `data.tsx`; V2 data reducer exists, but primary route reads legacy transcript/state and infers queued messages from an incomplete assistant  | `test/cli/tui/data.test.tsx`, `test/cli/cmd/tui/sync*.test.tsx`                                                             |
| Interactions        | `packages/tui/src/routes/session/permission.tsx`, `question.tsx`: legacy reply paths; route currently hides/disables the composer during permission/question waits                                       | Existing renderer/keymap and sync fixtures                                                                                  |

Confirmed Core gaps: interrupt clears `pendingWake`; settlement only considers
that flag; advisory runner entry checks only unpromoted inbox rows. A promoted
follow-up loses its continuation intent if execution is interrupted. Permission
and question rejection interrupt the runner after tool settlement.

Confirmed API gaps: no atomic per-admission agent/model selection, explicit
admission/reconciliation disposition, or complete execution/pending snapshot.
Existing durable admission/promotion events and V2 interaction APIs will be reused.

## Compatibility decisions

- Primary normal prompt, interrupt, state, and interaction paths converge on V2.
- Shell, remote slash/skill invocation, and compaction currently reach V1 execution;
  V2 shell/skill/compact return unavailable. Guard unsupported execution paths
  visibly in the Primary TUI; do not start a concurrent V1 loop.
- Local UI commands retain their behavior. No direct composer wait path was found.
- Undo/redo use the existing V2 revert API and refuse changes while execution or
  admitted follow-ups remain, avoiding a race with automatic successor drains.
- Ctrl-C targets only the V2 provider/tool owner. Independent legacy background
  jobs are outside this ownership chain and must not be implicitly cancelled.
- Screenshots illustrate pending steer/queue presentation. Editing/removing
  admitted inputs is excluded by the design specification.

## Implementation order and write ownership

1. Core owner: coordinator, execution, runner, and deterministic correctness tests.
2. API owner: smallest typed admission/state contract and durable selection,
   followed by client generation and contract verification.
3. TUI owner: composer/keybindings/rendering/interactions after API stabilization.
4. Lead: SDK/state integration in a separately agreed file scope, cross-layer
   regression, controlled TUI smoke verification, and final audit.

Independent discovery, test preparation, and checks run concurrently. Writers do
not overlap coordinator, generated clients, or composer/keybinding files.

API decision: use optional `prompt.selection` in the existing JSON
column (no database migration), an explicit admission receipt, and a typed
execution/pending state snapshot. Primary TUI integration uses the existing
`sdk.client.v2` generated SDK and `sync.data.session_pending`.
The lead owns `context/sync.tsx`, `context/data.tsx`, and their tests. TUI owner
owns composer/keybindings, route rendering, permission/question components and
their direct tests. Pending rows retain the Client `Admitted` wire shape.

## Acceptance and verification

Required: wake-before-interrupt, stopping admission, promoted-before-interrupt,
repeated wakes, no extra provider call without follow-ups, no double drain, queue
FIFO, exact retry, all specified failure/rejection paths, key precedence, durable
composer acknowledgement, reconnect hydration, and named Issue #13520 coverage.

Use provider/tool barriers for ordering. Run tests and `bun typecheck` from owning
package directories. Regenerate public clients with `bun run generate` from
`packages/client`; never edit generated sources. Finish with a controlled TUI
Enter/Tab/Ctrl-C smoke test. Commands and observed results will be recorded below.

## Implemented design

- Coordinator `restartRequested` survives interruption. Settlement combines it,
  a process-local continuation token, and durable inbox eligibility. The token
  covers promotion-to-provider-start and between-turn obligations and is not
  reconstructed after a crash. Only one ownership chain drains a Session.
- Runner settles tools and the assistant before successors read history. Queue
  promotion waits for an existing continuation to finish. A setup-failure cutoff
  prevents an unexecutable input from causing an infinite advisory retry loop.
- Admission returns `admitted` or `reconciled`. Optional `prompt.selection`
  durably carries agent/model and participates in exact-retry equivalence. Its
  selection is applied atomically with promotion, with no new database migration.
- `GET /api/session/:sessionID/state` returns execution state and FIFO pending
  inputs with a durable cursor. Existing admission/promotion events are reused;
  `session.next.execution.changed` is a live, process-local event.
- Primary TUI uses its existing `sdk.client.v2` for create/prompt/interrupt,
  pending/status, messages and permissions/questions. Existing terminal widgets
  receive a V2 presentation adapter, not a second execution runtime.
- Submission snapshots are immutable across awaits and ambiguous retries.
  Composer clearing waits for a matching receipt and preserves newer edits.
  Generated SDK error wrappers are unwrapped to distinguish definite rejection
  from an uncertain transport/server failure.
- Enter admits steer without interruption. Tab has a named configurable queue
  command and runtime eligibility, including input/Tab in the same terminal
  batch. Autocomplete takes precedence; idle Tab retains agent cycling.
- Ctrl-C interrupts V2. Cleanup refreshes ownership-scoped permission/question
  requests so a cancelled request cannot leave a stale interaction card. Ctrl-O
  switches between an outstanding interaction and the follow-up composer.
- Pending hydration buffers durable changes and reconciles by sequence/ID;
  reconnect rehydrates loaded Sessions. Projected messages use V2 events and
  durable projection ordering, not ID sorting or the old pending heuristic.
- Legacy shell, remote slash/skill and manual compact execution are visibly
  guarded. Location moves no longer write V1 `noReply` reminders; V2 Location
  system context supplies the new directory on the next drain. Moves are guarded
  while work/follow-ups remain.

## Final validation (2026-09-06)

All test/typecheck commands below ran from the listed package directories.

| Directory                                                                              | Command                                                                                                                                                                                                                   | Result                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/core`                                                                        | `bun test test/session-run-coordinator.test.ts test/session-followup.test.ts test/session-runner.test.ts test/session-runner-recorded.test.ts test/session-prompt.test.ts test/session-projector.test.ts --only-failures` | 150 pass                                                     |
| `packages/tui`                                                                         | `bun test --timeout 30000 --only-failures`                                                                                                                                                                                | 209 pass, 1 existing skip; 8 snapshots                       |
| `packages/opencode`                                                                    | `bun test test/server/httpapi-session.test.ts --timeout 30000 --only-failures`                                                                                                                                            | 24 pass                                                      |
| `packages/client`                                                                      | `bun test`                                                                                                                                                                                                                | 16 pass, including generated-contract/import-boundary checks |
| `packages/schema`                                                                      | `bun test test/contract-hygiene.test.ts test/event-manifest.test.ts`                                                                                                                                                      | 9 pass                                                       |
| `packages/protocol`                                                                    | `bun test test/session-cursor.test.ts`                                                                                                                                                                                    | 2 pass                                                       |
| `packages/sdk/js`                                                                      | `bun test`                                                                                                                                                                                                                | 1 pass                                                       |
| `packages/core`, `schema`, `protocol`, `server`, `client`, `sdk/js`, `tui`, `opencode` | `bun typecheck` in each directory                                                                                                                                                                                         | All pass                                                     |
| `packages/client`                                                                      | `bun run generate`                                                                                                                                                                                                        | Success                                                      |
| Repository directory (generation only, no tests)                                       | `./packages/sdk/js/script/build.ts`                                                                                                                                                                                       | Success; generated files were never hand-edited              |

The HTTP suite includes explicitly named Issue #13520 permission-rejection and
interrupt regressions. It uses the generated Effect client, a real HTTP provider,
a real permission-gated bash tool and provider barriers. No new prompt is sent
after rejection/interrupt. Assertions cover exact admission/promotion, Session-ID
ownership, safe steering boundaries, FIFO queues and converged pending/history.

The final controlled terminal smoke ran the actual source CLI in a PTY:

```text
cd packages/opencode
bun run src/index.ts /tmp/opencode-followup-smoke.k9BalQ --model test/test-model
```

`OPENCODE_TEST_HOME`, `OPENCODE_CONFIG`, XDG paths, auth and model discovery were
isolated to temporary state and a local fake provider; no real provider was used.
`tmux` was unavailable, so the tool-owned PTY supplied/captured real terminal
input/output. Observed sequence:

1. Initial Enter starts a permission-gated tool.
2. Ctrl-O opens the composer; Enter displays `STEER Steer A` without interrupting.
3. Text plus Tab in one terminal write displays `QUEUED #1 Queue B` without
   cycling agents.
4. Ctrl-C displays stopping, removes the cancelled permission, and automatically
   starts the steer request. Queue B remains pending.
5. Releasing the controlled steer response automatically starts Queue B and
   reaches idle. There is no extra prompt or manual resume.

The provider recorded exactly three requests with successive user histories:
`[initial]`, `[initial, Steer A]`, `[initial, Steer A, Queue B]`. Read-only SQLite
inspection of smoke Session `ses_f8b3f9e55ffd3ZjC5aE2rBqBYJ` found exactly three
inputs, with `(admitted_seq, promoted_seq)` equal to `(1,2)`, `(7,11)`, `(8,16)`;
none remained pending. The CLI and fake provider were stopped afterwards.

Smoke found and led to additional regression tests for a batched Tab key and
cancelled interaction-card cleanup. An earlier fake-provider run timed out its
held stream; disabling that fixture's idle timeout yielded the successful final
run above (and the earlier failure also automatically consumed its queue).

## Post-delivery regression: normal hello with environment-configured providers

The user's real binary test exposed a missed migration compatibility case. The
2026-09-06 runtime log showed `{env:MY_OPENAI_URL}/chat/completions` reaching URL
construction literally. V2 Core read JSONC directly, unlike the legacy loader's
environment/file substitution. The original fixed-local-URL smoke did not cover
this configuration shape, so the earlier completion claim was too broad.

The bounded correction changes `packages/core/src/config.ts` to expand existing
`{env:NAME}` and `{file:path}` syntax before JSONC decoding and V1 migration.
Source configuration and credentials are not written back. Runner also publishes
a terminal assistant failure for unexpected provider-stream defects, including a
URL `TypeError` before the first token; previously only `LLMError` was projected
and this failure was visible only in logs. Interrupt-only causes remain excluded.

The new runner regression was first observed failing with only the `hello` user
message and no assistant error, then passed after the fix. Additional config and
actual HTTP regressions cover provider URL/key placeholders and normal `hello`
admission through response without another wake or manual resume.

Verification commands, each run from its owning package:

- `packages/core`: `bun typecheck` and
  `bun test test/config/config.test.ts test/session-runner.test.ts test/session-run-coordinator.test.ts test/session-followup.test.ts --only-failures`
  — typecheck passed; 133 tests passed, 423 assertions.
- `packages/opencode`: `bun typecheck` and
  `bun test test/server/httpapi-session.test.ts --timeout 30000 --only-failures`
  — typecheck passed; 25 tests passed, 159 assertions, including the new
  `V2 hello responds with legacy environment-substituted provider configuration`.
- No public Protocol/HttpApi changes in this correction, so no client regeneration
  was necessary.
- Built from `packages/opencode` with
  `env -u OPENCODE_RELEASE OPENCODE_VERSION=1.18.29-followup-hello-fix OPENCODE_CHANNEL=local MODELS_DEV_API_JSON=/Users/rambo/work_space/opencode-fork/packages/opencode/test/tool/fixtures/models-api.json bun run script/build.ts --only=darwin-x64 --skip-install --skip-embed-web-ui --outdir=/tmp/opencode-hello-regression.aoJWS8/build`
  — success, including the generated binary's version smoke. No release upload,
  installation, rebase, dependency installation or user-binary replacement.

Real source and compiled-binary TUI PTYs used isolated XDG directories under
`/tmp/opencode-hello-regression.aoJWS8` and a controlled local provider. Both URL
and key used `{env:...}` placeholders. Source TUI answered `hello` and `hello
again` in the same Session; the compiled binary answered a fresh `hello`.
All three provider calls had the expected synthetic authorization header. Both
PTYS visibly displayed `Hello from configured provider.` and returned to idle.
No user credential or external model was used. Temporary reproducible artifacts
remain; the test processes were stopped. Validation does not establish parity
for every legacy provider/plugin configuration.

## Follow-up: persistent interruption presentation

The user requested the supplied terminal screenshot's red interruption notice.
Interrupted assistant messages now show a separate, theme-error-colored
`■ Conversation interrupted` line, retaining partial content and avoiding the
ordinary provider-error card. The TUI presentation adapter maps Core's existing
durable `Provider turn interrupted` reason to the widgets' existing
`MessageAbortedError` classification. Other errors are unchanged. No public
Schema/Protocol/HttpApi changes or new local-only status are introduced.

Two existing Core tests first demonstrated missing settlement: interruption
before the first provider event produced no assistant message, and interruption
while tools were settling after provider step-finish retained `tool-calls`.
The runner now settles both through existing Step.Started/Step.Failed events;
failed assistants cannot subsequently be overwritten by Step.Ended. Tests check
projection replay, exactly one provider call and no extra restart.

Validation (commands run from the named package directories):

- `packages/core`: `bun typecheck`; `bun test test/session-run-coordinator.test.ts test/session-followup.test.ts test/session-runner.test.ts test/session-runner-tool-events.test.ts test/session-runner-recorded.test.ts --only-failures`
  — typecheck passed, 122 tests passed, 360 assertions.
- `packages/tui`: `bun typecheck`; `bun test --timeout 30000 --only-failures`
  — typecheck passed, 211 tests passed, 1 existing skip, 8 snapshots and 551
  assertions. Includes production notice rendering/foreground-color checks,
  partial-content preservation, replay-derived classification and ordinary-error
  distinction. Existing unrelated missing-KV warnings remain non-failing.
- `packages/opencode`: `bun typecheck`; `bun test test/server/httpapi-session.test.ts --test-name-pattern 'Issue #13520' --timeout 30000 --only-failures`
  — typecheck passed, both HTTP regressions passed, 30 assertions.

An isolated real source-TUI PTY in `/tmp/opencode-interrupt-style.aRPkhx` used
`session_interrupt: "ctrl+c,escape"` only in the temporary test configuration.
Single Esc before the first token displayed the red notice without another
provider request. A second prompt streamed partial text; Tab admitted a queue,
and Ctrl-C retained that text, displayed the notice and automatically consumed
the queue. Reentering Session `ses_f8b05e66cffeFojbW3LTMuIhVH` in a fresh CLI
process restored both notices and the preserved text. Read-only SQLite inspection
confirmed two durable interrupted assistants (zero and one content parts) and
one normally completed assistant, with all three inputs promoted. The provider
received exactly three calls. All test processes were stopped afterwards.

The production changes do not alter shortcut defaults or the user's `tui.json`.
No binary was rebuilt/replaced for this styling follow-up.

## Limits and deviations

- No change to steer semantics: Enter never synthesizes Ctrl-C, interrupts a
  live stream, or injects user content mid-stream.
- Crash recovery and clustered ownership remain excluded, as specified.
- Shell/remote slash/skill/manual compact are guarded instead of implementing
  unrelated V2 capabilities, an option explicitly allowed by the specification.
- Existing independent background jobs are not aborted by V2 Ctrl-C. Pending
  input edit/delete/reordering is not implemented.
- Historical system/synthetic context is not rendered as a user bubble; ordinary
  messages, tools, attachments, historical shell and compaction remain visible.
- No functional deviation from the SPEC's acceptance semantics. Actual Primary
  TUI paths and existing `sdk.client.v2` were used rather than anticipated paths
  or a new client wrapper. Undo/redo/move use a safe active/pending guard.
- Three pre-existing revert events had already made the Schema event-count test
  stale; its affected count/index assertions were updated with the new live event.
- Existing unrelated TUI diff-viewer fixtures emit missing-KV-file warnings;
  they do not fail tests. The legacy SDK generator reports its existing API
  deprecation warning. No whole-monorepo suite or distributed/crash test was run.
- Existing user `bun.lock` edits and the design SPEC are preserved. No commit,
  push, branch creation or PR was performed.

## Changed files

- `packages/client/src/generated-effect/client.ts`
- `packages/client/src/generated/client.ts`
- `packages/client/src/generated/types.ts`
- `packages/client/test/effect.test.ts`
- `packages/client/test/promise.test.ts`
- `packages/core/src/config.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session/execution.ts`
- `packages/core/src/session/execution/local.ts`
- `packages/core/src/session/input.ts`
- `packages/core/src/session/message-updater.ts`
- `packages/core/src/session/projector.ts`
- `packages/core/src/session/run-coordinator.ts`
- `packages/core/src/session/runner/index.ts`
- `packages/core/src/session/runner/llm.ts`
- `packages/core/src/session/runner/publish-llm-event.ts`
- `packages/core/src/session/sql.ts`
- `packages/core/test/config/config.test.ts`
- `packages/core/test/session-followup.test.ts`
- `packages/core/test/session-prompt.test.ts`
- `packages/core/test/session-run-coordinator.test.ts`
- `packages/core/test/session-runner-recorded.test.ts`
- `packages/core/test/session-runner.test.ts`
- `packages/opencode/test/server/httpapi-session.test.ts`
- `packages/protocol/src/groups/session.ts`
- `packages/schema/src/prompt-input.ts`
- `packages/schema/src/prompt.ts`
- `packages/schema/src/session-event.ts`
- `packages/schema/src/session-input.ts`
- `packages/schema/test/contract-hygiene.test.ts`
- `packages/schema/test/event-manifest.test.ts`
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`
- `packages/sdk/js/src/v2/gen/types.gen.ts`
- `packages/server/src/handlers/session.ts`
- `packages/tui/src/app.tsx`
- `packages/tui/src/component/dialog-workspace-create.tsx`
- `packages/tui/src/component/prompt/index.tsx`
- `packages/tui/src/component/prompt/move.tsx`
- `packages/tui/src/component/prompt/submission.ts`
- `packages/tui/src/config/keybind.ts`
- `packages/tui/src/context/data.tsx`
- `packages/tui/src/context/session-display.ts`
- `packages/tui/src/context/sync.tsx`
- `packages/tui/src/plugin/adapters.tsx`
- `packages/tui/src/routes/session/index.tsx`
- `packages/tui/src/routes/session/pending.tsx`
- `packages/tui/src/routes/session/permission.tsx`
- `packages/tui/src/routes/session/question.tsx`
- `packages/tui/test/cli/cmd/tui/sync-fixture.tsx`
- `packages/tui/test/cli/cmd/tui/sync-live-hydration.test.tsx`
- `packages/tui/test/cli/cmd/tui/sync-undefined-messages.test.tsx`
- `packages/tui/test/cli/tui/followup.test.tsx`
- `packages/tui/test/cli/tui/message-interrupted.test.tsx`
- `packages/tui/test/cli/tui/prompt-submit-race.test.ts`
- `packages/tui/test/cli/tui/session-display.test.ts`
- `packages/tui/test/fixture/tui-sdk.ts`
- `specs/v2/followup-steering-implementation.md`
