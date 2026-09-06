import { createSignal, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export function DialogSessionDelete(props: { sessionID: string }) {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const { theme } = useTheme()
  const toast = useToast()
  const [deleting, setDeleting] = createSignal(false)

  onMount(() => dialog.setSize("xlarge"))

  async function idle(sessionID: string): Promise<boolean> {
    const [state, children] = await Promise.all([
      sdk.client.v2.session.state({ sessionID }, { throwOnError: true }),
      sdk.client.session.children({ sessionID }, { throwOnError: true }),
    ])
    if (state.data.data.execution.type !== "idle" || state.data.data.pending.length > 0) return false
    return (await Promise.all(children.data.map((child) => idle(child.id)))).every(Boolean)
  }

  async function select(value: "keep" | "delete") {
    if (deleting()) return
    if (value === "keep") {
      dialog.clear()
      return
    }
    setDeleting(true)
    try {
      // Interrupt intentionally resumes admitted follow-ups; it cannot quiesce a session for deletion.
      if (!(await idle(props.sessionID))) {
        toast.show({
          variant: "warning",
          message:
            "This session or its subagents still have active work or pending follow-ups. Wait for them to finish before deleting.",
        })
        return
      }
      await sdk.client.session.delete({ sessionID: props.sessionID }, { throwOnError: true })
      if (route.data.type === "session" && route.data.sessionID === props.sessionID) {
        route.navigate({ type: "home" })
      }
      dialog.clear()
    } catch (error) {
      toast.show({ variant: "error", title: "Failed to delete session", message: errorMessage(error) })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DialogSelect<"keep" | "delete">
      title="Delete this session?"
      titleView={
        <box gap={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Delete this session?
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            Cannot be undone. Subagent threads will also be deleted.
          </text>
        </box>
      }
      renderFilter={false}
      locked={deleting()}
      options={[
        { title: "1. No, keep this session", value: "keep", description: "Return to the current session" },
        { title: "2. Yes, delete and exit", value: "delete", description: "Permanently delete this session now" },
      ]}
      onSelect={(option) => void select(option.value)}
      bindings={[
        { key: "1", desc: "Keep this session", group: "Dialog", cmd: () => void select("keep") },
        { key: "2", desc: "Delete this session", group: "Dialog", cmd: () => void select("delete") },
      ]}
      footer={
        <text fg={theme.textMuted}>
          {deleting() ? "Deleting…" : "1 keep · 2 delete · ↑/↓ select · enter confirm · esc cancel"}
        </text>
      }
    />
  )
}
