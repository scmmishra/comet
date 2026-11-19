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

test("a resumed subagent keeps its steps and summary, and its new tool call reaches it", () => {
  const events: ThreadEvent[] = []
  const subagents = new Subagents(DIR, (event) => events.push(event))
  const last = () => (events.findLast((event) => event.kind === "subagent") as { subagent: Subagent }).subagent
  const message = (value: object) => value as never
  const started = (tool: string, run: string, prompt: string) =>
    message({ type: "system", subtype: "task_started", task_id: "t1", run_id: run, tool_use_id: tool, task_type: "local_agent", description: "Reply", subagent_type: "general-purpose", is_backgrounded: true, prompt })
  const reply = (tool: string, uuid: string, text: string) => message({ type: "assistant", uuid, parent_tool_use_id: tool, message: { content: [{ type: "text", text }] } })
  const notified = (run: string, summary: string) => message({ type: "system", subtype: "task_notification", task_id: "t1", run_id: run, status: "completed", output_file: "", summary })

  subagents.handle(started("callA", "r1", "Say ALPHA"), 1000)
  subagents.handle(reply("callA", "a1", "ALPHA"), 1100)
  subagents.handle(notified("r1", "ALPHA"), 1200)
  expect(last()).toMatchObject({ status: "completed", endedAt: 1200, summary: "ALPHA" })

  subagents.handle(started("callB", "r2", "Say BETA"), 5000)
  const resumed = last()
  expect(resumed).toMatchObject({ id: "t1", status: "running", startedAt: 1000, summary: "ALPHA", prompt: "Say ALPHA", background: true })
  expect(resumed.endedAt).toBeUndefined()
  expect(resumed.items.map((item) => item.id)).toEqual(["a1:0"])

  subagents.handle(reply("callB", "a2", "BETA"), 5100)
  expect(last().items.map((item) => item.id)).toEqual(["a1:0", "a2:0"])

  // A late end of the first run does not end the second.
  subagents.handle(notified("r1", "ALPHA"), 5150)
  expect(last().status).toBe("running")

  subagents.handle(notified("r2", "BETA"), 5200)
  expect(last()).toMatchObject({ status: "completed", endedAt: 5200, summary: "BETA" })
  expect(events.filter((event) => event.kind === "subagent").every((event) => (event as { subagent: Subagent }).subagent.id === "t1")).toBe(true)
})
