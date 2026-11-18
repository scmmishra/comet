import type { Subagent, ThreadEvent } from "@comet/protocol"
import { expect, test } from "bun:test"
import { Subagents } from "./subagents"

const DIR = "/work/comet"

test("tracks a subagent from its start, through its forwarded steps and progress, to its end", () => {
  const events: ThreadEvent[] = []
  const subagents = new Subagents(DIR, (event) => events.push(event))
  const last = () => (events.findLast((event) => event.kind === "subagent") as { subagent: Subagent }).subagent
  const message = (value: object) => value as never

  subagents.handle(message({ type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "call1", task_type: "local_agent", description: "Find tests", subagent_type: "Explore", prompt: "Find the tests" }), 1000)
  expect(last()).toMatchObject({ id: "t1", description: "Find tests", type: "Explore", status: "running", startedAt: 1000, items: [] })

  subagents.handle(message({ type: "assistant", uuid: "a1", parent_tool_use_id: "call1", message: { content: [{ type: "tool_use", id: "x1", name: "Bash", input: { command: "ls" } }] } }), 1100)
  subagents.handle(message({ type: "user", uuid: "u1", parent_tool_use_id: "call1", message: { content: [{ type: "tool_result", tool_use_id: "x1", content: "core" }] } }), 1200)
  expect(last().items).toEqual([{ type: "tool", id: "x1", name: "Bash", summary: "ls", result: { output: "core", isError: false }, kind: "command", label: "Ran ls" }])

  subagents.handle(message({ type: "system", subtype: "task_progress", task_id: "t1", description: "Find tests", usage: { total_tokens: 10, tool_uses: 1, duration_ms: 200 }, summary: "Listing folders" }), 1300)
  expect(last()).toMatchObject({ toolUses: 1, summary: "Listing folders" })

  subagents.handle(message({ type: "system", subtype: "task_notification", task_id: "t1", status: "completed", output_file: "", summary: "Found 12 tests" }), 2000)
  expect(last()).toMatchObject({ status: "completed", endedAt: 2000, summary: "Found 12 tests" })
})

test("leaves out tasks that are not agents, and messages from tool calls it does not know", () => {
  const events: ThreadEvent[] = []
  const subagents = new Subagents(DIR, (event) => events.push(event))
  subagents.handle({ type: "system", subtype: "task_started", task_id: "s1", task_type: "local_bash", description: "npm run dev" } as never)
  subagents.handle({ type: "assistant", uuid: "a1", parent_tool_use_id: "unknown", message: { content: [{ type: "text", text: "hi" }] } } as never)
  expect(events).toEqual([])
})

test("drops a subagent's step once a later message of its own replaces it", () => {
  const events: ThreadEvent[] = []
  const subagents = new Subagents(DIR, (event) => events.push(event))
  const last = () => (events.findLast((event) => event.kind === "subagent") as { subagent: Subagent }).subagent
  subagents.handle({ type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "call1", task_type: "local_agent", description: "Find tests" } as never, 1)
  subagents.handle({ type: "assistant", uuid: "a1", parent_tool_use_id: "call1", message: { content: [{ type: "text", text: "Refused" }] } } as never, 2)
  subagents.handle({ type: "assistant", uuid: "a2", parent_tool_use_id: "call1", supersedes: ["a1"], message: { content: [{ type: "text", text: "Found them" }] } } as never, 3)
  expect(last().items).toEqual([{ type: "text", id: "a2:0", text: "Found them", done: true, at: 3 }])
})
