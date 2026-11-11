import { expect, test } from "bun:test"
import type { ThreadEvent } from "@desk/protocol"
import { acpToolReader } from "./tools"
import { UpdateMapper } from "./updates"

const items = (events: ThreadEvent[]) => events.flatMap((event) => (event.kind === "item" ? [event.item] : []))

test("streams a message, and finishes it when a thought comes between", () => {
  const mapper = new UpdateMapper("/repo", acpToolReader)
  const [opened] = mapper.map({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } }, 1)
  expect(opened).toMatchObject({ kind: "item", item: { type: "text", text: "Hel", done: false } })
  const id = opened!.kind === "item" ? opened!.item.id : ""
  expect(mapper.map({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } }, 2)).toEqual([{ kind: "text.delta", id, delta: "lo" }])
  const [done, thinking] = mapper.map({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "**Plan** the work." } }, 3)
  expect(done).toEqual({ kind: "item", item: { type: "text", id, text: "Hello", done: true, at: 3 } })
  expect(thinking).toMatchObject({ kind: "item", item: { type: "thinking", text: "**Plan** the work.", label: "Plan" } })
})

test("grows one thought from its chunks, and a usage update reads as context", () => {
  const mapper = new UpdateMapper("/repo", acpToolReader)
  const first = items(mapper.map({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Read the" } }, 1))[0]!
  const second = items(mapper.map({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: " file." } }, 2))[0]!
  expect(second).toMatchObject({ id: first.id, text: "Read the file." })
  expect(mapper.map({ sessionUpdate: "usage_update", used: 50_000, size: 200_000 }, 3)).toEqual([{ kind: "context", reading: { percent: 25, tokens: 50_000, maxTokens: 200_000 } }])
  expect(mapper.finish(4)).toEqual([])
})

test("completes a tool call from its updates, keeping what earlier updates said", () => {
  const mapper = new UpdateMapper("/repo", acpToolReader)
  const started = items(mapper.map({ sessionUpdate: "tool_call", toolCallId: "t1", title: "npm test", kind: "execute", status: "pending", rawInput: { command: "cd app && npm test" } }, 1))
  expect(started).toEqual([{ type: "tool", id: "t1", name: "Bash", summary: "cd app && npm test", kind: "command", label: "Running npm" }])
  const done = items(mapper.map({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: { type: "text", text: "ok" } }], title: null }, 2))
  expect(done).toEqual([{ type: "tool", id: "t1", name: "Bash", summary: "cd app && npm test", result: { output: "ok", isError: false }, kind: "command", label: "Ran npm" }])
})

test("shows an edit with its file relative to the project and its diff", () => {
  const mapper = new UpdateMapper("/repo", acpToolReader)
  const [edit] = items(
    mapper.map(
      { sessionUpdate: "tool_call", toolCallId: "e1", title: "Edit main.ts", kind: "edit", status: "failed", content: [{ type: "diff", path: "/repo/src/main.ts", oldText: "a", newText: "b" }], rawOutput: "x".repeat(4100) },
      1,
    ),
  )
  expect(edit).toMatchObject({ name: "Edit", summary: "src/main.ts", file: "src/main.ts", edits: [{ before: "a", after: "b" }], kind: "edit", label: "Edited src/main.ts" })
  expect(edit?.type === "tool" && edit.result).toEqual({ output: `${"x".repeat(4000)}\n…`, isError: true })
})

test("names reads, searches, fetches and other tools by ACP's kind", () => {
  const mapper = new UpdateMapper("/repo", acpToolReader)
  const labels = [
    { toolCallId: "r", title: "Read", kind: "read" as const, locations: [{ path: "/repo/a.ts" }] },
    { toolCallId: "s", title: "grep foo", kind: "search" as const },
    { toolCallId: "f", title: "https://example.com", kind: "fetch" as const },
    { toolCallId: "o", title: "Open the browser", kind: "other" as const },
  ].map((call) => items(mapper.map({ sessionUpdate: "tool_call", ...call }, 1))[0])
  expect(labels.map((tool) => tool?.type === "tool" && [tool.kind, tool.label])).toEqual([
    ["read", "Read a.ts"],
    ["search", "Searched grep foo"],
    ["web", "Fetched https://example.com"],
    ["other", "Open the browser"],
  ])
})
