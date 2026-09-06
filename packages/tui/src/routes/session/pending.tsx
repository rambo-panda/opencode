import type { SessionInputAdmitted } from "@opencode-ai/sdk/v2"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"

export function PendingInputs(props: { inputs: SessionInputAdmitted[] }) {
  const theme = useTheme().theme
  const inputs = createMemo(() => props.inputs.toSorted((a, b) => a.admittedSeq - b.admittedSeq))
  const queued = createMemo(() => inputs().filter((input) => input.delivery === "queue"))
  return (
    <Show when={inputs().length > 0}>
      <box paddingLeft={2} paddingBottom={1} flexShrink={0}>
        <For each={inputs()}>
          {(input) => (
            <text fg={theme.textMuted}>
              <span style={{ fg: input.delivery === "steer" ? theme.secondary : theme.warning, bold: true }}>
                {input.delivery === "steer"
                  ? "STEER   "
                  : `QUEUED  #${queued().findIndex((item) => item.id === input.id) + 1} `}
              </span>
              {input.prompt.text || input.prompt.files?.map((file) => file.name ?? file.uri).join(", ")}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}
