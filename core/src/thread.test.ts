import { expect, test } from "bun:test"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { ThreadMapper, toolDetail, toolItem } from "./thread"

// Hand-built SDK messages carry only the fields the mapper reads.
const sdk = (message: object) => message as SDKMessage
const DIR = "/work/app"

test("streams text and finishes it with the full assistant message", () => {
  const mapper = new ThreadMapper(DIR)
  const start = mapper.map(sdk({ type: "stream_event", uuid: "s1", parent_tool_use_id: null, event: { type: "content_block_start", content_block: { type: "text" } } }))
  const delta = mapper.map(sdk({ type: "stream_event", uuid: "s2", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } }))
  const full = mapper.map(sdk({ type: "assistant", uuid: "a1", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Hello" }] } }), 5)

  expect(start).toEqual([{ kind: "item", item: { type: "text", id: "s1", text: "", done: false } }])
  expect(delta).toEqual([{ kind: "text.delta", id: "s1", delta: "Hel" }])
  expect(full).toEqual([{ kind: "item", item: { type: "text", id: "s1", text: "Hello", done: true, at: 5 } }])
})

test("completes a tool call with its result, under the call's id", () => {
  const mapper = new ThreadMapper(DIR)
  mapper.map(sdk({ type: "assistant", uuid: "a1", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }))
  const result = mapper.map(sdk({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "README.md" }], is_error: false }] } }))
  expect(result).toEqual([{ kind: "item", item: { type: "tool", id: "t1", name: "Bash", summary: "ls", result: { output: "README.md", isError: false } } }])
})

test("hides a subagent's own steps", () => {
  const mapper = new ThreadMapper(DIR)
  expect(mapper.map(sdk({ type: "assistant", uuid: "a1", parent_tool_use_id: "task-1", message: { content: [{ type: "text", text: "inner" }] } }))).toEqual([])
})

test("shapes an edit with its file relative to the project, and other calls by their main input", () => {
  expect(toolItem(DIR, "t1", "Edit", { file_path: `${DIR}/src/a.ts`, old_string: "a", new_string: "b" })).toEqual({
    type: "tool",
    id: "t1",
    name: "Edit",
    summary: "src/a.ts",
    file: "src/a.ts",
    edits: [{ before: "a", after: "b" }],
  })
  expect(toolItem(DIR, "t2", "Grep", { pattern: "TODO", glob: "*.ts" }).summary).toBe("TODO")
  expect(toolItem(DIR, "t3", "Custom", { level: 2 }).summary).toBe('{"level":2}')
})

test("shows a permission request's single input as itself, and several as JSON", () => {
  expect(toolDetail({ command: "rm -rf build" })).toBe("rm -rf build")
  expect(toolDetail({ file_path: "a.ts", content: "x" })).toBe('{\n  "file_path": "a.ts",\n  "content": "x"\n}')
})

test("rebuilds a thread from a stored transcript, timing each turn and hiding Claude Code's own messages", () => {
  const items = new ThreadMapper(DIR).history([
    { type: "user", uuid: "u1", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:00:00.000Z", message: { role: "user", content: "List files" } },
    { type: "assistant", uuid: "a1", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:00:02.000Z", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", uuid: "u2", session_id: "s", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "README.md" }] } },
    { type: "assistant", uuid: "a2", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:00:05.000Z", message: { content: [{ type: "text", text: "One file." }] } },
    { type: "user", uuid: "u3", session_id: "s", parent_tool_use_id: null, message: { content: "<system-reminder>hidden</system-reminder>" } },
  ] as never)
  const start = Date.parse("2026-11-09T10:00:00.000Z")
  expect(items).toEqual([
    { type: "user", id: "u1", text: "List files", at: start },
    { type: "tool", id: "t1", name: "Bash", summary: "ls", result: { output: "README.md", isError: false } },
    { type: "text", id: "a2:0", text: "One file.", done: true, at: start + 5000 },
    { type: "result", id: "result:u1", durationMs: 5000, isError: false },
  ])
})

test("rebuilds a message's images from the transcript, with its text", () => {
  const items = new ThreadMapper(DIR).history([
    {
      type: "user",
      uuid: "u1",
      session_id: "s",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } }, { type: "text", text: "What is this?" }] },
    },
  ] as never)
  expect(items).toEqual([{ type: "user", id: "u1", text: "What is this?", images: [{ mediaType: "image/png", data: "iVBOR" }] }])
})
