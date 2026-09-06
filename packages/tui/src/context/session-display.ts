import type {
  Message,
  Part,
  PermissionRequest,
  PermissionV2Request,
  Session,
  SessionMessage,
} from "@opencode-ai/sdk/v2"

export function permissionDisplay(request: PermissionV2Request): PermissionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: request.resources,
    always: request.save ?? [],
    metadata: request.metadata ?? {},
    tool:
      request.source?.type === "tool"
        ? { messageID: request.source.messageID, callID: request.source.callID }
        : undefined,
  }
}

/** Adapt V2 messages to the existing terminal widgets; execution remains entirely V2. */
export function sessionDisplay(session: Session, messages: readonly SessionMessage[]) {
  const info: Message[] = []
  const parts: Record<string, Part[]> = {}
  for (const message of messages.toReversed()) {
    const base = { sessionID: session.id, messageID: message.id }
    if (message.type === "user" || message.type === "shell" || message.type === "compaction") {
      info.push({
        id: message.id,
        sessionID: session.id,
        role: "user",
        time: message.time,
        agent: session.agent ?? "build",
        model: { providerID: session.model?.providerID ?? "", modelID: session.model?.id ?? "" },
      })
      if (message.type === "compaction") {
        parts[message.id] = [
          { ...base, id: `${message.id}_compaction`, type: "compaction", auto: message.reason === "auto" },
        ]
        continue
      }
      if (message.type === "shell") {
        parts[message.id] = [
          { ...base, id: `${message.id}_shell`, type: "text", text: `$ ${message.command}\n${message.output}` },
        ]
        continue
      }
      parts[message.id] = [
        { ...base, id: `${message.id}_text`, type: "text", text: message.text },
        ...(message.files ?? []).map(
          (file, index): Part => ({
            ...base,
            id: `${message.id}_file_${index}`,
            type: "file",
            mime: file.mime,
            filename: file.name,
            url: file.uri,
          }),
        ),
        ...(message.agents ?? []).map(
          (agent, index): Part => ({ ...base, id: `${message.id}_agent_${index}`, type: "agent", name: agent.name }),
        ),
      ]
      continue
    }
    // Internal context and synthetic messages were never normal user bubbles.
    if (message.type !== "assistant") continue
    info.push({
      id: message.id,
      sessionID: session.id,
      role: "assistant",
      time: message.time,
      parentID: info.findLast((item) => item.role === "user")?.id ?? "",
      agent: message.agent,
      mode: message.agent,
      modelID: message.model.id,
      providerID: message.model.providerID,
      variant: message.model.variant,
      path: { cwd: session.directory, root: session.directory },
      cost: message.cost ?? 0,
      tokens: message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: message.finish,
      error: message.error
        ? {
            // Core persists this terminal reason; reuse the widgets' existing cancellation classification.
            name: message.error.message === "Provider turn interrupted" ? "MessageAbortedError" : "UnknownError",
            data: { message: message.error.message },
          }
        : undefined,
    })
    parts[message.id] = message.content.map((part): Part => {
      const identity = { ...base, id: `${message.id}_${part.id}` }
      if (part.type === "text") return { ...identity, type: "text", text: part.text }
      if (part.type === "reasoning")
        return {
          ...identity,
          type: "reasoning",
          text: part.text,
          time: { start: part.time?.created ?? message.time.created, end: part.time?.completed },
        }
      const tool = { ...identity, type: "tool" as const, callID: part.id, tool: part.name }
      if (part.state.status === "pending")
        return { ...tool, state: { status: "pending", input: {}, raw: part.state.input } }
      const time = { start: part.time.ran ?? part.time.created, end: part.time.completed ?? part.time.created }
      if (part.state.status === "error")
        return {
          ...tool,
          state: {
            status: "error",
            input: part.state.input,
            error: part.state.error.message,
            metadata: part.state.structured,
            time,
          },
        }
      if (part.state.status === "running")
        return {
          ...tool,
          state: {
            status: "running",
            input: part.state.input,
            metadata: part.state.structured,
            time,
          },
        }
      return {
        ...tool,
        state: {
          status: "completed",
          input: part.state.input,
          title: part.name,
          metadata: part.state.structured,
          time,
          output: part.state.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join("\n"),
          attachments: part.state.attachments?.map((file, index) => ({
            ...base,
            id: `${identity.id}_file_${index}`,
            type: "file",
            mime: file.mime,
            filename: file.name,
            url: file.uri,
          })),
        },
      }
    })
  }
  return { messages: info, parts }
}
