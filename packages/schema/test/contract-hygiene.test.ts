import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent"
import { FileSystem } from "../src/filesystem"
import { Model } from "../src/model"
import { Project } from "../src/project"
import { Pty } from "../src/pty"
import { Question } from "../src/question"
import { Session } from "../src/session"
import { SessionEvent } from "../src/session-event"
import { SessionInput } from "../src/session-input"
import { Prompt } from "../src/prompt"
import { PromptInput } from "../src/prompt-input"
import { SessionTodo } from "../src/session-todo"
import { optional } from "../src/schema"

describe("contract hygiene", () => {
  test("optional properties preserve transformations and omit undefined while encoding", () => {
    const Value = Schema.Struct({ value: optional(Schema.FiniteFromString) })
    expect(Schema.decodeUnknownSync(Value)({ value: "1" })).toEqual({ value: 1 })
    expect(Schema.encodeSync(Value)({ value: 1 })).toEqual({ value: "1" })
    expect(Schema.encodeSync(Value)({ value: undefined })).toEqual({})
  })

  test("todo status and priority preserve arbitrary strings", () => {
    const decode = Schema.decodeUnknownSync(SessionTodo.Info)
    expect(decode({ content: "ship", status: "waiting", priority: "urgent" })).toEqual({
      content: "ship",
      status: "waiting",
      priority: "urgent",
    })
  })

  test("admission selection omits undefined and participates in exact prompt equivalence", () => {
    const plain = Prompt.make({ text: "Follow up", selection: undefined })
    expect(Schema.encodeSync(Prompt)(plain)).toEqual({ text: "Follow up" })
    const input = Schema.decodeUnknownSync(PromptInput.Prompt)({
      text: "Follow up",
      selection: { agent: "build", model: { providerID: "test", id: "test-model" } },
    })
    const selected = Prompt.make({ text: input.text, selection: input.selection })
    expect(Schema.encodeSync(Prompt)(selected)).toEqual({
      text: "Follow up",
      selection: { agent: "build", model: { providerID: "test", id: "test-model" } },
    })
    expect(Prompt.equivalence(plain, selected)).toBe(false)
    expect(Prompt.equivalence(selected, Prompt.make(selected))).toBe(true)
  })

  test("a session with no durable events has a valid empty state cursor", () => {
    const decode = Schema.decodeUnknownSync(SessionInput.State)
    expect(decode({ execution: { type: "idle" }, pending: [], after: -1 })).toEqual({
      execution: { type: "idle" },
      pending: [],
      after: -1,
    })
    expect(() => decode({ execution: { type: "idle" }, pending: [], after: -2 })).toThrow()
  })

  test("current ID constructors expose create", () => {
    expect(Question.ID.create()).toStartWith("que_")
    expect(Pty.ID.create()).toStartWith("pty_")
  })

  test("reusable public identifiers are stable and unique", () => {
    const identifiers = [
      Agent.Color,
      FileSystem.Submatch,
      Model.Ref,
      Model.Capabilities,
      Model.Cost,
      Model.Api,
      Project.Icon,
      Project.Commands,
      Project.Time,
      Project.Info,
      Pty.Info,
      Session.ListAnchor,
    ].map((schema) => schema.ast.annotations?.identifier)

    expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })

  test("current source avoids Any and mutable contract wrappers", async () => {
    const files = [...new Bun.Glob("*.ts").scanSync(new URL("../src", import.meta.url).pathname)].filter(
      (file) => !file.endsWith("-v1.ts"),
    )
    const source = await Promise.all(
      files.map((file) => Bun.file(new URL(`../src/${file}`, import.meta.url)).text()),
    ).then((values) => values.join("\n"))

    expect(source).not.toContain("Schema.Any")
    expect(source).not.toContain("Schema.mutable")
  })
})
