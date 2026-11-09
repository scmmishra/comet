import { expect, test } from "bun:test"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { historyEvents, ThreadMapper } from "./thread"

// Hand-built SDK messages carry only the fields the mapper reads.
const sdk = (message: object) => message as SDKMessage

test("streams text and finishes it with the full assistant message", () => {
  const mapper = new ThreadMapper()
  const start = mapper.map(sdk({ type: "stream_event", uuid: "s1", parent_tool_use_id: null, event: { type: "content_block_start", content_block: { type: "text" } } }))
  const delta = mapper.map(sdk({ type: "stream_event", uuid: "s2", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } }))
  const full = mapper.map(sdk({ type: "assistant", uuid: "a1", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Hello" }] } }))

  expect(start).toEqual([{ kind: "text", id: "s1", text: "", done: false }])
  expect(delta).toEqual([{ kind: "text.delta", id: "s1", delta: "Hel" }])
  expect(full).toEqual([{ kind: "text", id: "s1", text: "Hello", done: true }])
})

test("maps a tool call and its result", () => {
  const mapper = new ThreadMapper()
  const call = mapper.map(sdk({ type: "assistant", uuid: "a1", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }))
  const result = mapper.map(sdk({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "README.md" }], is_error: false }] } }))

  expect(call).toEqual([{ kind: "tool", id: "t1", name: "Bash", input: { command: "ls" } }])
  expect(result).toEqual([{ kind: "tool.result", id: "t1", output: "README.md", isError: false }])
})

test("hides a subagent's own steps", () => {
  const mapper = new ThreadMapper()
  expect(mapper.map(sdk({ type: "assistant", uuid: "a1", parent_tool_use_id: "task-1", message: { content: [{ type: "text", text: "inner" }] } }))).toEqual([])
})

test("rebuilds a thread from a stored transcript", () => {
  const events = historyEvents([
    { type: "user", uuid: "u1", parent_tool_use_id: null, message: { role: "user", content: "List files" } },
    { type: "assistant", uuid: "a1", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", uuid: "u2", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "README.md" }] } },
    { type: "assistant", uuid: "a2", parent_tool_use_id: null, message: { content: [{ type: "text", text: "One file." }] } },
    { type: "user", uuid: "u3", parent_tool_use_id: null, message: { content: "<system-reminder>hidden</system-reminder>" } },
  ])
  expect(events).toEqual([
    { kind: "user", id: "u1", text: "List files" },
    { kind: "tool", id: "t1", name: "Bash", input: { command: "ls" } },
    { kind: "tool.result", id: "t1", output: "README.md", isError: false },
    { kind: "text", id: "a2:0", text: "One file.", done: true },
  ])
})
