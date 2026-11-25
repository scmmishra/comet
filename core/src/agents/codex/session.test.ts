import { expect, jest, test } from "bun:test"
import type { PermissionAnswer, RunSettings, ThreadEvent, ThreadItem } from "@comet/protocol"
import { until } from "../../test-support"
import type { SessionOptions } from "../agent"
import { REQUEST_TOO_LARGE } from "./history"
import { fakeAppServer, MODELS } from "./test-app-server"
import { ModelCatalog } from "./models"
import { AppServer } from "./server"
import { CodexSession } from "./session"

const DIR = "/Users/ada/project"
const THREAD = "01a0d604-1f8d-7522-8fe1-371c6626896e"
const TURN = "01a0d604-2095-7fb0-a7e6-3f63d1949bbe"
const SETTINGS: RunSettings = { agent: "codex", model: "default", permissionMode: "default" }

const FULL_ACCESS_APPROVAL = { granular: { mcp_elicitations: true, request_permissions: false, rules: false, sandbox_approval: false, skill_approval: false } }

const turn = (status: string, extra: object = {}) => ({ id: TURN, items: [], itemsView: "notLoaded", status, error: null, startedAt: 1790296989, completedAt: null, durationMs: null, ...extra })

function setup(options: Partial<SessionOptions> = {}) {
  const codex = fakeAppServer()
  codex.answer("model/list", { data: MODELS, nextCursor: null })
  codex.answer("thread/start", { thread: { id: THREAD }, model: "gpt-6.1-sol" })
  codex.answer("thread/resume", { thread: { id: THREAD }, model: "gpt-6.1-sol" })
  codex.answer("turn/start", { turn: turn("inProgress", { startedAt: null }) })
  codex.answer("turn/steer", { turnId: TURN })
  codex.answer("turn/interrupt", {})
  codex.answer("thread/unsubscribe", { status: "unsubscribed" })
  codex.answer("config/read", { config: {}, layers: null })
  const server = new AppServer(codex.launch)
  const events: ThreadEvent[] = []
  const sessionIds: string[] = []
  const session = new CodexSession(DIR, (event) => void events.push(event), { settings: SETTINGS, onSessionId: (id) => void sessionIds.push(id), ...options }, server, new ModelCatalog(server))
  const items = () => events.flatMap((event) => (event.kind === "item" ? [event.item] : []))
  const last = <T extends ThreadItem["type"]>(type: T) => items().findLast((item): item is Extract<ThreadItem, { type: T }> => item.type === type)
  return { codex, session, events, sessionIds, items, last }
}

/** Sends a message and waits for Codex to start its turn. */
async function started(s: ReturnType<typeof setup>) {
  s.session.send("Hello")
  await until(() => s.codex.sent("turn/start").length > 0)
  s.codex.notify("turn/started", { threadId: THREAD, turn: turn("inProgress") })
  await until(() => s.events.some((event) => event.kind === "init"))
}

const item = (method: "item/started" | "item/completed", found: object) => [method, { threadId: THREAD, turnId: TURN, item: found }] as const

test("runs a whole turn: the thread, the message with its settings, and every item Codex reports", async () => {
  const tools = { url: "http://127.0.0.1:4000/mcp", authorization: "Bearer t", instructions: "Hand work to other agents." }
  const s = setup({ settings: { agent: "codex", model: "gpt-6-luna", effort: "high", fast: true, permissionMode: "acceptEdits" }, tools })
  s.session.send("Fix the bug", [{ mediaType: "image/png", data: "iVBOR" }])
  const message = s.items()[0]!
  expect(message).toMatchObject({ type: "user", text: "Fix the bug", images: [{ mediaType: "image/png", data: "iVBOR" }] })
  expect(s.events[1]).toEqual({ kind: "status", busy: true })
  await until(() => s.codex.sent("turn/start").length > 0)
  expect(s.codex.sent("thread/start")).toEqual([
    {
      cwd: DIR,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      model: "gpt-6-luna",
      config: { "mcp_servers.comet": { url: tools.url, http_headers: { Authorization: "Bearer t" }, tool_timeout_sec: 3900 } },
      developerInstructions: "Hand work to other agents.",
    },
  ])
  expect(s.sessionIds).toEqual([THREAD])
  expect(s.codex.sent("turn/start")).toEqual([
    {
      threadId: THREAD,
      clientUserMessageId: message.id,
      input: [
        { type: "text", text: "Fix the bug", text_elements: [] },
        { type: "image", url: "data:image/png;base64,iVBOR" },
      ],
      summary: "auto",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      model: "gpt-6-luna",
      effort: "high",
      serviceTier: "priority",
    },
  ])

  s.codex.notify("turn/started", { threadId: THREAD, turn: turn("inProgress") })
  s.codex.notify(...item("item/started", { type: "userMessage", id: "u1", clientId: message.id, content: [] }))
  s.codex.notify(...item("item/started", { type: "reasoning", id: "rs_1", summary: [], content: [] }))
  s.codex.notify(...item("item/completed", { type: "reasoning", id: "rs_1", summary: ["**Reading the code**", "Then fixing it."], content: [] }))
  s.codex.notify(...item("item/started", { type: "agentMessage", id: "msg_1", text: "", phase: "commentary" }))
  s.codex.notify("item/agentMessage/delta", { threadId: THREAD, turnId: TURN, itemId: "msg_1", delta: "Running" })
  s.codex.notify("item/agentMessage/delta", { threadId: THREAD, turnId: TURN, itemId: "msg_1", delta: " tests." })
  s.codex.notify(...item("item/completed", { type: "agentMessage", id: "msg_1", text: "Running tests.", phase: "commentary" }))
  const command = { type: "commandExecution", id: "exec-1", command: "/bin/zsh -lc 'npm test'", cwd: DIR, status: "inProgress", commandActions: [], aggregatedOutput: null, exitCode: null }
  s.codex.notify(...item("item/started", command))
  s.codex.notify(...item("item/completed", { ...command, status: "completed", aggregatedOutput: "1 failing", exitCode: 1 }))
  const patch = { type: "fileChange", id: "exec-2", status: "completed", changes: [{ path: `${DIR}/src/a.ts`, kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-const a = 1\n+const a = 2\n" }, { path: `${DIR}/b.txt`, kind: { type: "add" }, diff: "new\n" }] }
  s.codex.notify(...item("item/completed", patch))
  s.codex.notify("thread/tokenUsage/updated", { threadId: THREAD, turnId: TURN, tokenUsage: { total: { totalTokens: 9 }, last: { totalTokens: 25840 }, modelContextWindow: 258400 } })
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed", { completedAt: 1790296994, durationMs: 4289 }) })
  await until(() => !s.session.busy)

  const after = s.events.slice(s.events.findIndex((event) => event.kind === "init"))
  expect(after[0]).toEqual({ kind: "init", model: "GPT-6-Luna" })
  const shown = after.flatMap((event): (ThreadItem | string)[] => (event.kind === "item" ? [event.item] : event.kind === "text.delta" ? [event.delta] : []))
  expect(shown).toEqual([
    { type: "thinking", id: "rs_1", kind: "thought", label: "Thought" },
    { type: "thinking", id: "rs_1", text: "**Reading the code**\n\nThen fixing it.", kind: "thought", label: "Reading the code" },
    { type: "text", id: "msg_1", text: "", done: false },
    "Running",
    " tests.",
    { type: "text", id: "msg_1", text: "Running tests.", done: true, at: expect.any(Number) },
    { type: "tool", id: "exec-1", name: "Bash", summary: "npm test", kind: "command", label: "Running npm" },
    { type: "tool", id: "exec-1", name: "Bash", summary: "npm test", result: { output: "1 failing", isError: true }, kind: "command", label: "Failed npm" },
    { type: "tool", id: "exec-2:0", name: "Edit", summary: "src/a.ts", file: "src/a.ts", edits: [{ before: "const a = 1", after: "const a = 2" }], result: { output: "", isError: false }, kind: "edit", label: "Edited src/a.ts" },
    { type: "tool", id: "exec-2:1", name: "Edit", summary: "b.txt", file: "b.txt", edits: [{ before: "", after: "new\n" }], result: { output: "", isError: false }, kind: "edit", label: "Wrote b.txt" },
    { type: "result", id: `result:${message.id}`, durationMs: 4289, isError: false },
  ])
  expect(s.events).toContainEqual({ kind: "context", reading: { percent: 10, tokens: 25840, maxTokens: 258400 } })
  expect(s.events.at(-1)).toEqual({ kind: "status", busy: false })
})

test("starts an ephemeral thread when the session leaves no saved thread", async () => {
  const s = setup({ ephemeral: true })
  s.session.send("Review this")
  await until(() => s.codex.sent("turn/start").length > 0)
  expect(s.codex.sent("thread/start")[0]).toMatchObject({ ephemeral: true })
})

test("asks for output that follows a schema, and puts the parsed answer on the turn's result", async () => {
  const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] }
  const s = setup({ outputSchema: schema })
  await started(s)
  expect(s.codex.sent("turn/start")[0]).toMatchObject({ outputSchema: schema })
  s.codex.notify(...item("item/completed", { type: "agentMessage", id: "msg_1", text: '{"title":"Guide"}', phase: "final_answer" }))
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => s.last("result") !== undefined)
  expect(s.last("result")!.output).toEqual({ title: "Guide" })
})

test("leaves the output out of a turn without a schema, and of one whose answer is not JSON", async () => {
  const plain = setup()
  await started(plain)
  expect(plain.codex.sent("turn/start")[0]).not.toHaveProperty("outputSchema")
  plain.codex.notify(...item("item/completed", { type: "agentMessage", id: "msg_1", text: '{"title":"Guide"}', phase: "final_answer" }))
  plain.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => plain.last("result") !== undefined)
  expect(plain.last("result")).not.toHaveProperty("output")

  const prose = setup({ outputSchema: { type: "object" } })
  await started(prose)
  prose.codex.notify(...item("item/completed", { type: "agentMessage", id: "msg_1", text: "Here is the guide.", phase: "final_answer" }))
  prose.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => prose.last("result") !== undefined)
  expect(prose.last("result")).not.toHaveProperty("output")
})

test("names the default model and its effort, and takes new settings from the next turn", async () => {
  const s = setup()
  await started(s)
  expect(s.codex.sent("thread/start")[0]).toEqual({ cwd: DIR, approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "read-only", model: "gpt-6.1-sol" })
  expect(s.codex.sent("turn/start")[0]).toMatchObject({ model: "gpt-6.1-sol", effort: "low", serviceTier: null, approvalPolicy: "untrusted", sandboxPolicy: { type: "readOnly", networkAccess: false } })
  expect(s.events).toContainEqual({ kind: "init", model: "GPT-6.1-Sol" })
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => !s.session.busy)
  await s.session.configure({ agent: "codex", model: "gpt-6-luna", permissionMode: "bypassPermissions" })
  s.session.send("Again")
  await until(() => s.codex.sent("turn/start").length === 2)
  expect(s.codex.sent("thread/start")).toHaveLength(1)
  expect(s.codex.sent("turn/start")[1]).toMatchObject({ model: "gpt-6-luna", effort: "high", serviceTier: null, approvalPolicy: FULL_ACCESS_APPROVAL, sandboxPolicy: { type: "dangerFullAccess" } })
})

test("shows the model Codex moved a turn to, and the model asked for again on the next turn", async () => {
  const s = setup()
  await started(s)
  s.codex.notify("model/rerouted", { threadId: THREAD, turnId: TURN, fromModel: "gpt-6.1-sol", toModel: "gpt-6-luna", reason: "highRiskCyberActivity" })
  await until(() => s.events.filter((event) => event.kind === "init").length === 2)
  expect(s.events.filter((event) => event.kind === "init")).toEqual([
    { kind: "init", model: "GPT-6.1-Sol" },
    { kind: "init", model: "GPT-6-Luna" },
  ])
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => !s.session.busy)
  s.session.send("Again")
  await until(() => s.codex.sent("turn/start").length === 2)
  s.codex.notify("turn/started", { threadId: THREAD, turn: turn("inProgress") })
  await until(() => s.events.filter((event) => event.kind === "init").length === 3)
  expect(s.events.findLast((event) => event.kind === "init")).toEqual({ kind: "init", model: "GPT-6.1-Sol" })
})

test("in Auto mode, lets Codex's reviewer answer approvals in a sandbox that can write the project", async () => {
  const s = setup({ settings: { ...SETTINGS, permissionMode: "auto" } })
  await started(s)
  expect(s.codex.sent("thread/start")[0]).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandbox: "workspace-write" })
  expect(s.codex.sent("turn/start")[0]).toMatchObject({ approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite" } })
})

test("resumes a saved thread", async () => {
  const s = setup({ resume: THREAD })
  await started(s)
  expect(s.codex.sent("thread/start")).toEqual([])
  expect(s.codex.sent("thread/resume")[0]).toMatchObject({ threadId: THREAD, cwd: DIR, excludeTurns: true })
  expect(s.sessionIds).toEqual([])
})

test("steers a message into the running turn, once the turn has started", async () => {
  const s = setup()
  s.session.send("Write the tests")
  await until(() => s.codex.sent("turn/start").length > 0)
  s.session.steer("Use bun", [{ mediaType: "image/jpeg", data: "abc" }])
  const steered = s.last("user")!
  expect(steered).toMatchObject({ text: "Use bun", steered: true })
  await Bun.sleep(20)
  // The turn waits in Codex's queue, and Codex steers only a turn that has started.
  expect(s.codex.sent("turn/steer")).toEqual([])
  s.codex.notify("turn/started", { threadId: THREAD, turn: turn("inProgress") })
  await until(() => s.codex.sent("turn/steer").length > 0)
  expect(s.codex.sent("turn/steer")).toEqual([
    { threadId: THREAD, expectedTurnId: TURN, clientUserMessageId: steered.id, input: [{ type: "text", text: "Use bun", text_elements: [] }, { type: "image", url: "data:image/jpeg;base64,abc" }] },
  ])
})

test("starts the next turn with a steered message that missed the running one", async () => {
  const s = setup()
  s.codex.answer("turn/steer", () => {
    throw new Error("expected turn does not match")
  })
  await started(s)
  s.session.steer("Also this")
  const steered = s.last("user")!
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => s.codex.sent("turn/start").length === 2)
  expect(s.codex.sent("turn/start")[1]).toMatchObject({ clientUserMessageId: steered.id })
  expect(s.session.busy).toBe(true)
})

test("stops a queued turn once it starts, and its result says it was stopped", async () => {
  const s = setup()
  s.session.send("Long work")
  await until(() => s.codex.sent("turn/start").length > 0)
  const message = s.items()[0]!
  const stopping = s.session.interrupt()
  expect(s.events).toContainEqual({ kind: "stopping", since: expect.any(Number), unresponsive: false })
  await Bun.sleep(20)
  expect(s.codex.sent("turn/interrupt")).toEqual([])
  s.codex.notify("turn/started", { threadId: THREAD, turn: turn("inProgress") })
  await stopping
  expect(s.codex.sent("turn/interrupt")).toEqual([{ threadId: THREAD, turnId: TURN }])
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("interrupted", { durationMs: 900 }) })
  await until(() => !s.session.busy)
  expect(s.last("result")).toEqual({ type: "result", id: `result:${message.id}`, durationMs: 900, isError: false, stopped: true })
})

test("forces a stop that Codex did not answer", async () => {
  const s = setup()
  await started(s)
  expect(s.session.forceStop()).toBe(false)
  void s.session.interrupt()
  expect(s.session.forceStop()).toBe(true)
  expect(s.last("result")).toMatchObject({ stopped: true })
  expect(s.session.busy).toBe(false)
})

test.each([
  ["completed", { isError: false }],
  ["failed", { isError: true }],
  ["interrupted", { isError: true, stopped: true }],
] as const)("a web search a %s turn left open gets a result before the turn's result, and a finished one keeps its own", async (status, flags) => {
  const s = setup()
  await started(s)
  s.codex.notify(...item("item/started", { type: "webSearch", id: "w1", query: "bun release" }))
  s.codex.notify(...item("item/started", { type: "webSearch", id: "w2", query: "rune kit" }))
  s.codex.notify(...item("item/started", { type: "contextCompaction", id: "c1" }))
  s.codex.notify(...item("item/completed", { type: "webSearch", id: "w2", query: "rune kit" }))
  await until(() => s.items().some((found) => found.id === "w2" && found.type === "tool" && found.result))
  expect(s.items().filter((found) => found.id === "w1")).toHaveLength(1)
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn(status, { error: status === "failed" ? { message: "No." } : null }) })
  await until(() => !s.session.busy)
  const settled = s.items().filter((found) => found.id === "w1" && found.type === "tool" && found.result)
  expect(settled).toEqual([expect.objectContaining({ result: { output: "The search did not finish.", ...flags }, label: "Did not finish searching the web for bun release" })])
  expect(s.items().filter((found) => found.id === "w2" && found.type === "tool" && found.result)).toEqual([expect.objectContaining({ result: { output: "", isError: false } })])
  expect(s.last("compaction")).toEqual({ type: "compaction", id: "c1", status: status === "failed" ? "failed" : "stopped" })
  expect(s.items().findIndex((found) => found.id === "w1" && found.type === "tool" && found.result)).toBeLessThan(s.items().findIndex((found) => found.type === "result"))
})

const runningCommand = (id: string, processId: string | null) => ({ type: "commandExecution", id, command: "/bin/zsh -lc 'sleep 40'", cwd: DIR, status: "inProgress", commandActions: [], aggregatedOutput: null, exitCode: null, processId })
const commandResults = (s: ReturnType<typeof setup>, id: string) => s.items().filter((found) => found.id === id && found.type === "tool" && found.result)

test("a command whose terminal is gone when its turn ends settles, and one still in a terminal stays running until Codex completes it", async () => {
  const s = setup()
  const pages: Record<string, unknown> = { first: { data: [{ processId: "p-other" }], nextCursor: "next" }, next: { data: [{ processId: "p-live" }], nextCursor: null } }
  s.codex.answer("thread/backgroundTerminals/list", (params: { cursor?: string }) => pages[params.cursor ?? "first"])
  await started(s)
  s.codex.notify(...item("item/started", runningCommand("gone", "p-gone")))
  s.codex.notify(...item("item/started", runningCommand("live", "p-live")))
  // A command with no process id may own the terminal no other command claims.
  s.codex.notify(...item("item/started", runningCommand("unknown", null)))
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => commandResults(s, "gone").length > 0)
  expect(s.codex.sent("thread/backgroundTerminals/list")).toEqual([{ threadId: THREAD }, { threadId: THREAD, cursor: "next" }])
  expect(commandResults(s, "gone")).toEqual([expect.objectContaining({ result: { output: "The tool call did not finish.", isError: true }, label: "Failed sleep" })])
  expect(commandResults(s, "live")).toEqual([])
  expect(commandResults(s, "unknown")).toEqual([])
  s.codex.notify(...item("item/completed", { ...runningCommand("live", "p-live"), status: "completed", aggregatedOutput: "done", exitCode: 0 }))
  await until(() => commandResults(s, "live").length > 0)
  expect(commandResults(s, "live")).toEqual([expect.objectContaining({ result: { output: "done", isError: false }, label: "Ran sleep" })])
})

test("a command settles as stopped when the user stopped its turn, and not when Codex completes it while the terminals are listed", async () => {
  const s = setup()
  let list!: (page: unknown) => void
  s.codex.answer("thread/backgroundTerminals/list", () => new Promise((resolve) => (list = resolve)))
  await started(s)
  s.codex.notify(...item("item/started", runningCommand("late", "p-late")))
  s.codex.notify(...item("item/started", runningCommand("gone", "p-gone")))
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("interrupted") })
  await until(() => !s.session.busy && s.codex.sent("thread/backgroundTerminals/list").length > 0)
  s.codex.notify(...item("item/completed", { ...runningCommand("late", "p-late"), status: "completed", aggregatedOutput: "", exitCode: 0 }))
  await until(() => commandResults(s, "late").length > 0)
  list({ data: [], nextCursor: null })
  await until(() => commandResults(s, "gone").length > 0)
  expect(commandResults(s, "gone")).toEqual([expect.objectContaining({ result: { output: "The tool call did not finish.", isError: true, stopped: true }, label: "Stopped sleep" })])
  expect(commandResults(s, "late")).toEqual([expect.objectContaining({ result: { output: "", isError: false } })])
})

test("an open command stays running when Codex cannot list the terminals, and settles when the app-server dies", async () => {
  const s = setup()
  s.codex.answer("thread/backgroundTerminals/list", () => {
    throw new Error("Unknown method")
  })
  await started(s)
  s.codex.notify(...item("item/started", runningCommand("open", "p-open")))
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => !s.session.busy && s.codex.sent("thread/backgroundTerminals/list").length > 0)
  await Bun.sleep(10)
  expect(commandResults(s, "open")).toEqual([])
  s.codex.hangUp()
  await until(() => commandResults(s, "open").length > 0)
  expect(commandResults(s, "open")).toEqual([expect.objectContaining({ result: { output: "The tool call did not finish.", isError: true }, label: "Failed sleep" })])
})

test("a turn that failed on a request too large reads as one sentence, not the provider's HTML page", async () => {
  const s = setup()
  await started(s)
  const message =
    "unexpected status 413 Payload Too Large: <html><head><title>413 Request Entity Too Large</title></head><body><center><h1>413 Request Entity Too Large</h1></center><hr><center>nginx</center></body></html>, url: http://127.0.0.1:18413/v1/responses"
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("failed", { error: { message } }) })
  await until(() => !s.session.busy)
  expect(s.last("error")?.message).toBe(REQUEST_TOO_LARGE)
})

test("an open web search settles when the app-server dies or a stop is forced, and not again on the next turn", async () => {
  const s = setup()
  await started(s)
  s.codex.notify(...item("item/started", { type: "webSearch", id: "w1", query: "one" }))
  await until(() => s.items().some((found) => found.id === "w1"))
  s.codex.hangUp()
  await until(() => !s.session.busy)
  expect(s.items().filter((found) => found.id === "w1" && found.type === "tool" && found.result)).toHaveLength(1)
  s.session.send("Again")
  await until(() => s.codex.sent("turn/start").length === 2)
  s.codex.notify("turn/started", { threadId: THREAD, turn: turn("inProgress") })
  s.codex.notify(...item("item/started", { type: "webSearch", id: "w2", query: "two" }))
  await until(() => s.items().some((found) => found.id === "w2"))
  void s.session.interrupt()
  expect(s.session.forceStop()).toBe(true)
  expect(s.items().filter((found) => found.id === "w1" && found.type === "tool" && found.result)).toHaveLength(1)
  expect(s.items().filter((found) => found.id === "w2" && found.type === "tool" && found.result)).toEqual([expect.objectContaining({ result: { output: "The search did not finish.", isError: true, stopped: true } })])
})

const ANSWERS: [PermissionAnswer, string][] = [
  ["allow", "accept"],
  ["allow-session", "acceptForSession"],
  ["decline", "decline"],
  ["cancel", "cancel"],
]

test("asks to approve a command, and answers with the user's decision", async () => {
  const s = setup()
  await started(s)
  for (const [index, [answer, decision]] of ANSWERS.entries()) {
    s.codex.ask(index, "item/commandExecution/requestApproval", { kind: "command", threadId: THREAD, turnId: TURN, itemId: `exec-${index}`, reason: "May I write the file?", command: "/bin/bash -lc \"printf 'x' > a.txt\"" })
    await until(() => s.last("permission")?.requestId === `exec-${index}`)
    expect(s.last("permission")).toEqual({ type: "permission", id: `permission:exec-${index}`, requestId: `exec-${index}`, tool: "Bash", kind: "command", detail: "printf 'x' > a.txt", reason: "May I write the file?", allowSession: true })
    s.session.answerPermission(`exec-${index}`, answer)
    await until(() => s.codex.reply(index) !== undefined)
    expect(s.codex.reply(index)).toEqual({ id: index, result: { decision } })
    expect(s.last("permission")).toMatchObject({ requestId: `exec-${index}`, answered: true })
  }
})

test("asks to approve a file change by the paths Codex reported for it", async () => {
  const s = setup()
  await started(s)
  s.codex.notify(...item("item/started", { type: "fileChange", id: "exec-9", status: "inProgress", changes: [{ path: `${DIR}/src/a.ts`, kind: { type: "update", move_path: null }, diff: "" }] }))
  s.codex.ask(0, "item/fileChange/requestApproval", { threadId: THREAD, turnId: TURN, itemId: "exec-9", reason: null, grantRoot: null })
  s.codex.ask(1, "item/fileChange/requestApproval", { threadId: THREAD, turnId: TURN, itemId: "exec-10", reason: "Write outside the project", grantRoot: null })
  await until(() => s.items().filter((found) => found.type === "permission").length === 2)
  const [first, second] = s.items().filter((found) => found.type === "permission")
  expect(first).toMatchObject({ tool: "Edit", kind: "file-change", detail: "src/a.ts" })
  expect(second).toMatchObject({ detail: "Write outside the project" })
  expect(second).not.toHaveProperty("reason")
  s.session.answerPermission("exec-9", "allow-session")
  await until(() => s.codex.reply(0) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, result: { decision: "acceptForSession" } })
})

test("grants extra permissions for the turn or the session, and none when refused", async () => {
  const s = setup()
  await started(s)
  const permissions = { network: { enabled: true }, fileSystem: { read: null, write: ["/tmp/out"] } }
  for (const [index, [answer, expected]] of ([["allow", { permissions, scope: "turn" }], ["allow-session", { permissions, scope: "session" }], ["decline", { permissions: {}, scope: "turn" }]] as const).entries()) {
    s.codex.ask(index, "item/permissions/requestApproval", { threadId: THREAD, turnId: TURN, itemId: `p${index}`, cwd: DIR, reason: null, permissions })
    await until(() => s.last("permission")?.requestId === `p${index}`)
    expect(s.last("permission")).toMatchObject({ kind: "permission", detail: "Allow network access and writing to /tmp/out" })
    s.session.answerPermission(`p${index}`, answer)
    await until(() => s.codex.reply(index) !== undefined)
    expect(s.codex.reply(index)).toEqual({ id: index, result: expected })
  }
})

test("names every path a permissions request asks for, from its entries and its older lists", async () => {
  const s = setup()
  await started(s)
  // Codex 0.169 lists paths in `entries`, and may list a path in its older `write` list too.
  const fileSystem = {
    read: null,
    write: ["/w/out"],
    entries: [
      { access: "write", path: { type: "path", path: "/w/out" } },
      { access: "write", path: { type: "special", value: { kind: "root" } } },
      { access: "read", path: { type: "glob_pattern", pattern: "/w/docs/**/*.md" } },
      { access: "read", path: { type: "special", value: { kind: "project_roots", subpath: "src" } } },
      { access: "write", path: { type: "special", value: { kind: "unknown", path: "", subpath: null } } },
    ],
  }
  s.codex.ask(0, "item/permissions/requestApproval", { threadId: THREAD, turnId: TURN, itemId: "p0", cwd: DIR, reason: "Build the docs", permissions: { network: null, fileSystem } })
  await until(() => s.last("permission")?.requestId === "p0")
  expect(s.last("permission")).toMatchObject({ detail: "Allow writing to /w/out, / (the whole disk), an unknown path and reading /w/docs/**/*.md, the project roots/src", reason: "Build the docs" })
})

test("names the host a command asks to reach", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(0, "item/commandExecution/requestApproval", { threadId: THREAD, turnId: TURN, itemId: "exec-net", command: "curl https://example.com", cwd: DIR, reason: "Needs network", networkApprovalContext: { host: "example.com", protocol: "https" } })
  await until(() => s.last("permission")?.requestId === "exec-net")
  expect(s.last("permission")).toMatchObject({ detail: "curl https://example.com\nNetwork access to example.com (https)", reason: "Needs network" })
})

test("answers Codex's older approvals in their own words", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(0, "execCommandApproval", { conversationId: THREAD, callId: "c1", approvalId: null, command: ["/bin/zsh", "-lc", "rm -rf build"], cwd: DIR, reason: null, parsedCmd: [] })
  s.codex.ask(1, "applyPatchApproval", { conversationId: THREAD, callId: "c2", fileChanges: { "src/a.ts": {} }, reason: null, grantRoot: null })
  await until(() => s.items().filter((found) => found.type === "permission").length === 2)
  expect(s.items().filter((found) => found.type === "permission").map((found) => found.type === "permission" && found.detail)).toEqual(["rm -rf build", "src/a.ts"])
  s.session.answerPermission("c1", "decline")
  s.session.answerPermission("c2", "allow")
  await until(() => s.codex.reply(0) !== undefined && s.codex.reply(1) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, result: { decision: { denied: { rejection: "The user declined." } } } })
  expect(s.codex.reply(1)).toEqual({ id: 1, result: { decision: "approved" } })
})

test("asks Codex's questions, and answers by question id", async () => {
  const s = setup()
  await started(s)
  const question = { id: "schema_preference", header: "Fixture", question: "Strict schemas or UI flexibility?", isOther: true, isSecret: false, options: [{ label: "Strict schemas", description: "Validate tightly." }, { label: "UI flexibility", description: "UI flexibility" }] }
  s.codex.ask(0, "item/tool/requestUserInput", { threadId: THREAD, turnId: TURN, itemId: "call_1", questions: [question], isBlocking: true, autoResolutionMs: null })
  await until(() => s.last("question") !== undefined)
  expect(s.last("question")).toEqual({
    type: "question",
    id: "question:call_1",
    requestId: "call_1",
    questions: [{ header: "Fixture", question: "Strict schemas or UI flexibility?", options: [{ label: "Strict schemas", description: "Validate tightly." }, { label: "UI flexibility" }], multiSelect: false }],
  })
  s.session.answerPermission("call_1", "allow")
  s.session.answerQuestion("call_1", { "Strict schemas or UI flexibility?": "Strict schemas" })
  await until(() => s.codex.reply(0) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, result: { answers: { schema_preference: { answers: ["Strict schemas"] } } } })
  s.codex.ask(1, "item/tool/requestUserInput", { threadId: THREAD, turnId: TURN, itemId: "call_2", questions: [question], isBlocking: true, autoResolutionMs: null })
  await until(() => s.last("question")?.requestId === "call_2")
  s.session.answerQuestion("call_2", undefined)
  await until(() => s.codex.reply(1) !== undefined)
  expect(s.codex.reply(1)).toEqual({ id: 1, result: { answers: { schema_preference: { answers: [] } } } })
})

test("a request Codex settles itself leaves the thread, and Codex gets no second answer", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(7, "item/commandExecution/requestApproval", { kind: "command", threadId: THREAD, turnId: TURN, itemId: "exec-1", command: "ls" })
  await until(() => s.last("permission") !== undefined)
  s.codex.notify("serverRequest/resolved", { threadId: THREAD, requestId: 7 })
  await until(() => s.last("permission")?.answered === true && s.codex.reply(7) !== undefined)
  s.session.answerPermission("exec-1", "allow")
  await Bun.sleep(20)
  expect(s.codex.replies(7)).toEqual([{ id: 7, result: { decision: "decline" } }])
})

test("approves a call of Comet's own tools itself, and asks the user about another MCP server's", async () => {
  const s = setup()
  await started(s)
  const form = { type: "object", properties: { remember: { type: "boolean", default: false } } }
  s.codex.ask(0, "mcpServer/elicitation/request", { threadId: THREAD, turnId: TURN, serverName: "comet", mode: "form", _meta: null, message: "Allow comet to run list_agents?", requestedSchema: form })
  await until(() => s.codex.reply(0) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, result: { action: "accept", content: { remember: false }, _meta: null } })
  expect(s.last("permission")).toBeUndefined()

  s.codex.ask(1, "mcpServer/elicitation/request", { threadId: THREAD, turnId: TURN, serverName: "github", mode: "form", _meta: null, message: "Allow github to run create_issue?", requestedSchema: form })
  await until(() => s.last("permission") !== undefined)
  expect(s.last("permission")).toMatchObject({ tool: "github", kind: "permission", detail: "Allow github to run create_issue?", allowSession: true })
  s.session.answerPermission(s.last("permission")!.requestId, "allow-session")
  await until(() => s.codex.reply(1) !== undefined)
  expect(s.codex.reply(1)).toEqual({ id: 1, result: { action: "accept", content: { remember: false }, _meta: { persist: "session" } } })

  s.codex.ask(2, "mcpServer/elicitation/request", { threadId: THREAD, turnId: null, serverName: "github", mode: "form", _meta: null, message: "Allow github to run delete_repo?", requestedSchema: form })
  await until(() => s.last("permission")?.detail === "Allow github to run delete_repo?")
  s.session.answerPermission(s.last("permission")!.requestId, "decline")
  await until(() => s.codex.reply(2) !== undefined)
  expect(s.codex.reply(2)).toEqual({ id: 2, result: { action: "decline", content: null, _meta: null } })
})

test("in full access, asks Codex for MCP prompts and accepts each without a card, and still runs commands without asking", async () => {
  const s = setup({ settings: { ...SETTINGS, permissionMode: "bypassPermissions" } })
  await started(s)
  expect(s.codex.sent("thread/start")[0]).toMatchObject({ approvalPolicy: FULL_ACCESS_APPROVAL, sandbox: "danger-full-access" })
  expect(s.codex.sent("turn/start")[0]).toMatchObject({ approvalPolicy: FULL_ACCESS_APPROVAL, approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } })
  const toolCall = { codex_approval_kind: "mcp_tool_call", persist: ["session", "always"], tool_name: "ask_access" }
  s.codex.ask(0, "mcpServer/elicitation/request", { threadId: THREAD, turnId: TURN, serverName: "probe", mode: "form", _meta: toolCall, message: "Allow the probe MCP server to run tool \"ask_access\"?", requestedSchema: { type: "object", properties: {} } })
  await until(() => s.codex.reply(0) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, result: { action: "accept", content: {}, _meta: null } })
  const form = { type: "object", properties: { allow: { type: "boolean", default: true } }, required: ["allow"] }
  s.codex.ask(1, "mcpServer/elicitation/request", { threadId: THREAD, turnId: TURN, serverName: "probe", mode: "form", _meta: null, message: "Allow access?", requestedSchema: form })
  await until(() => s.codex.reply(1) !== undefined)
  expect(s.codex.reply(1)).toEqual({ id: 1, result: { action: "accept", content: { allow: true }, _meta: null } })
  expect(s.last("permission")).toBeUndefined()
})

test("in full access, accepts a command Codex deems dangerous without a card", async () => {
  const s = setup({ settings: { ...SETTINGS, permissionMode: "bypassPermissions" } })
  await started(s)
  // What Codex 0.169.0 sent for `rm -rf junk` under full access.
  s.codex.ask(0, "item/commandExecution/requestApproval", { threadId: THREAD, turnId: TURN, itemId: "exec-rm", command: "/bin/zsh -lc 'rm -rf junk'", cwd: DIR, reason: null })
  await until(() => s.codex.reply(0) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, result: { decision: "accept" } })
  expect(s.last("permission")).toBeUndefined()
})

test("in full access, still asks before a command that needs network access the network settings do not allow", async () => {
  const s = setup({ settings: { ...SETTINGS, permissionMode: "bypassPermissions" } })
  await started(s)
  const asks = [{ networkApprovalContext: { host: "example.com", protocol: "https" } }, { proposedNetworkPolicyAmendments: [{ host: "example.com", action: "allow" }] }]
  for (const [index, network] of asks.entries()) {
    s.codex.ask(index, "item/commandExecution/requestApproval", { threadId: THREAD, turnId: TURN, itemId: `exec-${index}`, command: "curl https://example.com", reason: null, ...network })
    await until(() => s.last("permission")?.requestId === `exec-${index}`)
    expect(s.codex.reply(index)).toBeUndefined()
    s.session.answerPermission(`exec-${index}`, "decline")
    await until(() => s.codex.reply(index) !== undefined)
  }
})

test("outside full access, asks before a command Codex deems dangerous", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(0, "item/commandExecution/requestApproval", { threadId: THREAD, turnId: TURN, itemId: "exec-rm", command: "/bin/zsh -lc 'rm -rf junk'", reason: null })
  await until(() => s.last("permission")?.requestId === "exec-rm")
  expect(s.codex.reply(0)).toBeUndefined()
})

test("cancels an MCP prompt Comet cannot answer: one that opens a page, and a form with a required field it cannot fill", async () => {
  for (const permissionMode of ["default", "bypassPermissions"] as const) {
    const s = setup({ settings: { ...SETTINGS, permissionMode } })
    await started(s)
    s.codex.ask(0, "mcpServer/elicitation/request", { threadId: THREAD, turnId: TURN, serverName: "github", mode: "url", _meta: null, message: "Sign in", url: "https://example.com", elicitationId: "e1" })
    await until(() => s.codex.reply(0) !== undefined)
    expect(s.codex.reply(0)).toEqual({ id: 0, result: { action: "cancel", content: null, _meta: null } })
  }
  const s = setup({ settings: { ...SETTINGS, permissionMode: "bypassPermissions" } })
  await started(s)
  s.codex.ask(0, "mcpServer/elicitation/request", { threadId: THREAD, turnId: TURN, serverName: "probe", mode: "form", _meta: null, message: "Your name?", requestedSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } })
  await until(() => s.codex.reply(0) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, result: { action: "cancel", content: null, _meta: null } })
})

test("refuses a request Comet does not handle", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(0, "item/tool/call", { threadId: THREAD, turnId: TURN, callId: "c1", tool: "lookup", arguments: {} })
  await until(() => s.codex.reply(0) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, error: { code: -32601, message: "Comet does not handle that request." } })
})

test("takes requests from the threads of agents Codex starts", async () => {
  const s = setup()
  await started(s)
  const spawn = { type: "collabAgentToolCall", id: "call_spawn", tool: "spawnAgent", status: "completed", senderThreadId: THREAD, receiverThreadIds: ["child"], prompt: "Read package.json\nReport its scripts.", model: null, reasoningEffort: null, agentsStates: {} }
  s.codex.notify(...item("item/completed", spawn))
  s.codex.notify("item/started", { threadId: "child", turnId: "t2", item: { type: "subAgentActivity", id: "call_x", kind: "started", agentThreadId: "grandchild", agentPath: "/root/a/b" } })
  s.codex.ask(0, "item/commandExecution/requestApproval", { kind: "command", threadId: "grandchild", turnId: "t3", itemId: "exec-g", command: "ls" })
  await until(() => s.last("permission") !== undefined)
  expect(s.last("permission")).toMatchObject({ requestId: "exec-g", detail: "ls" })
  expect(s.last("tool")).toMatchObject({ id: "call_spawn", label: "Started an agent: Read package.json" })
  // The child's own items stay out of the thread.
  expect(s.items().some((found) => found.id === "call_x")).toBe(false)
})

test("closing the tab declines open requests and stops the turn", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(0, "item/commandExecution/requestApproval", { kind: "command", threadId: THREAD, turnId: TURN, itemId: "exec-1", command: "ls" })
  s.codex.ask(1, "item/tool/requestUserInput", { threadId: THREAD, turnId: TURN, itemId: "call_1", questions: [{ id: "q", header: "H", question: "Q?", options: null }] })
  await until(() => s.last("question") !== undefined)
  s.session.close()
  await until(() => s.codex.reply(0) !== undefined && s.codex.reply(1) !== undefined && s.codex.sent("turn/interrupt").length > 0)
  expect(s.codex.reply(0)).toEqual({ id: 0, result: { decision: "decline" } })
  expect(s.codex.reply(1)).toEqual({ id: 1, result: { answers: { q: { answers: [] } } } })
  expect(s.last("permission")).toMatchObject({ answered: true })
  expect(s.last("question")).toMatchObject({ answered: true })
})

test("a closed session unsubscribes from its thread, and one that never loaded a thread sends nothing", async () => {
  const s = setup()
  await started(s)
  s.session.close()
  await until(() => s.codex.sent("thread/unsubscribe").length > 0)
  expect(s.codex.sent("thread/unsubscribe")).toEqual([{ threadId: THREAD }])

  const unopened = setup()
  unopened.session.close()
  await Bun.sleep(20)
  expect(unopened.codex.sent("thread/unsubscribe")).toEqual([])
})

test("a turn's end closes the requests it left open", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(0, "item/commandExecution/requestApproval", { kind: "command", threadId: THREAD, turnId: TURN, itemId: "exec-1", command: "ls" })
  await until(() => s.last("permission") !== undefined)
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("interrupted") })
  await until(() => !s.session.busy)
  expect(s.last("permission")).toMatchObject({ answered: true })
})

test("warns once that an MCP server did not start, until it starts", async () => {
  const s = setup()
  await started(s)
  const status = (name: string, status: string, error: string | null = null) => s.codex.notify("mcpServer/startupStatus/updated", { threadId: THREAD, name, status, error, failureReason: null })
  const failure = "MCP client for `docs` failed to start: MCP startup failed: No such file or directory (os error 2)"
  status("docs", "starting")
  status("docs", "failed", failure)
  status("docs", "starting")
  status("docs", "failed", failure)
  status("search", "failed")
  status("docs", "ready")
  status("docs", "failed", failure)
  status("github", "ready")
  await until(() => s.items().filter((item) => item.type === "notice").length === 3)
  await Bun.sleep(20)
  const notices = s.items().filter((item) => item.type === "notice")
  expect(notices).toEqual([
    { type: "notice", id: expect.stringMatching(/^mcp-failed:/), text: `MCP server docs did not start.\n${failure}`, warning: true },
    { type: "notice", id: expect.stringMatching(/^mcp-failed:/), text: "MCP server search did not start.", warning: true },
    { type: "notice", id: expect.stringMatching(/^mcp-failed:/), text: `MCP server docs did not start.\n${failure}`, warning: true },
  ])
  expect(new Set(notices.map((notice) => notice.id)).size).toBe(3)
})

test("shows a failed turn's error before its result", async () => {
  const s = setup()
  await started(s)
  s.codex.notify("error", { threadId: THREAD, turnId: TURN, willRetry: true, error: { message: "Reconnecting... 2/5" } })
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("failed", { error: { message: "You've hit your usage limit." }, durationMs: 10 }) })
  await until(() => !s.session.busy)
  expect(s.events).toContainEqual({ kind: "retry", attempt: 2, maxRetries: 5, delayMs: 0, error: "Reconnecting... 2/5" })
  expect(s.items().slice(-2)).toEqual([
    { type: "error", id: `error:${TURN}`, message: "You've hit your usage limit." },
    { type: "result", id: expect.stringMatching(/^result:/), durationMs: 10, isError: true },
  ])
})

test("counts on from the last retry when Codex's retry gives no limit", async () => {
  const s = setup()
  await started(s)
  const error = (message: string, willRetry = true) => s.codex.notify("error", { threadId: THREAD, turnId: TURN, willRetry, error: { message } })
  error("Reconnecting... 3/5")
  error("Waiting for the network")
  error("Waiting for the network")
  error("The stream ended", false)
  await until(() => s.events.filter((event) => event.kind === "retry").length === 3)
  await Bun.sleep(20)
  expect(s.events.filter((event) => event.kind === "retry")).toEqual([
    { kind: "retry", attempt: 3, maxRetries: 5, delayMs: 0, error: "Reconnecting... 3/5" },
    { kind: "retry", attempt: 4, delayMs: 0, error: "Waiting for the network" },
    { kind: "retry", attempt: 5, delayMs: 0, error: "Waiting for the network" },
  ])
})

const MINUTE = 60_000

/** Runs `body` on fake timers. Bun.sleep waits on real time, so `flush` lets the fake app-server's messages land instead. */
async function fakeTime(body: () => Promise<void>) {
  jest.useFakeTimers()
  try {
    await body()
  } finally {
    jest.useRealTimers()
  }
}

const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

test("fails a turn that Codex has not resumed 10 minutes after a retry, and asks Codex to stop it", async () => {
  const s = setup()
  await started(s)
  await fakeTime(async () => {
    s.codex.notify("error", { threadId: THREAD, turnId: TURN, willRetry: true, error: { message: "Reconnecting... waiting for network" } })
    await flush()
    jest.advanceTimersByTime(10 * MINUTE - 1)
    expect(s.session.busy).toBe(true)
    jest.advanceTimersByTime(1)
  })
  expect(s.session.busy).toBe(false)
  expect(s.last("error")?.message).toBe("Codex did not recover from a failed request in 10 minutes, so the turn was stopped. Codex said: Reconnecting... waiting for network")
  await until(() => s.codex.sent("turn/interrupt").length > 0)
  expect(s.codex.sent("turn/interrupt")).toEqual([{ threadId: THREAD, turnId: TURN }])
})

test("a new retry starts the 10 minutes again, and any other word from Codex ends the wait", async () => {
  const s = setup()
  await started(s)
  const retry = () => s.codex.notify("error", { threadId: THREAD, turnId: TURN, willRetry: true, error: { message: "Reconnecting... 1/5" } })
  await fakeTime(async () => {
    retry()
    await flush()
    jest.advanceTimersByTime(9 * MINUTE)
    retry()
    await flush()
    jest.advanceTimersByTime(9 * MINUTE)
    expect(s.session.busy).toBe(true)
    s.codex.notify("item/agentMessage/delta", { threadId: THREAD, turnId: TURN, itemId: "m1", delta: "Back" })
    await flush()
    jest.advanceTimersByTime(60 * MINUTE)
  })
  expect(s.session.busy).toBe(true)
  expect(s.codex.sent("turn/interrupt")).toEqual([])
})

test("leaves a stalled retry to a stop the user asked for", async () => {
  const s = setup()
  await started(s)
  s.codex.answer("turn/interrupt", () => new Promise(() => {}))
  await fakeTime(async () => {
    s.codex.notify("error", { threadId: THREAD, turnId: TURN, willRetry: true, error: { message: "Reconnecting... 1/5" } })
    await flush()
    void s.session.interrupt()
    await flush()
    jest.advanceTimersByTime(10 * MINUTE)
  })
  expect(s.session.busy).toBe(true)
  expect(s.items().some((found) => found.type === "error")).toBe(false)
})

test("fails the turn when the app-server dies, and loads the thread into a new one on the next message", async () => {
  const s = setup()
  await started(s)
  s.codex.hangUp()
  await until(() => !s.session.busy)
  expect(s.last("error")).toMatchObject({ message: "The agent's process ended." })
  expect(s.events.at(-1)).toEqual({ kind: "status", busy: false })
  s.session.send("Try again")
  await until(() => s.codex.sent("turn/start").length === 2)
  expect(s.codex.launches).toBe(2)
  expect(s.codex.sent("thread/resume")).toEqual([expect.objectContaining({ threadId: THREAD })])
})

test("fails the turn when Codex refuses it", async () => {
  const s = setup()
  s.codex.answer("turn/start", () => {
    throw new Error("Model not available")
  })
  s.session.send("Hi")
  await until(() => !s.session.busy)
  expect(s.last("error")).toMatchObject({ message: "Model not available" })
})

test("asks for the reasoning summary Codex's config sets for the project, else auto", async () => {
  const configured = setup()
  configured.codex.answer("config/read", { config: { model_reasoning_summary: "concise" }, layers: null })
  configured.session.send("Hi")
  await until(() => configured.codex.sent("turn/start").length > 0)
  expect(configured.codex.sent("config/read")).toEqual([{ cwd: DIR, includeLayers: false }])
  expect(configured.codex.sent("turn/start")[0]).toMatchObject({ summary: "concise" })

  const unread = setup()
  unread.codex.answer("config/read", () => {
    throw new Error("Invalid config")
  })
  unread.session.send("Hi")
  await until(() => unread.codex.sent("turn/start").length > 0)
  expect(unread.codex.sent("turn/start")[0]).toMatchObject({ summary: "auto" })
})

/** A `hook/completed` notice for the running turn. */
const hookRun = (eventName: string, status: string, entries: readonly { kind: string; text: string }[]) => ({ threadId: THREAD, turnId: TURN, run: { eventName, status, entries } })

test("shows why a hook stopped a turn that had no answer as an error", async () => {
  const s = setup()
  await started(s)
  s.codex.notify("hook/completed", hookRun("userPromptSubmit", "completed", [{ kind: "context", text: "Read the docs." }]))
  s.codex.notify("hook/completed", { ...hookRun("userPromptSubmit", "stopped", [{ kind: "stop", text: "Prompts on main are blocked." }]), turnId: "another-turn" })
  s.codex.notify("hook/completed", hookRun("userPromptSubmit", "stopped", [{ kind: "feedback", text: "Ignored." }, { kind: "stop", text: " Prompts on main are blocked. " }]))
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => !s.session.busy)
  const ended = s.items().slice(-2)
  expect(ended[0]).toEqual({ type: "error", id: `hook-stop:${TURN}`, message: "The userPromptSubmit hook stopped the turn.\nPrompts on main are blocked." })
  expect(ended[1]).toMatchObject({ type: "result", isError: false })
})

test("shows why a hook stopped a turn that answered as a warning, so the answer stands", async () => {
  const s = setup()
  await started(s)
  s.codex.notify(...item("item/completed", { type: "agentMessage", id: "msg_1", text: "Hi!", phase: "final_answer" }))
  s.codex.notify("hook/completed", hookRun("stop", "stopped", [{ kind: "stop", text: "Stop here." }]))
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => !s.session.busy)
  expect(s.items().some((found) => found.type === "error")).toBe(false)
  expect(s.last("notice")).toEqual({ type: "notice", id: `hook-stop:${TURN}`, text: "The stop hook stopped the turn.\nStop here.", warning: true, stopsTurn: true })
})

test("a hook that stops a turn after only commentary shows as an error", async () => {
  const s = setup()
  await started(s)
  s.codex.notify(...item("item/completed", { type: "agentMessage", id: "msg_1", text: "Running tests.", phase: "commentary" }))
  s.codex.notify("hook/completed", hookRun("preToolUse", "stopped", [{ kind: "stop", text: "No tests on Fridays." }]))
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("completed") })
  await until(() => !s.session.busy)
  expect(s.last("error")).toEqual({ type: "error", id: `hook-stop:${TURN}`, message: "The preToolUse hook stopped the turn.\nNo tests on Fridays." })
})
