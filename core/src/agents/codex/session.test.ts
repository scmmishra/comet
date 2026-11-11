import { expect, test } from "bun:test"
import type { PermissionAnswer, RunSettings, ThreadEvent, ThreadItem } from "@desk/protocol"
import { until } from "../../test-support"
import type { SessionOptions } from "../agent"
import { fakeAppServer, MODELS } from "./test-app-server"
import { ModelCatalog } from "./models"
import { AppServer } from "./server"
import { CodexSession } from "./session"

const DIR = "/Users/ada/project"
const THREAD = "01a0d604-1f8d-7522-8fe1-371c6626896e"
const TURN = "01a0d604-2095-7fb0-a7e6-3f63d1949bbe"
const SETTINGS: RunSettings = { agent: "codex", model: "default", permissionMode: "default" }

const turn = (status: string, extra: object = {}) => ({ id: TURN, items: [], itemsView: "notLoaded", status, error: null, startedAt: 1790296989, completedAt: null, durationMs: null, ...extra })

function setup(options: Partial<SessionOptions> = {}) {
  const codex = fakeAppServer()
  codex.answer("model/list", { data: MODELS, nextCursor: null })
  codex.answer("thread/start", { thread: { id: THREAD }, model: "gpt-6.1-sol" })
  codex.answer("thread/resume", { thread: { id: THREAD }, model: "gpt-6.1-sol" })
  codex.answer("turn/start", { turn: turn("inProgress", { startedAt: null }) })
  codex.answer("turn/steer", { turnId: TURN })
  codex.answer("turn/interrupt", {})
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
      config: { "mcp_servers.desk": { url: tools.url, http_headers: { Authorization: "Bearer t" }, tool_timeout_sec: 3900 } },
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
      summary: "detailed",
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
  expect(s.codex.sent("turn/start")[1]).toMatchObject({ model: "gpt-6-luna", effort: "high", serviceTier: null, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } })
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

test("approves a call of Desk's own tools itself, and asks the user about another MCP server's", async () => {
  const s = setup()
  await started(s)
  const form = { type: "object", properties: { remember: { type: "boolean", default: false } } }
  s.codex.ask(0, "mcpServer/elicitation/request", { threadId: THREAD, turnId: TURN, serverName: "desk", mode: "form", _meta: null, message: "Allow desk to run list_agents?", requestedSchema: form })
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

test("refuses a request Desk does not handle", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(0, "mcpServer/elicitation/request", { threadId: THREAD, serverName: "github", mode: "url", url: "https://example.com", elicitationId: "e1" })
  await until(() => s.codex.reply(0) !== undefined)
  expect(s.codex.reply(0)).toEqual({ id: 0, error: { code: -32601, message: "Desk does not handle that request." } })
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

test("a turn's end closes the requests it left open", async () => {
  const s = setup()
  await started(s)
  s.codex.ask(0, "item/commandExecution/requestApproval", { kind: "command", threadId: THREAD, turnId: TURN, itemId: "exec-1", command: "ls" })
  await until(() => s.last("permission") !== undefined)
  s.codex.notify("turn/completed", { threadId: THREAD, turn: turn("interrupted") })
  await until(() => !s.session.busy)
  expect(s.last("permission")).toMatchObject({ answered: true })
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
