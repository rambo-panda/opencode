import { createSignal } from "solid-js"
import { useClient } from "../context/client"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

export function DialogSessionDelete(props: { sessionID: string }) {
  const client = useClient()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme("elevated")
  const [deleting, setDeleting] = createSignal(false)

  async function idle(sessionID: string, active: ReadonlySet<string>): Promise<boolean> {
    if (active.has(sessionID)) return false
    const [pending, children] = await Promise.all([
      client.api.session.inbox.list({ sessionID }),
      client.api.session.list({ parentID: sessionID }),
    ])
    if (pending.length > 0) return false
    if (!(await Promise.all(children.data.map((child) => idle(child.id, active)))).every(Boolean)) return false
    let cursor = children.cursor.next
    while (cursor) {
      const page = await client.api.session.list({ parentID: sessionID, cursor })
      if (!(await Promise.all(page.data.map((child) => idle(child.id, active)))).every(Boolean)) return false
      cursor = page.cursor.next
    }
    return true
  }

  async function select(value: "keep" | "delete") {
    if (deleting()) return
    if (value === "keep") return dialog.clear()
    setDeleting(true)
    const active = await client.api.session.active()
    if (!(await idle(props.sessionID, new Set(Object.keys(active))))) {
      toast.show({ variant: "warning", message: "Wait for this session and its subagents to finish pending work." })
      return
    }
    await client.api.session.remove({ sessionID: props.sessionID })
    if (route.data.type === "session" && route.data.sessionID === props.sessionID) route.navigate({ type: "home" })
    dialog.clear()
  }

  const choose = (value: "keep" | "delete") => {
    if (deleting()) return
    void select(value)
      .catch(toast.error)
      .finally(() => setDeleting(false))
  }

  return (
    <DialogSelect<"keep" | "delete">
      title="Delete this session?"
      titleView={
        <box gap={1}>
          <text fg={theme.text.default}>Delete this session?</text>
          <text fg={theme.text.subdued}>Cannot be undone. Subagent sessions will also be deleted.</text>
        </box>
      }
      renderFilter={false}
      locked={deleting()}
      options={[
        { title: "1. No, keep this session", value: "keep" },
        { title: "2. Yes, delete and exit", value: "delete" },
      ]}
      onSelect={(option) => choose(option.value)}
      bindings={[
        { bind: "1", title: "Keep session", run: () => choose("keep") },
        { bind: "2", title: "Delete session", run: () => choose("delete") },
      ]}
      footer={
        <text fg={theme.text.subdued}>
          {deleting() ? "Deleting…" : "1 keep · 2 delete · ↑/↓ select · enter confirm · esc cancel"}
        </text>
      }
    />
  )
}
