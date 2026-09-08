/** @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { PromptInterruptStatus } from "../../../src/component/prompt"

test("interrupt status renders the configured shortcut without a second-press hint", async () => {
  const text = RGBA.fromHex("#ffffff")
  const subdued = RGBA.fromHex("#808080")
  const app = await testRender(() => <PromptInterruptStatus shortcut="ctrl+c" text={text} subdued={subdued} />, {
    width: 30,
    height: 1,
  })

  try {
    await app.renderOnce()
    const line = app.renderer.currentRenderBuffer.getSpanLines()[0]!

    expect(line.spans.map((span) => span.text).join("")).toContain("ctrl+c interrupt")
    expect(line.spans.map((span) => span.text).join("")).not.toContain("again")
  } finally {
    app.renderer.destroy()
  }
})
