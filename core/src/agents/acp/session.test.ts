import { expect, jest, test } from "bun:test"
import type { RunSettings, ThreadEvent, ThreadItem } from "@comet/protocol"
import { tempFolder, until } from "../../test-support"
import type { SessionOptions } from "../agent"
import { unfinishedResult } from "../steps"
import { FAKE_OPTIONS, fakeAcpAgent } from "./test-agent"
import { START_TIMEOUT_MS } from "./connection"
import { HOLD_LIMIT_MS, REPLY_LIMIT_MS, SETTLE_MS } from "./after-prompt"
import type { AcpFlavor, BackgroundWork, PromptCheck } from "./flavor"
import type { ConfigOption, SessionUpdate } from "./protocol"
import { AcpSession } from "./session"
import { AcpThreadStore } from "./thread-record"
import { acpToolReader } from "./tools"

const SETTINGS: RunSettings = { agent: "antigravity", model: "claude-sonnet", effort: "low", permissionMode: "bypassPermissions" }
const TOOLS = { url: "http://127.0.0.1:9/mcp", authorization: "Bearer t", instructions: "Hand work to other agents." }
const SIGN_IN_LINE = "SIGN IN https://example.com/sign-in"
const SIGN_IN_TO_SEND = "Sign in, then send again."

/** A session on a fake agent, with what it emitted, the session ids it reported and what its flavor heard. */
function start(options: Partial<SessionOptions> = {}, handlers: Parameters<typeof fakeAcpAgent>[0] = {}, check?: PromptCheck, background?: BackgroundWork) {
  const agents = [fakeAcpAgent(handlers)]
  const events: ThreadEvent[] = []
  const ids: string[] = []
  const learned: { readonly options: readonly ConfigOption[]; readonly opened: boolean }[] = []
  const folder = tempFolder("acp-session")
  const threads = new AcpThreadStore(() => folder)
  let signedOut = 0
  const flavor: AcpFlavor = {
    // Each start takes the newest fake, so a test can replace one that died.
    launch: () => agents.at(-1)!.process,
    connect: { clientInfo: { name: "fake-client", version: "1.0.0" }, authMethod: "fake-auth" },
    modeId: (mode) => (mode === "bypassPermissions" ? "never-ask" : "default"),
    tools: acpToolReader,
    isQuestion: (request) => request.toolCall.toolCallId.startsWith("question_"),
    needsSignIn: (line) => line.startsWith("SIGN IN "),
    signedOut: () => {
      signedOut++
      return SIGN_IN_TO_SEND
    },
    learn: (found, opened) => void learned.push({ options: found, opened }),
    ...(check ? { watchPrompt: () => check } : {}),
    ...(background ? { background } : {}),
  }
  const session = new AcpSession("/repo", (event) => void events.push(event), { settings: SETTINGS, onSessionId: (id) => void ids.push(id), ...options }, flavor, threads)
  const items = () => events.flatMap((event) => (event.kind === "item" ? [event.item] : []))
  const last = <T extends ThreadItem["type"]>(type: T) => items().findLast((item): item is Extract<ThreadItem, { type: T }> => item.type === type)
  return { session, agents, agent: () => agents.at(-1)!, events, items, last, ids, learned, threads, signedOut: () => signedOut }
}

test("runs a turn: starts the session in the tab's settings, sends the message and streams the reply", async () => {
  const run = start({ tools: TOOLS })
  const image = { mediaType: "image/png" as const, data: "aGk=" }
  run.session.send("Fix the build", [image])
  expect(run.session.busy).toBe(true)
  await until(() => run.agent().sent("session/prompt").length === 1)
  const agent = run.agent()

  expect(agent.written.map((message) => message.method)).toEqual(["initialize", "authenticate", "session/new", "session/set_mode", "session/set_config_option", "session/set_config_option", "session/prompt"])
  expect(agent.sent("session/new")[0]).toEqual({ cwd: "/repo", mcpServers: [{ type: "http", name: "comet", url: TOOLS.url, headers: [{ name: "Authorization", value: "Bearer t" }] }] })
  expect(agent.sent("session/set_mode")[0]).toEqual({ sessionId: "s1", modeId: "never-ask" })
  expect(agent.sent("session/set_config_option")).toEqual([
    { sessionId: "s1", configId: "model", value: "claude-sonnet" },
    { sessionId: "s1", configId: "thinking", value: "low" },
  ])
  expect(agent.sent("session/prompt")[0]).toEqual({
    sessionId: "s1",
    prompt: [
      { type: "text", text: "<comet_instructions>\nHand work to other agents.\n</comet_instructions>\n\n<user_request>\nFix the build\n</user_request>" },
      { type: "image", data: "aGk=", mimeType: "image/png" },
    ],
  })
  expect(run.ids).toEqual(["s1"])
  expect(run.events).toContainEqual({ kind: "init", model: "Claude Sonnet" })
  // The flavor learns the new session's settings as the account's default, then each change Comet made.
  expect(run.learned[0]).toEqual({ options: FAKE_OPTIONS, opened: true })
  expect(run.learned.at(-1)?.opened).toBe(false)
  expect(run.learned.at(-1)?.options.map((option) => option.currentValue)).toEqual(["claude-sonnet", "low"])

  agent.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } })
  agent.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "." } })
  await until(() => run.events.some((event) => event.kind === "text.delta"))
  agent.endTurn()
  await until(() => !run.session.busy)

  const user = run.items()[0]!
  expect(user).toMatchObject({ type: "user", text: "Fix the build", images: [image] })
  expect(run.last("text")).toMatchObject({ text: "Done.", done: true })
  expect(run.last("result")).toMatchObject({ id: `result:${user.id}`, isError: false })
  expect(run.last("result")?.stopped).toBeUndefined()
  expect(run.events.at(-1)).toEqual({ kind: "status", busy: false })
  expect((await run.threads.history("/repo", "s1")).map((item) => item.type)).toEqual(["user", "text", "result"])

  // The instructions go only with the session's first message.
  run.session.send("Again")
  await until(() => agent.sent("session/prompt").length === 2)
  expect(agent.sent("session/prompt")[1].prompt).toEqual([{ type: "text", text: "Again" }])
  expect(agent.sent("initialize").length).toBe(1)
})

test("leaves no saved thread for an ephemeral session", async () => {
  const run = start({ ephemeral: true })
  run.session.send("Review this")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().endTurn()
  await until(() => !run.session.busy)
  expect(run.ids).toEqual(["s1"])
  expect(await run.threads.list("/repo")).toEqual([])
})

test("changes the mode and model of a running session, and leaves the agent's default model alone", async () => {
  const run = start({ settings: { ...SETTINGS, model: "default", effort: undefined, permissionMode: "default" } })
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  expect(run.agent().sent("session/set_mode")).toEqual([])
  expect(run.agent().sent("session/set_config_option")).toEqual([])
  await run.session.configure({ ...SETTINGS, effort: "high" })
  expect(run.agent().sent("session/set_mode")).toEqual([{ sessionId: "s1", modeId: "never-ask" }])
  expect(run.agent().sent("session/set_config_option")).toEqual([{ sessionId: "s1", configId: "model", value: "claude-sonnet" }])
  await run.session.configure({ ...SETTINGS, effort: "low" })
  expect(run.agent().sent("session/set_config_option").at(-1)).toEqual({ sessionId: "s1", configId: "thinking", value: "low" })
})

test("cancels a turn and waits for its prompt to answer, then ends it as stopped", async () => {
  const run = start()
  run.session.send("Long task")
  await until(() => run.agent().sent("session/prompt").length === 1)
  await run.session.interrupt()
  expect(run.agent().sent("session/cancel")).toEqual([{ sessionId: "s1" }])
  expect(run.events.at(-1)).toMatchObject({ kind: "stopping", unresponsive: false })
  expect(run.session.busy).toBe(true)
  run.agent().endTurn("cancelled")
  await until(() => !run.session.busy)
  expect(run.last("result")).toMatchObject({ isError: false, stopped: true })
})

test("stops a turn whose agent does not answer as it starts: ends its process, and the next message starts it again", async () => {
  const run = start({}, { initialize: () => new Promise(() => {}) })
  run.session.send("Hello")
  await until(() => run.agent().sent("initialize").length === 1)
  const stuck = run.agent()
  await run.session.interrupt()
  await until(() => !run.session.busy)
  expect(run.last("result")).toMatchObject({ isError: false, stopped: true })
  expect(run.items().filter((item) => item.type === "error")).toEqual([])
  await stuck.process.exited

  run.agents.push(fakeAcpAgent())
  run.session.send("Again")
  await until(() => run.agent().sent("session/prompt").length === 1)
  expect(run.agent().sent("session/new").length).toBe(1)
})

test("fails a turn whose agent does not answer as it starts, once the bound passes", async () => {
  const run = start({}, { initialize: () => new Promise(() => {}) })
  // The bound starts as the message is sent, so the clock is fake from before it.
  jest.useFakeTimers()
  try {
    run.session.send("Hello")
    jest.advanceTimersByTime(START_TIMEOUT_MS)
  } finally {
    jest.useRealTimers()
  }
  await until(() => !run.session.busy)
  expect(run.last("error")?.message).toBe("The agent did not answer initialize in 90 seconds, so Comet stopped it. The next message starts it again.")
  await run.agent().process.exited
})

test.each([
  ["refusal", "The agent refused this request. Its next turn won't include this message or its reply."],
  ["max_tokens", "The agent stopped because its reply reached the output token limit."],
  ["max_turn_requests", "The agent stopped because it reached its request limit for this turn."],
])("tells the user why a turn that stopped on %s did not finish", async (stopReason, sentence) => {
  const run = start()
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().endTurn(stopReason)
  await until(() => !run.session.busy)
  expect(run.items().filter((item) => item.type === "error")).toMatchObject([{ message: sentence }])
  expect(run.last("result")).toMatchObject({ isError: true })
})

test.each(["end_turn", "cancelled"])("shows no reason for a turn that stopped on %s", async (stopReason) => {
  const run = start()
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().endTurn(stopReason)
  await until(() => !run.session.busy)
  expect(run.items().filter((item) => item.type === "error")).toEqual([])
  expect(run.last("result")).toMatchObject({ isError: false })
})

test("asks for permission, answers with the chosen option, and cancels open requests on close", async () => {
  const run = start()
  run.session.send("Run tests")
  await until(() => run.agent().sent("session/prompt").length === 1)
  const options = [
    { optionId: "once", name: "Allow", kind: "allow_once" },
    { optionId: "always", name: "Always", kind: "allow_always" },
    { optionId: "no", name: "Reject", kind: "reject_once" },
  ]
  const allowed = run.agent().request("session/request_permission", { sessionId: "s1", toolCall: { toolCallId: "t1", title: "Run", kind: "execute", rawInput: { command: "npm test" } }, options })
  await until(() => !!run.last("permission"))
  expect(run.last("permission")).toMatchObject({ requestId: "t1", kind: "command", detail: "npm test", allowSession: true })
  run.session.answerPermission("t1", "allow-session")
  expect(await allowed).toEqual({ outcome: { outcome: "selected", optionId: "always" } })
  expect(run.last("permission")?.answered).toBe(true)

  const asked = run.agent().request("session/request_permission", { sessionId: "s1", toolCall: { toolCallId: "question_1", title: "Which one?" }, options: options.slice(0, 2) })
  await until(() => !!run.last("question"))
  run.session.answerQuestion("question_1", { "Which one?": "Always" })
  expect(await asked).toEqual({ outcome: { outcome: "selected", optionId: "always" } })

  const open = run.agent().request("session/request_permission", { sessionId: "s1", toolCall: { toolCallId: "t2", title: "Edit", kind: "edit" }, options })
  await until(() => run.last("permission")?.requestId === "t2")
  run.session.close()
  expect(await open).toEqual({ outcome: { outcome: "cancelled" } })
})

test("fails the turn with the sign-in problem when the agent needs a sign-in, and signs the account out", async () => {
  const run = start({}, { authenticate: () => Promise.reject({ code: -32000, message: "Authentication required" }) })
  run.session.send("Hello")
  await until(() => !run.session.busy)
  expect(run.last("error")?.message).toBe(SIGN_IN_TO_SEND)
  expect(run.signedOut()).toBe(1)
})

test("fails the turn when the agent prints a sign-in link instead of answering, on stdout or stderr", async () => {
  for (const print of ["print", "printError"] as const) {
    const run = start({}, { authenticate: () => new Promise(() => {}) })
    run.session.send("Hello")
    await until(() => run.agent().sent("authenticate").length === 1)
    run.agent()[print](SIGN_IN_LINE)
    await until(() => !run.session.busy)
    expect(run.last("error")?.message).toBe(SIGN_IN_TO_SEND)
    expect(run.signedOut()).toBe(1)
  }
})

test("fails a turn whose process dies with its exit code and the end of its stderr, and resumes the session on the next message", async () => {
  const run = start()
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().die("Traceback: out of memory", 3)
  await until(() => !run.session.busy)
  expect(run.last("error")?.message).toBe("The fake agent exited with code 3.\n\nTraceback: out of memory")

  run.agents.push(fakeAcpAgent())
  run.session.send("Again")
  await until(() => run.agent().sent("session/prompt").length === 1)
  expect(run.agent().sent("session/new")).toEqual([])
  expect(run.agent().sent("session/resume")[0]).toMatchObject({ sessionId: "s1", cwd: "/repo" })
})

test("ends every open tool call as unfinished when the process dies mid-turn", async () => {
  const run = start()
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Run", kind: "execute", status: "in_progress", rawInput: { command: "npm test" } })
  run.agent().update({ sessionUpdate: "tool_call", toolCallId: "t2", title: "Read", kind: "read", status: "pending" })
  run.agent().update({ sessionUpdate: "tool_call", toolCallId: "t3", title: "Search", kind: "search", status: "completed" })
  await until(() => run.items().filter((item) => item.type === "tool").length === 3)
  run.agent().die("crashed", 1)
  await until(() => !run.session.busy)
  const tool = (id: string) => run.items().findLast((item) => item.type === "tool" && item.id === id)
  expect(tool("t1")).toMatchObject({ result: unfinishedResult("failed"), label: "Failed npm" })
  expect(tool("t2")).toMatchObject({ result: unfinishedResult("failed") })
  expect(tool("t3")).toMatchObject({ result: { output: "", isError: false } })
})

test("ends only the tool calls the agent never started when its prompt fails with an error", async () => {
  const run = start()
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Run", kind: "execute", status: "in_progress", rawInput: { command: "npm test" } })
  run.agent().update({ sessionUpdate: "tool_call", toolCallId: "t2", title: "Read", kind: "read" })
  await until(() => run.items().filter((item) => item.type === "tool").length === 2)
  run.agent().failTurn("Internal error")
  await until(() => !run.session.busy)
  const tool = (id: string) => run.items().findLast((item) => item.type === "tool" && item.id === id)
  expect(tool("t1")).not.toHaveProperty("result")
  expect(tool("t2")).toMatchObject({ result: unfinishedResult("failed") })
  expect(run.last("error")?.message).toBe("Internal error")
})

test("fails a turn the flavor's check finds failed, in place of the reply that only repeats the error", async () => {
  const run = start({}, {}, () => ({ message: "The model rejected the thread.", repeats: (text) => text.trim() === "! rejected" }))
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "\n! rejected\n" } })
  await until(() => run.items().some((item) => item.type === "text"))
  const reply = run.last("text")!
  run.agent().endTurn()
  await until(() => !run.session.busy)
  expect(run.events).toContainEqual({ kind: "items.remove", ids: [reply.id] })
  expect(run.last("error")?.message).toBe("The model rejected the thread.")
  expect(run.last("result")).toMatchObject({ isError: true })
  expect((await run.threads.history("/repo", "s1")).map((item) => item.type)).toEqual(["user", "error", "result"])
})

test("keeps a reply that says more than the error, and does not check a stopped turn", async () => {
  let checked = 0
  const run = start({}, {}, () => {
    checked++
    return { message: "Failed.", repeats: () => false }
  })
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Partly done." } })
  run.agent().endTurn()
  await until(() => !run.session.busy)
  expect(run.last("text")).toMatchObject({ text: "Partly done.", done: true })
  expect(run.last("error")?.message).toBe("Failed.")

  run.session.send("Again")
  await until(() => run.agent().sent("session/prompt").length === 2)
  await run.session.interrupt()
  run.agent().endTurn("cancelled")
  await until(() => !run.session.busy)
  expect(checked).toBe(1)
  expect(run.last("result")).toMatchObject({ isError: false, stopped: true })
})

/** An agent that runs commands past its prompt, except daemons, and ends each reply with its usage, as Antigravity does. */
const BACKGROUND: BackgroundWork = {
  outlivesPrompt: (call) => call.kind === "execute" && (call.rawInput as { IsDaemon?: boolean } | undefined)?.IsDaemon !== true,
  endsReply: (update) => update.sessionUpdate === "usage_update",
}

const command = (toolCallId: string, status: "pending" | "in_progress" | "completed" | "failed", IsDaemon = false): SessionUpdate => ({
  sessionUpdate: toolCallId.endsWith("-update") ? "tool_call_update" : "tool_call",
  toolCallId: toolCallId.replace(/-update$/, ""),
  title: "sleep 20",
  kind: "execute",
  status,
  rawInput: { command: "sleep 20 && echo DONE", IsDaemon },
})
const text = (chunk: string): SessionUpdate => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } })
const USAGE: SessionUpdate = { sessionUpdate: "usage_update", used: 10, size: 100 }

/** Runs `body` on fake timers. Bun.sleep waits on real time, so `flush` lets the fake agent's messages land instead. */
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

/** A session whose first prompt started `sleep 20` in the background. With `answer`, the prompt has answered, as Antigravity's does. */
async function heldTurn(check?: PromptCheck, answer = true) {
  const run = start({}, {}, check, BACKGROUND)
  run.session.send("Sleep, then tell me")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().update(command("t1", "in_progress"))
  run.agent().update(text("STARTED"))
  run.agent().update(USAGE)
  if (!answer) return run
  run.agent().endTurn()
  await until(() => run.items().some((item) => item.type === "text" && item.done))
  return run
}

test("holds a turn while a command it runs past its prompt still runs, and ends it after the late reply", async () => {
  const run = await heldTurn()
  expect(run.session.busy).toBe(true)
  expect(run.last("result")).toBeUndefined()
  // The reply's first marker comes before another call, as in Antigravity's own frames.
  await fakeTime(async () => {
    run.agent().update(command("t1-update", "completed"))
    await flush()
    jest.advanceTimersByTime(REPLY_LIMIT_MS - 1)
    expect(run.session.busy).toBe(true)
    run.agent().update(USAGE)
    run.agent().update(command("t2", "in_progress"))
    run.agent().update(command("t2-update", "completed"))
    await flush()
    jest.advanceTimersByTime(SETTLE_MS)
    expect(run.session.busy).toBe(true)
    run.agent().update(text("DONE"))
    run.agent().update(USAGE)
    await flush()
    jest.advanceTimersByTime(SETTLE_MS - 1)
    expect(run.session.busy).toBe(true)
    jest.advanceTimersByTime(1)
  })
  expect(run.session.busy).toBe(false)
  expect(run.items().filter((item) => item.type === "user")).toHaveLength(1)
  expect(run.items().filter((item) => item.type === "text" && item.done).map((item) => item.type === "text" && item.text)).toEqual(["STARTED", "DONE"])
  expect(run.last("result")).toMatchObject({ isError: false })
  expect(run.events.filter((event) => event.kind === "status")).toEqual([
    { kind: "status", busy: true },
    { kind: "status", busy: false },
  ])
  expect((await run.threads.history("/repo", "s1")).map((item) => item.type)).toEqual(["user", "tool", "text", "tool", "text", "result"])
})

test("ends a turn whose prompt answers while only a daemon runs", async () => {
  const run = start({}, {}, undefined, BACKGROUND)
  run.session.send("Start the server")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().update(command("t1", "in_progress", true))
  run.agent().endTurn()
  await until(() => !run.session.busy)
  expect(run.last("result")).toMatchObject({ isError: false })
})

test("checks a held turn's late reply once it ends, and fails it when the check finds an error", async () => {
  let checks = 0
  const run = await heldTurn(() => (++checks === 2 ? { message: "Quota reached." } : undefined))
  await fakeTime(async () => {
    run.agent().update(command("t1-update", "completed"))
    run.agent().update(text("Partly done."))
    run.agent().update(USAGE)
    await flush()
    jest.advanceTimersByTime(SETTLE_MS)
  })
  expect(checks).toBe(2)
  expect(run.last("error")?.message).toBe("Quota reached.")
  expect(run.last("result")).toMatchObject({ isError: true })
})

test("stops a held turn: cancels the command, and ends as stopped once the agent is quiet", async () => {
  const run = await heldTurn()
  await fakeTime(async () => {
    await run.session.interrupt()
    expect(run.agent().sent("session/cancel")).toEqual([{ sessionId: "s1" }])
    expect(run.session.busy).toBe(true)
    // The cancel ends the command.
    run.agent().update(command("t1-update", "failed"))
    await flush()
    jest.advanceTimersByTime(SETTLE_MS)
  })
  expect(run.session.busy).toBe(false)
  expect(run.last("result")).toMatchObject({ isError: false, stopped: true })

  // The agent's note on the stop lands with no turn open, and opens none.
  run.agent().update(command("t1-update", "failed"))
  await until(() => run.events.at(-1)?.kind === "item")
  expect(run.session.busy).toBe(false)
})

test("fails a held turn when the agent's process exits, and ends its open calls as unfinished", async () => {
  const run = await heldTurn()
  run.agent().die("crashed", 2)
  await until(() => !run.session.busy)
  expect(run.last("error")?.message).toBe("The fake agent exited with code 2.\n\ncrashed")
  expect(run.items().findLast((item) => item.type === "tool" && item.id === "t1")).toMatchObject({ result: unfinishedResult("failed") })
})

test("ends a held turn whose command stays quiet past the limit", async () => {
  const run = await heldTurn(undefined, false)
  await fakeTime(async () => {
    run.agent().endTurn()
    await flush()
    jest.advanceTimersByTime(HOLD_LIMIT_MS - 1)
    expect(run.session.busy).toBe(true)
    jest.advanceTimersByTime(1)
  })
  expect(run.session.busy).toBe(false)
  expect(run.last("result")).toMatchObject({ isError: false })
})

test("opens a turn the agent starts itself, and ends it once its reply ends", async () => {
  const run = start({}, {}, undefined, BACKGROUND)
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().endTurn()
  await until(() => !run.session.busy)
  const before = run.events.length

  await fakeTime(async () => {
    run.agent().update(text("A wake fired."))
    await flush()
    expect(run.session.busy).toBe(true)
    run.agent().update(USAGE)
    await flush()
    jest.advanceTimersByTime(SETTLE_MS)
  })
  const events = run.events.slice(before)
  const opener = events.find((event) => event.kind === "item" && event.item.type === "user")
  expect(opener).toMatchObject({ item: { text: "The agent started a turn on its own.", selfStarted: true } })
  const id = opener?.kind === "item" ? opener.item.id : ""
  expect(events.filter((event) => event.kind === "status")).toEqual([
    { kind: "status", busy: true },
    { kind: "status", busy: false },
  ])
  expect(run.last("text")).toMatchObject({ text: "A wake fired.", done: true })
  expect(run.last("result")).toMatchObject({ id: `result:${id}`, isError: false })
  expect((await run.threads.history("/repo", "s1")).map((item) => item.type)).toEqual(["user", "result", "user", "text", "result"])
})

test("a permission request with no turn open waits in a turn the agent starts itself", async () => {
  const run = start({}, {}, undefined, BACKGROUND)
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().endTurn()
  await until(() => !run.session.busy)

  let allowed: Promise<unknown> = Promise.resolve()
  await fakeTime(async () => {
    run.agent().update(command("t2-update", "pending"))
    allowed = run.agent().request("session/request_permission", {
      sessionId: "s1",
      toolCall: { toolCallId: "t2", title: "echo AFTER", kind: "execute", rawInput: { command: "echo AFTER" } },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    })
    await flush()
    expect(run.session.busy).toBe(true)
    // A request waits for the user however long it takes.
    jest.advanceTimersByTime(HOLD_LIMIT_MS)
    expect(run.session.busy).toBe(true)
    run.session.answerPermission("t2", "allow")
    await flush()
    run.agent().update(command("t2-update", "completed"))
    run.agent().update(text("WRITTEN"))
    run.agent().update(USAGE)
    await flush()
    jest.advanceTimersByTime(SETTLE_MS)
  })
  expect(await allowed).toEqual({ outcome: { outcome: "selected", optionId: "allow" } })
  expect(run.session.busy).toBe(false)
  expect(run.last("result")).toMatchObject({ isError: false })
})

test("leaves an agent that does not work past its prompt as it was: no turn opens by itself", async () => {
  const run = start()
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().endTurn()
  await until(() => !run.session.busy)
  run.agent().update(text("Stray"))
  await until(() => run.last("text")?.text === "Stray")
  expect(run.session.busy).toBe(false)
  expect(run.items().map((item) => item.type)).toEqual(["user", "result", "text"])
})

test("ends a reply whose end the agent never marks, once it has been quiet past the limit", async () => {
  const run = await heldTurn()
  await fakeTime(async () => {
    run.agent().update(command("t1-update", "completed"))
    run.agent().update(text("DONE"))
    await flush()
    jest.advanceTimersByTime(REPLY_LIMIT_MS - 1)
    expect(run.session.busy).toBe(true)
    jest.advanceTimersByTime(1)
  })
  expect(run.session.busy).toBe(false)
  expect(run.last("text")).toMatchObject({ text: "DONE", done: true })
})

test("checks a turn the agent starts itself, as it checks a prompt", async () => {
  let checks = 0
  const run = start({}, {}, () => (++checks === 2 ? { message: "Quota reached." } : undefined), BACKGROUND)
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().endTurn()
  await until(() => !run.session.busy)
  expect(run.last("error")).toBeUndefined()

  await fakeTime(async () => {
    run.agent().update(text("Quota reached."))
    run.agent().update(USAGE)
    await flush()
    jest.advanceTimersByTime(SETTLE_MS)
  })
  expect(checks).toBe(2)
  expect(run.last("error")?.message).toBe("Quota reached.")
  expect(run.last("result")).toMatchObject({ isError: true })
})

test("stops a turn the agent started itself, and the agent's note on the stop opens no other turn", async () => {
  const run = start({}, {}, undefined, BACKGROUND)
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().endTurn()
  await until(() => !run.session.busy)
  const before = run.events.length

  await fakeTime(async () => {
    run.agent().update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Writing a story." } })
    await flush()
    await run.session.interrupt()
    // Antigravity's answer to a cancel in its reply, as it sends it.
    run.agent().update(USAGE)
    run.agent().update(text("\n⚠ The stream was interrupted. Please continue the task you were working on.\n"))
    await flush()
    jest.advanceTimersByTime(SETTLE_MS)
  })
  const events = run.events.slice(before)
  expect(run.agent().sent("session/cancel")).toEqual([{ sessionId: "s1" }])
  expect(events.filter((event) => event.kind === "item" && event.item.type === "user")).toHaveLength(1)
  expect(events.filter((event) => event.kind === "status")).toEqual([
    { kind: "status", busy: true },
    { kind: "status", busy: false },
  ])
  expect(run.last("result")).toMatchObject({ isError: false, stopped: true })
})
