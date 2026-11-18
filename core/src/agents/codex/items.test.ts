import { expect, test } from "bun:test"
import { mayStayOpen, threadItems, unfinishedItems } from "./items"

const DIR = "/p"

test("shows a call of Comet's tools in the words every agent's thread uses", () => {
  const delegate = { type: "mcpToolCall", id: "m1", server: "comet", tool: "delegate", status: "completed", arguments: { agent: "antigravity", task: "Check the build." }, result: { content: [{ type: "text", text: "It builds." }] }, error: null } as const
  expect(threadItems(DIR, delegate, true)).toEqual([
    { type: "tool", id: "m1", name: "comet.delegate", summary: "antigravity: Check the build.", result: { output: "It builds.", isError: false }, kind: "other", label: "Handed a task to antigravity: Check the build." },
  ])
  expect(threadItems(DIR, delegate, false)[0]).toMatchObject({ label: "Handing a task to antigravity: Check the build." })
  const listAgents = { ...delegate, id: "m2", tool: "list_agents", arguments: {} }
  expect(threadItems(DIR, listAgents, true)[0]).toMatchObject({ name: "comet.list_agents", summary: "", label: "Listed the agents" })
})

test("draws a show call as its visual, and one Comet cannot draw as a failed call", () => {
  const call = { type: "mcpToolCall", id: "m1", server: "comet", tool: "show", status: "completed", arguments: { title: "Next", parts: [{ type: "actions", options: ["Go on"] }] }, result: { content: [{ type: "text", text: "Shown" }] }, error: null } as const
  const visual = { type: "visual", id: "m1", title: "Next", parts: [{ type: "actions", options: ["Go on"] }] } as const
  expect(threadItems(DIR, call, false)).toEqual([visual])
  expect(threadItems(DIR, call, true)).toEqual([visual])
  const wrong = { ...call, status: "failed", arguments: { title: "Next", parts: [] }, result: null, error: { message: "`parts` needs at least one part." } } as const
  expect(threadItems(DIR, wrong, true)).toEqual([{ type: "tool", id: "m1", name: "comet.show", summary: "Next", result: { output: "`parts` needs at least one part.", isError: true }, kind: "other", label: "Tried to show Next" }])
  expect(threadItems(DIR, { ...call, server: "github" }, true)[0]).toMatchObject({ type: "tool", name: "github.show" })
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

test("shows an image Codex generates by its prompt, with where Codex saved it or why it failed", () => {
  const image = { type: "imageGeneration", id: "ig_1", status: "generating", revisedPrompt: "A red fox in snow\nWatercolor", failure: null } as const
  expect(threadItems(DIR, image, false)).toEqual([{ type: "tool", id: "ig_1", name: "ImageGeneration", summary: "A red fox in snow", kind: "other", label: "Generated an image: A red fox in snow" }])
  expect(threadItems(DIR, { ...image, status: "completed", savedPath: "/Users/ada/.codex/generated_images/ig_1.png" }, true)[0]).toMatchObject({
    result: { output: "/Users/ada/.codex/generated_images/ig_1.png", isError: false },
  })
  expect(threadItems(DIR, { ...image, status: "failed", failure: { type: "usageLimitExceeded" } }, true)[0]).toMatchObject({ result: { output: "The image generation limit is used up.", isError: true } })
  expect(threadItems(DIR, { ...image, revisedPrompt: null }, false)[0]).toMatchObject({ summary: "", label: "Generated an image" })
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

test("shows an open web search as one that did not finish, with its turn's end deciding whether it is an error", () => {
  const search = { type: "webSearch", id: "w1", query: "bun 1.4 release" } as const
  const unfinished = (result: { output: string; isError: boolean; stopped?: boolean }) => ({ type: "tool" as const, id: "w1", name: "WebSearch", summary: "bun 1.4 release", result, kind: "web" as const, label: "Did not finish searching the web for bun 1.4 release" })
  expect(unfinishedItems(DIR, search, "completed")).toEqual([unfinished({ output: "The search did not finish.", isError: false })])
  expect(unfinishedItems(DIR, search, "failed")).toEqual([unfinished({ output: "The search did not finish.", isError: true })])
  expect(unfinishedItems(DIR, search, "interrupted")).toEqual([unfinished({ output: "The search did not finish.", isError: true, stopped: true })])
})

test("shows an open compaction as stopped, or failed when the turn failed", () => {
  const compaction = { type: "contextCompaction", id: "c1" } as const
  expect(unfinishedItems(DIR, compaction, "completed")).toEqual([{ type: "compaction", id: "c1", status: "stopped" }])
  expect(unfinishedItems(DIR, compaction, "interrupted")).toEqual([{ type: "compaction", id: "c1", status: "stopped" }])
  expect(unfinishedItems(DIR, compaction, "failed")).toEqual([{ type: "compaction", id: "c1", status: "failed" }])
  expect(mayStayOpen(compaction)).toBe(true)
  expect(mayStayOpen({ type: "agentMessage", id: "a1", text: "" })).toBe(false)
})
