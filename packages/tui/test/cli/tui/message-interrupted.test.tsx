/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { MessageInterrupted } from "../../../src/routes/session"

test("interrupted message renders a separate red notice without asking for a manual resume", async () => {
  const color = RGBA.fromHex("#e5534b")
  const app = await testRender(
    () => (
      <box>
        <text>Partial response</text>
        <MessageInterrupted color={color} />
      </box>
    ),
    { width: 60, height: 5 },
  )
  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Partial response")
    expect(frame).toContain("■ Conversation interrupted")
    expect(frame.indexOf("Partial response")).toBeLessThan(frame.indexOf("■ Conversation interrupted"))
    expect(frame).not.toContain("/feedback")
    expect(frame).not.toContain("continue")
    const spans = app.captureSpans().lines.flatMap((line) => line.spans)
    expect(spans.find((span) => span.text.includes("Conversation interrupted"))?.fg).toEqual(color)
  } finally {
    app.renderer.destroy()
  }
})
