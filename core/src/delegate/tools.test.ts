import { expect, test } from "bun:test"
import { toolItem } from "../agents/claude/thread"
import { threadItems } from "../agents/codex/items"
import { deskToolLabel, deskToolSummary } from "./tools"

test("sums a handed task by its agent and its title, else the task's first line", () => {
  expect(deskToolSummary("delegate", { agent: "codex", task: "Review the login form.\nReport the bugs." })).toBe("codex: Review the login form.")
  expect(deskToolSummary("delegate", { agent: "codex", task: "Long task", title: "Review login" })).toBe("codex: Review login")
  expect(deskToolSummary("list_agents", {})).toBe("")
  expect(deskToolSummary("search", {})).toBeUndefined()
  expect(deskToolLabel("delegate", "codex: Review login", false)).toBe("Handing a task to codex: Review login")
  expect(deskToolLabel("list_agents", "", true)).toBe("Listed the agents")
})

test("a call of Desk's tools reads the same from Claude Code and from Codex", () => {
  const input = { agent: "antigravity", task: "Check the build." }
  expect(toolItem("/work", "t1", "mcp__desk__delegate", input)).toMatchObject({ summary: "antigravity: Check the build.", label: "Handing a task to antigravity: Check the build." })
  const [codex] = threadItems("/work", { type: "mcpToolCall", id: "t2", server: "desk", tool: "delegate", status: "completed", arguments: input, result: { content: [{ type: "text", text: "It builds." }] }, error: null }, true)
  expect(codex).toMatchObject({ summary: "antigravity: Check the build.", label: "Handed a task to antigravity: Check the build.", result: { output: "It builds.", isError: false } })
  // Another server's tool keeps its own name and arguments.
  expect(toolItem("/work", "t3", "mcp__github__search", { q: "x" }).label).toBe('mcp__github__search {"q":"x"}')
})
