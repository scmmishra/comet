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
  const session = new ClaudeSession(DIR, (event) => void events.push(event), { settings: SETTINGS, onSessionId: () => {}, onRateLimit: () => {}, compactIdle: () => false }, run as never)
  const items = () => events.flatMap((event) => (event.kind === "item" ? [event.item] : []))
  const results = () => items().filter((item): item is Extract<ThreadItem, { type: "result" }> => item.type === "result")
  const statuses = () => events.flatMap((event) => (event.kind === "status" ? [event.busy] : []))
  return { session, events, queries, items, results, statuses }
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
