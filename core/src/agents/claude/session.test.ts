import { expect, test } from "bun:test"
import type { CanUseTool, Options, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { RunSettings, ThreadEvent, ThreadItem } from "@desk/protocol"
import { until } from "../../test-support"
import { ClaudeSession } from "./session"

// The session looks for Claude Code before it starts a query. The fake query never runs it.
process.env.DESK_CLAUDE ||= "/usr/bin/true"

const DIR = "/work/app"
const SETTINGS: RunSettings = { agent: "claude", model: "default", permissionMode: "default" }

/** A query that yields the SDK messages a test pushes, and records the calls the session makes. */
class FakeQuery implements AsyncIterable<SDKMessage> {
  interrupts = 0
  private messages: SDKMessage[] = []
  private failure?: Error
  private ended = false
  private waiting?: { resolve: (result: IteratorResult<SDKMessage>) => void; reject: (error: Error) => void }

  constructor(readonly options: Options) {}

  push(message: object) {
    const waiting = this.waiting
    this.waiting = undefined
    if (waiting) waiting.resolve({ value: message as SDKMessage, done: false })
    else this.messages.push(message as SDKMessage)
  }

  /** Ends the stream without an error, as Claude Code's does when its process exits. */
  end() {
    this.ended = true
    const waiting = this.waiting
    this.waiting = undefined
    waiting?.resolve({ value: undefined, done: true })
  }

  fail(error: Error) {
    const waiting = this.waiting
    this.waiting = undefined
    if (waiting) waiting.reject(error)
    else this.failure = error
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        const message = this.messages.shift()
        if (message) return Promise.resolve({ value: message, done: false })
        if (this.failure) return Promise.reject(this.failure)
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve, reject) => (this.waiting = { resolve, reject }))
      },
    }
  }

  async interrupt() {
    this.interrupts++
  }
  async setModel() {}
  async applyFlagSettings() {}
  async setPermissionMode() {}
  async stopTask() {}
  async getContextUsage() {
    return { percentage: 10, totalTokens: 20_000, maxTokens: 200_000 }
  }
  close() {
    this.end()
  }
}

function setup() {
  const events: ThreadEvent[] = []
  const queries: FakeQuery[] = []
  const run = ({ options }: { options?: Options }) => {
    const running = new FakeQuery(options ?? {})
    queries.push(running)
    return running as unknown as Query
  }
  const renames: string[] = []
  const session = new ClaudeSession(
    DIR,
    (event) => void events.push(event),
    { settings: SETTINGS, onSessionId: () => {}, onRenamed: (title) => void renames.push(title), onRateLimit: () => {}, compactIdle: () => false },
    run as never,
  )
  const items = () => events.flatMap((event) => (event.kind === "item" ? [event.item] : []))
  const results = () => items().filter((item): item is Extract<ThreadItem, { type: "result" }> => item.type === "result")
  const statuses = () => events.flatMap((event) => (event.kind === "status" ? [event.busy] : []))
  return { session, events, queries, items, results, statuses, renames }
}

/** Sends a message and waits for the session to start its query. */
async function started(s: ReturnType<typeof setup>) {
  s.session.send("Hello")
  await until(() => s.queries.length > 0)
  return s.queries.at(-1)!
}

const result = (uuid: string, extra: object = {}) => ({ type: "result", subtype: "success", uuid, session_id: "s1", duration_ms: 5, is_error: false, ...extra })

test("a message starts a turn and its result ends it", async () => {
  const s = setup()
  const running = await started(s)
  expect(s.items()[0]).toMatchObject({ type: "user", text: "Hello" })
  expect(s.statuses()).toEqual([true])
  expect(s.session.busy).toBe(true)

  running.push(result("r1"))
  await until(() => s.statuses().length === 2)
  expect(s.statuses()).toEqual([true, false])
  expect(s.session.busy).toBe(false)
  expect(s.results()).toEqual([{ type: "result", id: "r1", durationMs: 5, isError: false }])
})

test("a turn Claude Code starts after a background task makes the tab busy until it ends", async () => {
  const s = setup()
  const running = await started(s)
  running.push(result("r1"))
  await until(() => s.statuses().length === 2)
  // The order Claude Code sends live, recorded from 2.1.322.
  running.push({ type: "system", subtype: "task_notification", uuid: "tn1", session_id: "s1", task_id: "b1", status: "completed", summary: "Background command completed" })
  running.push({ type: "system", subtype: "init", uuid: "i2", session_id: "s1", model: "claude-opus-5-5" })
  await until(() => s.statuses().length === 3)
  expect(s.session.busy).toBe(true)
  expect(s.items().at(-1)).toMatchObject({ type: "user", text: "Background command completed", selfStarted: true })

  running.push(result("r2", { origin: { kind: "task-notification" } }))
  await until(() => s.statuses().length === 4)
  expect(s.statuses()).toEqual([true, false, true, false])
})

test("a steered message that cuts the turn's step keeps the turn going and hides that step's result", async () => {
  const s = setup()
  const running = await started(s)
  s.session.steer("Also check the tests")
  expect(s.items().at(-1)).toMatchObject({ type: "user", text: "Also check the tests", steered: true })

  running.push(result("cut", { terminal_reason: "aborted_streaming" }))
  running.push(result("r2"))
  await until(() => s.statuses().length === 2)
  expect(s.results().map((found) => found.id)).toEqual(["r2"])
  expect(s.statuses()).toEqual([true, false])
})

test("a steered message that cuts a streaming reply marks that reply as cut short", async () => {
  const s = setup()
  const running = await started(s)
  const stream = (event: object) => ({ type: "stream_event", uuid: "a1", session_id: "s1", parent_tool_use_id: null, event })
  running.push(stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }))
  running.push(stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I will rewrite the" } }))
  await until(() => s.events.some((event) => event.kind === "text.delta"))
  s.session.steer("Stop, use the old API")

  running.push(result("cut", { terminal_reason: "aborted_streaming" }))
  await until(() => s.items().some((item) => item.type === "text" && item.done))
  expect(s.items().at(-1)).toMatchObject({ type: "text", id: "a1", text: "I will rewrite the", done: true, interrupted: true })
})

test("a steered message that missed its turn keeps the tab busy for the next turn", async () => {
  const s = setup()
  const running = await started(s)
  s.session.steer("Also check the tests")

  running.push(result("r1", { terminal_reason: "completed" }))
  await until(() => s.results().length === 1)
  expect(s.statuses()).toEqual([true])
  expect(s.session.busy).toBe(true)

  running.push(result("r2"))
  await until(() => s.statuses().length === 2)
  expect(s.statuses()).toEqual([true, false])
})

test("a steered message that missed its turn moves after that turn's result, as the next turn's first message", async () => {
  const s = setup()
  const running = await started(s)
  s.session.steer("Now reply with just: second")
  const steer = s.items().at(-1)!
  expect(steer).toMatchObject({ steered: true, waiting: true })

  // What Claude Code sent when a steer came 10 ms before the turn's result: the result, then a new turn that takes the steer.
  running.push(result("r1", { stop_reason: "end_turn", user_message_uuids: [s.items()[0]!.id] }))
  await until(() => s.results().length === 1)
  expect(s.events.slice(-3)).toEqual([
    { kind: "item", item: expect.objectContaining({ type: "result", id: "r1" }) },
    { kind: "items.remove", ids: [steer.id] },
    { kind: "item", item: { type: "user", id: steer.id, text: "Now reply with just: second", at: steer.type === "user" ? steer.at : 0 } },
  ])

  running.push({ type: "system", subtype: "init", uuid: "i2", session_id: "s1", model: "claude-haiku-5-5", user_message_uuids: [steer.id] })
  running.push(result("r2", { stop_reason: "end_turn", user_message_uuids: [steer.id] }))
  await until(() => s.statuses().length === 2)
  expect(s.items().filter((item) => item.id === steer.id)).toHaveLength(2)
  expect(s.statuses()).toEqual([true, false])
})

test("a /rename names the tab once its result arrives", async () => {
  const s = setup()
  const running = await started(s)
  // The frames Claude Code sent for "/rename Probe title".
  running.push({ type: "system", subtype: "session_title_changed", title: "Probe title", uuid: "t1", session_id: "s1" })
  expect(s.renames).toEqual([])
  running.push(result("r1", { result: "Session renamed to: Probe title", local_command: "rename", num_turns: 0 }))
  await until(() => s.statuses().length === 2)
  expect(s.renames).toEqual(["Probe title"])

  // A later turn's result does not name it again.
  s.session.send("Hi")
  running.push(result("r2"))
  await until(() => s.statuses().length === 4)
  expect(s.renames).toEqual(["Probe title"])
})

test("an MCP elicitation Desk cannot show is cancelled, not declined", async () => {
  const s = setup()
  const running = await started(s)
  const elicit = running.options.onElicitation!
  expect(await elicit({ serverName: "linear", message: "Pick a team", mode: "form" } as never, { signal: new AbortController().signal, requestId: "e1" })).toEqual({ action: "cancel" })
})

/** Starts a background subagent and a background command in a turn that has ended. */
async function backgroundWork(s: ReturnType<typeof setup>, running: FakeQuery) {
  running.push({ type: "system", subtype: "task_started", uuid: "ts1", session_id: "s1", task_id: "t1", tool_use_id: "call1", task_type: "local_agent", description: "Find tests", is_backgrounded: true })
  running.push({ type: "system", subtype: "background_tasks_changed", uuid: "bt1", session_id: "s1", tasks: [{ task_id: "b1", task_type: "local_bash", description: "npm run dev" }] })
  running.push(result("r1"))
  await until(() => s.statuses().length === 2)
}

const lastSubagent = (s: ReturnType<typeof setup>) => s.events.findLast((event) => event.kind === "subagent")
const lastBackground = (s: ReturnType<typeof setup>) => s.events.findLast((event) => event.kind === "background")

test("a stream that ends stops the subagents still running and empties the background commands", async () => {
  const s = setup()
  const running = await started(s)
  await backgroundWork(s, running)
  expect(lastSubagent(s)).toMatchObject({ subagent: { id: "t1", status: "running" } })

  running.end()
  await until(() => lastBackground(s)?.kind === "background" && !lastBackground(s)!.tasks.length)
  expect(lastSubagent(s)).toMatchObject({ subagent: { id: "t1", status: "stopped", endedAt: expect.any(Number) } })
})

test("a failure and a close stop the subagents still running and empty the background commands", async () => {
  for (const end of ["fail", "close"] as const) {
    const s = setup()
    const running = await started(s)
    await backgroundWork(s, running)
    if (end === "fail") running.fail(new Error("Claude Code exited"))
    else s.session.close()
    await until(() => lastSubagent(s)?.kind === "subagent" && lastSubagent(s)!.subagent.status === "stopped")
    expect(lastBackground(s)).toEqual({ kind: "background", tasks: [] })
  }
})

test("a steered message waits until Claude Code takes it in", async () => {
  const s = setup()
  const running = await started(s)
  s.session.steer("Also check the tests")
  const steer = s.items().at(-1)!
  expect(steer).toMatchObject({ type: "user", steered: true, waiting: true })

  // Claude Code holds a steer behind a running foreground tool. Frames that name other messages leave it waiting.
  running.push({ type: "assistant", uuid: "a1", session_id: "s1", parent_tool_use_id: null, user_message_uuids: ["other"], message: { content: [] } })
  running.push({ type: "system", subtype: "init", uuid: "i2", session_id: "s1", model: "claude-opus-5-5", user_message_uuids: [steer.id] })
  await until(() => s.items().filter((item) => item.id === steer.id).length === 2)
  const taken = s.items().filter((item) => item.id === steer.id)
  expect(taken.at(-1)).toEqual({ type: "user", id: steer.id, text: "Also check the tests", at: expect.any(Number), steered: true })
})

test("a tool call that a stop cuts off shows as stopped, not failed", async () => {
  const s = setup()
  const running = await started(s)
  running.push({ type: "assistant", uuid: "a1", session_id: "s1", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "call1", name: "Bash", input: { command: "sleep 20" } }] } })
  await s.session.interrupt()
  // What Claude Code 2.1.325 sends for a call a stop cut off: an error, marked as rejected by the user.
  const content = [{ type: "tool_result", tool_use_id: "call1", is_error: true, content: "The user doesn't want to proceed with this tool use." }]
  running.push({ type: "user", uuid: "u2", session_id: "s1", parent_tool_use_id: null, message: { role: "user", content }, tool_result_meta: [{ id: "call1", non_execution_kind: "user-rejected" }] })
  await until(() => s.items().some((item) => item.type === "tool" && !!item.result))
  expect(s.items().at(-1)).toMatchObject({ type: "tool", id: "call1", label: "Stopped sleep", result: { isError: true, stopped: true } })
})

test("a tool call that fails without a stop shows as failed", async () => {
  const s = setup()
  const running = await started(s)
  running.push({ type: "assistant", uuid: "a1", session_id: "s1", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "call1", name: "Bash", input: { command: "npm test" } }] } })
  running.push({ type: "user", uuid: "u2", session_id: "s1", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call1", is_error: true, content: "1 failed" }] } })
  await until(() => s.items().some((item) => item.type === "tool" && !!item.result))
  expect(s.items().at(-1)).toMatchObject({ type: "tool", label: "Failed npm", result: { isError: true } })
  expect(s.items().at(-1)).not.toHaveProperty("result.stopped")
})

test("a stop marks the turn's result as stopped", async () => {
  const s = setup()
  const running = await started(s)
  await s.session.interrupt()
  expect(running.interrupts).toBe(1)
  expect(s.events.some((event) => event.kind === "stopping")).toBe(true)

  running.push(result("r1"))
  await until(() => s.statuses().length === 2)
  expect(s.results()).toEqual([{ type: "result", id: "r1", durationMs: 5, isError: false, stopped: true }])
})

test("Force stop works only after a stop was asked, and ends the turn as stopped", async () => {
  const s = setup()
  await started(s)
  expect(s.session.forceStop()).toBe(false)
  expect(s.session.busy).toBe(true)

  await s.session.interrupt()
  expect(s.session.forceStop()).toBe(true)
  expect(s.results()).toEqual([expect.objectContaining({ stopped: true })])
  expect(s.statuses()).toEqual([true, false])
  expect(s.session.forceStop()).toBe(false)
})

test("a permission request shows an item, and the first answer settles it", async () => {
  const s = setup()
  const running = await started(s)
  const ask = running.options.canUseTool as CanUseTool
  const reply = ask("Bash", { command: "ls" }, { signal: new AbortController().signal, toolUseID: "call1" } as never)
  expect(s.items().at(-1)).toMatchObject({ type: "permission", requestId: "call1", detail: "ls" })

  s.session.answerPermission("call1", "allow")
  s.session.answerPermission("call1", "decline")
  expect(await reply).toEqual({ behavior: "allow", updatedInput: { command: "ls" } })
  expect(s.items().filter((item) => item.type === "permission" && item.answered)).toHaveLength(1)
})

test("a stream that ends mid-turn fails the turn, and the next message starts Claude Code again", async () => {
  const s = setup()
  const running = await started(s)
  running.end()
  await until(() => s.statuses().length === 2)
  expect(s.items().at(-1)).toMatchObject({ type: "error", message: "Claude Code exited before it finished the turn." })
  expect(s.session.busy).toBe(false)

  s.session.send("Again")
  await until(() => s.queries.length === 2)
})

test("a stream that ends between turns shows nothing, and the next message starts Claude Code again", async () => {
  const s = setup()
  const running = await started(s)
  running.push(result("r1"))
  await until(() => s.statuses().length === 2)
  running.end()
  await Bun.sleep(10)
  expect(s.items().some((item) => item.type === "error")).toBe(false)

  s.session.send("Again")
  await until(() => s.queries.length === 2)
})

test("closing the session ends its stream without an error", async () => {
  const s = setup()
  await started(s)
  s.session.close()
  await Bun.sleep(10)
  expect(s.items().some((item) => item.type === "error")).toBe(false)
})

test("a failure shows an error and ends the turn, and the next message starts again", async () => {
  const s = setup()
  const running = await started(s)
  running.fail(new Error("Claude Code exited"))
  await until(() => s.statuses().length === 2)
  expect(s.items().at(-1)).toMatchObject({ type: "error", message: "Claude Code exited" })
  expect(s.statuses()).toEqual([true, false])

  s.session.send("Again")
  await until(() => s.queries.length === 2)
  expect(s.statuses()).toEqual([true, false, true])
})
