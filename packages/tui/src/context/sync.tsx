import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SnapshotFileDiff,
  ConsoleState,
  SessionInputAdmitted,
  Event,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, onCleanup, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import { usePermission } from "./permission"
import { useData } from "./data"
import { permissionDisplay, sessionDisplay } from "./session-display"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    const permission = usePermission()
    const data = useData()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      capabilities: {
        experimentalBackgroundSubagents: boolean
      }
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus | { type: "stopping" }
      }
      session_pending: Record<string, SessionInputAdmitted[]>
      session_diff: {
        [sessionID: string]: SnapshotFileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      capabilities: {
        experimentalBackgroundSubagents: false,
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_pending: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const statusRevision = new Map<string, number>()
    const pendingSequence = new Map<string, number>()
    const pendingHydration = new Map<string, { seq: number; id: string; input?: SessionInputAdmitted }[]>()
    const stateSyncing = new Map<string, Promise<void>>()
    const interactionHydration = new Map<string, Event[]>()
    const interactionSyncing = new Map<string, Promise<void>>()
    function refreshInteractions(sessionID: string): Promise<void> {
      const existing = interactionSyncing.get(sessionID)
      if (existing) return existing
      const buffered: Event[] = []
      interactionHydration.set(sessionID, buffered)
      const task = Promise.all([
        sdk.client.v2.session.permission.list({ sessionID }, { throwOnError: true }),
        sdk.client.v2.session.question.list({ sessionID }, { throwOnError: true }),
      ])
        .then(([permissions, questions]) => {
          batch(() => {
            setStore("permission", sessionID, reconcile(permissions.data.data.map(permissionDisplay)))
            setStore("question", sessionID, reconcile(questions.data.data))
          })
        })
        .finally(() => {
          interactionSyncing.delete(sessionID)
          interactionHydration.delete(sessionID)
          batch(() => buffered.forEach((event) => handleEvent(event)))
        })
      interactionSyncing.set(sessionID, task)
      return task
    }
    function refreshState(sessionID: string): Promise<void> {
      const existing = stateSyncing.get(sessionID)
      if (existing) return existing
      const revision = statusRevision.get(sessionID)
      const buffered: { seq: number; id: string; input?: SessionInputAdmitted }[] = []
      pendingHydration.set(sessionID, buffered)
      const task = sdk.client.v2.session
        .state({ sessionID }, { throwOnError: true })
        .then((response) => {
          const snapshot = response.data.data
          const pending = new Map(snapshot.pending.map((input) => [input.id, input]))
          for (const change of buffered.toSorted((a, b) => a.seq - b.seq)) {
            if (change.seq <= snapshot.after) continue
            if (change.input) pending.set(change.id, change.input)
            if (!change.input) pending.delete(change.id)
          }
          pendingSequence.set(sessionID, Math.max(snapshot.after, ...buffered.map((change) => change.seq)))
          batch(() => {
            setStore(
              "session_pending",
              sessionID,
              reconcile([...pending.values()].toSorted((a, b) => a.admittedSeq - b.admittedSeq)),
            )
            if (statusRevision.get(sessionID) === revision)
              setStore("session_status", sessionID, {
                type: snapshot.execution.type === "running" ? "busy" : snapshot.execution.type,
              })
          })
        })
        .finally(() => {
          stateSyncing.delete(sessionID)
          pendingHydration.delete(sessionID)
        })
      stateSyncing.set(sessionID, task)
      return task
    }

    onCleanup(
      sdk.event.on("event", (event) => {
        if (event.payload.type !== "sync") return
        const change = event.payload.syncEvent
        if (change.type !== "session.next.prompt.admitted.1" && change.type !== "session.next.prompted.1") return
        const sessionID = change.data.sessionID
        if (change.seq <= (pendingSequence.get(sessionID) ?? -1)) return
        pendingSequence.set(sessionID, change.seq)
        const input: SessionInputAdmitted | undefined =
          change.type === "session.next.prompt.admitted.1"
            ? {
                id: change.data.messageID,
                sessionID,
                delivery: change.data.delivery,
                prompt: change.data.prompt,
                admittedSeq: change.seq,
                timeCreated: change.data.timestamp,
              }
            : undefined
        pendingHydration.get(sessionID)?.push({ seq: change.seq, id: change.data.messageID, input })
        setStore("session_pending", sessionID, (pending = []) =>
          [...pending.filter((item) => item.id !== change.data.messageID), ...(input ? [input] : [])].toSorted(
            (a, b) => a.admittedSeq - b.admittedSeq,
          ),
        )
      }),
    )

    createEffect(() => {
      for (const session of store.session) {
        const messages = data.session.message.list(session.id)
        if (!messages) continue
        const display = sessionDisplay(session, messages)
        setStore("message", session.id, reconcile(display.messages))
        for (const [id, parts] of Object.entries(display.parts)) setStore("part", id, reconcile(parts))
      }
    })

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions() {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    function handleEvent(event: Event, metadata: { workspace?: string } = {}) {
      if (
        (event.type.startsWith("permission.v2.") || event.type.startsWith("question.v2.")) &&
        "sessionID" in event.properties &&
        typeof event.properties.sessionID === "string"
      ) {
        const buffered = interactionHydration.get(event.properties.sessionID)
        if (buffered) {
          buffered.push(event)
          return
        }
      }
      switch (event.type) {
        case "server.connected":
          void Promise.all([...fullSyncedSessions].map((id) => result.session.sync(id, true))).catch(console.error)
          break
        case "server.instance.disposed":
          void bootstrap()
          void Promise.all([...fullSyncedSessions].map((id) => result.session.sync(id, true))).catch(console.error)
          break
        case "permission.v2.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.v2.asked": {
          const request = permissionDisplay(event.properties)
          if (permission.mode === "auto") {
            void sdk.client.v2.session.permission.reply({
              sessionID: request.sessionID,
              requestID: request.id,
              reply: "once",
            })
            break
          }
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.v2.replied":
        case "question.v2.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.v2.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.next.moved": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        case "session.next.execution.changed": {
          statusRevision.set(event.properties.sessionID, (statusRevision.get(event.properties.sessionID) ?? 0) + 1)
          setStore("session_status", event.properties.sessionID, {
            type: event.properties.status.type === "running" ? "busy" : event.properties.status.type,
          })
          // Cancellation cleans up ownership-scoped requests without manufacturing a user reply event.
          if (event.properties.status.type !== "stopping" && fullSyncedSessions.has(event.properties.sessionID))
            void refreshInteractions(event.properties.sessionID).catch(console.error)
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          if (metadata.workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    }
    onCleanup(event.subscribe(handleEvent))

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const capabilitiesPromise = sdk.client.experimental.capabilities
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => undefined)
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      await Promise.all([
        providersPromise,
        providerListPromise,
        capabilitiesPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ])
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const capabilitiesResponse = capabilitiesPromise
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            capabilitiesResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const capabilities = responses[2]
            const consoleState = responses[3]
            const agents = responses[4]
            const config = responses[5]
            const sessions = responses[6]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("capabilities", "experimentalBackgroundSubagents", capabilities?.backgroundSubagents === true)
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.v2.session.active().then((x) => {
              for (const id of Object.keys(x.data?.data ?? {})) {
                if (!store.session_status[id]) setStore("session_status", id, { type: "busy" })
              }
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          console.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          return (store.session_status[sessionID]?.type ?? "idle") === "idle" ? "idle" : "working"
        },
        state: refreshState,
        async interrupt(sessionID: string) {
          if ((store.session_status[sessionID]?.type ?? "idle") === "idle") return
          statusRevision.set(sessionID, (statusRevision.get(sessionID) ?? 0) + 1)
          setStore("session_status", sessionID, { type: "stopping" })
          await sdk.client.v2.session
            .interrupt({ sessionID }, { throwOnError: true })
            .finally(() => Promise.all([refreshState(sessionID), refreshInteractions(sessionID)]))
        },
        async sync(sessionID: string, force = false) {
          if (!force && fullSyncedSessions.has(sessionID)) return refreshState(sessionID)
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const task = (async () => {
            const [session, , todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              data.session.message.refresh(sessionID),
              sdk.client.session.todo({ sessionID }),
              sdk.client.session.diff({ sessionID }),
              refreshState(sessionID),
              refreshInteractions(sessionID),
            ])
            setStore(
              produce((draft) => {
                const match = search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
                draft.todo[sessionID] = todo.data ?? []
                draft.session_diff[sessionID] = diff.data ?? []
              }),
            )
            fullSyncedSessions.add(sessionID)
          })().finally(() => {
            syncingSessions.delete(sessionID)
          })
          syncingSessions.set(sessionID, task)
          return task
        },
      },
      bootstrap,
    }
    return result
  },
})
