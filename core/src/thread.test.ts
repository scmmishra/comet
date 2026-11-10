import { expect, test } from "bun:test"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { ThreadMapper, toolItem } from "./thread"

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

test("shows a turn Claude Code recorded as interrupted as stopped, without its marker message", () => {
  const items = new ThreadMapper(DIR).history([
    { type: "user", uuid: "u1", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:00:00.000Z", message: { role: "user", content: "Do it" } },
    { type: "assistant", uuid: "a1", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:00:04.000Z", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", uuid: "u2", session_id: "s", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
  ] as never)
  expect(items.map((item) => item.type)).toEqual(["user", "tool", "result"])
  expect(items.at(-1)).toMatchObject({ id: "result:u1", stopped: true })
})

test("shows a command's own output as a reply", () => {
  const events = new ThreadMapper(DIR).map({ type: "system", subtype: "local_command_output", content: "Context: 12k of 200k", uuid: "c1", session_id: "s" } as never, 5)
  expect(events).toEqual([{ kind: "item", item: { type: "text", id: "c1", text: "Context: 12k of 200k", done: true, at: 5 } }])
})

const NOTICE = "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command \"Run the review\" completed (exit code 0)</summary>\n</task-notification>"

test("opens a turn of Claude's own when a background task's notice arrives, live and restored", () => {
  const live = new ThreadMapper(DIR).map({ type: "user", uuid: "n1", session_id: "s", parent_tool_use_id: null, message: { role: "user", content: NOTICE } } as never, 7)
  expect(live).toEqual([
    { kind: "item", item: { type: "user", id: "n1", text: 'Background command "Run the review" completed (exit code 0)', fromTask: true, at: 7 } },
    { kind: "status", busy: true },
  ])
  const restored = new ThreadMapper(DIR).history([
    { type: "user", uuid: "u1", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:00:00.000Z", message: { role: "user", content: "Progress?" } },
    { type: "assistant", uuid: "a1", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:00:02.000Z", message: { content: [{ type: "text", text: "Still running." }] } },
    { type: "user", uuid: "n1", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:01:00.000Z", message: { role: "user", content: NOTICE } },
    { type: "assistant", uuid: "a2", session_id: "s", parent_tool_use_id: null, timestamp: "2026-11-09T10:01:05.000Z", message: { content: [{ type: "text", text: "It finished." }] } },
  ] as never)
  expect(restored.map((found) => `${found.type}:${found.id}`)).toEqual(["user:u1", "text:a1:0", "result:result:u1", "user:n1", "text:a2:0", "result:result:n1"])
})

test("shows a compaction while it runs, then with its token counts once Claude Code reaches the boundary", () => {
  const mapper = new ThreadMapper(DIR)
  expect(mapper.map(sdk({ type: "system", subtype: "status", status: "compacting", uuid: "s1" }))).toEqual([{ kind: "item", item: { type: "compaction", id: "compaction:s1", status: "running" } }])
  // Claude Code repeats its status while it compacts. One compaction shows.
  expect(mapper.map(sdk({ type: "system", subtype: "status", status: "compacting", uuid: "s2" }))).toEqual([])
  expect(mapper.map(sdk({ type: "system", subtype: "status", status: null, compact_result: "success", uuid: "s3" }))).toEqual([])
  expect(mapper.map(sdk({ type: "system", subtype: "compact_boundary", uuid: "b1", compact_metadata: { trigger: "auto", pre_tokens: 180_000, post_tokens: 32_000 } }))).toEqual([
    { kind: "item", item: { type: "compaction", id: "compaction:s1", status: "done", preTokens: 180_000, postTokens: 32_000 } },
  ])
})

test("ends a failed compaction with Claude Code's reason, and lets the next one start", () => {
  const mapper = new ThreadMapper(DIR)
  mapper.map(sdk({ type: "system", subtype: "status", status: "compacting", uuid: "s1" }))
  expect(mapper.map(sdk({ type: "system", subtype: "status", status: null, compact_result: "failed", compact_error: "Not enough messages", uuid: "s2" }))).toEqual([
    { kind: "item", item: { type: "compaction", id: "compaction:s1", status: "failed", error: "Not enough messages" } },
  ])
  expect(mapper.map(sdk({ type: "system", subtype: "status", status: "compacting", uuid: "s3" }))).toEqual([{ kind: "item", item: { type: "compaction", id: "compaction:s3", status: "running" } }])
})

test("says when Claude Code retries a failed API request, and why", () => {
  const mapper = new ThreadMapper(DIR)
  expect(mapper.map(sdk({ type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529, error: "overloaded", uuid: "r1" }))).toEqual([
    { kind: "retry", attempt: 2, maxRetries: 10, delayMs: 4000, error: "The API is overloaded" },
  ])
  expect(mapper.map(sdk({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 418, error: "unknown", uuid: "r2" }))[0]).toMatchObject({ error: "The API answered 418" })
})

test("restores a compaction as a line in place of Claude Code's summary", () => {
  const items = new ThreadMapper(DIR).history([
    { type: "system", uuid: "b1", session_id: "s", parent_tool_use_id: null },
    { type: "user", uuid: "u1", session_id: "s", parent_tool_use_id: null, message: { role: "user", content: "This session is being continued from a previous conversation that ran out of context. Summary: ..." } },
    { type: "user", uuid: "u2", session_id: "s", parent_tool_use_id: null, message: { role: "user", content: "Carry on" } },
  ] as never)
  expect(items).toEqual([
    { type: "compaction", id: "compaction:b1", status: "done" },
    { type: "user", id: "u2", text: "Carry on" },
  ])
})
