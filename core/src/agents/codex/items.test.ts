import { expect, test } from "bun:test"
import { threadItems } from "./items"

const DIR = "/p"

test("shows a call of Desk's tools in the words every agent's thread uses", () => {
  const delegate = { type: "mcpToolCall", id: "m1", server: "desk", tool: "delegate", status: "completed", arguments: { agent: "antigravity", task: "Check the build." }, result: { content: [{ type: "text", text: "It builds." }] }, error: null } as const
  expect(threadItems(DIR, delegate, true)).toEqual([
    { type: "tool", id: "m1", name: "desk.delegate", summary: "antigravity: Check the build.", result: { output: "It builds.", isError: false }, kind: "other", label: "Handed a task to antigravity: Check the build." },
  ])
  expect(threadItems(DIR, delegate, false)[0]).toMatchObject({ label: "Handing a task to antigravity: Check the build." })
  const listAgents = { ...delegate, id: "m2", tool: "list_agents", arguments: {} }
  expect(threadItems(DIR, listAgents, true)[0]).toMatchObject({ name: "desk.list_agents", summary: "", label: "Listed the agents" })
})

test("shows another MCP server's call by server and tool, with its text result or its error", () => {
  const call = { type: "mcpToolCall", id: "m1", server: "github", tool: "search", status: "completed", arguments: { q: "bug" }, result: { content: [{ type: "text", text: "Done" }, { type: "image" }] }, error: null } as const
  expect(threadItems(DIR, call, true)).toEqual([
    { type: "tool", id: "m1", name: "github.search", summary: '{"q":"bug"}', result: { output: "Done\n[image]", isError: false }, kind: "other", label: 'github.search {"q":"bug"}' },
  ])
  expect(threadItems(DIR, { ...call, status: "failed", result: null, error: { message: "Timed out" } }, true)[0]).toMatchObject({ result: { output: "Timed out", isError: true } })
  expect(threadItems(DIR, call, false)[0]).not.toHaveProperty("result")
})

test("shows a web search by its query, and a compaction while it runs and once done", () => {
  expect(threadItems(DIR, { type: "webSearch", id: "w1", query: "bun 1.4 release" }, true)).toEqual([
    { type: "tool", id: "w1", name: "WebSearch", summary: "bun 1.4 release", result: { output: "", isError: false }, kind: "web", label: "Searched the web for bun 1.4 release" },
  ])
  expect(threadItems(DIR, { type: "contextCompaction", id: "c1" }, false)).toEqual([{ type: "compaction", id: "c1", status: "running" }])
  expect(threadItems(DIR, { type: "contextCompaction", id: "c1" }, true)).toEqual([{ type: "compaction", id: "c1", status: "done" }])
})

test("shows an agent Codex starts, and leaves out its other agent calls and the user's messages", () => {
  expect(threadItems(DIR, { type: "subAgentActivity", id: "s1", kind: "started", agentThreadId: "t", agentPath: "/root/say_hello" }, true)[0]).toMatchObject({ label: "Started an agent: say_hello" })
  expect(threadItems(DIR, { type: "subAgentActivity", id: "s2", kind: "completed", agentThreadId: "t", agentPath: "/root/say_hello" }, true)).toEqual([])
  expect(threadItems(DIR, { type: "collabAgentToolCall", id: "c1", tool: "wait", status: "completed", receiverThreadIds: [], prompt: null }, true)).toEqual([])
  expect(threadItems(DIR, { type: "userMessage", id: "u1", clientId: null, content: [] }, true)).toEqual([])
})

test("marks a declined command as failed, and cuts long output", () => {
  const command = { type: "commandExecution", id: "e1", command: "rm -rf /", status: "declined", aggregatedOutput: "x".repeat(5000), exitCode: null } as const
  const [found] = threadItems(DIR, command, true)
  expect(found).toMatchObject({ label: "Failed rm", result: { isError: true } })
  expect(found?.type === "tool" && found.result?.output.length).toBe(4002)
})
