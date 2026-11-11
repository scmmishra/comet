import { expect, test } from "bun:test"
import type { RunSettings, ThreadEvent, ThreadItem } from "@desk/protocol"
import { tempFolder, until } from "../../test-support"
import type { SessionOptions } from "../agent"
import { fakeAcpAgent } from "./fake-agent"
import type { AcpFlavor } from "./flavor"
import type { ConfigOption } from "./protocol"
import { AcpSession } from "./session"
import { acpThreads } from "./thread-record"
import { acpToolReader } from "./tools"

const SETTINGS: RunSettings = { agent: "antigravity", model: "claude-sonnet", effort: "low", permissionMode: "bypassPermissions" }
const TOOLS = { name: "desk", url: "http://127.0.0.1:9/mcp", authorization: "Bearer t", instructions: "Hand work to other agents." }

/** A session on a fake agent, with what it emitted, the session ids it reported and what its flavor heard. */
function start(options: Partial<SessionOptions> = {}, handlers: Parameters<typeof fakeAcpAgent>[0] = {}) {
  const agents = [fakeAcpAgent(handlers)]
  const events: ThreadEvent[] = []
  const ids: string[] = []
  const learned: (readonly ConfigOption[])[] = []
  const folder = tempFolder("acp-session")
  let signedOut = 0
  const flavor: AcpFlavor = {
    // Each start takes the newest fake, so a test can replace one that died.
    launch: () => agents.at(-1)!.process,
    clientInfo: { name: "zed", version: "0.0.0" },
    authMethod: "oauth-personal",
    modeId: (mode) => (mode === "bypassPermissions" ? "yolo" : "default"),
    tools: acpToolReader,
    isQuestion: (request) => request.toolCall.toolCallId.startsWith("interaction_"),
    needsSignIn: (line) => line.startsWith("Open the following link"),
    signInProblem: "Sign in, then send again.",
    signedOut: () => void signedOut++,
    learn: (found) => void learned.push(found),
    threadsFolder: () => folder,
  }
  const session = new AcpSession("/repo", (event) => void events.push(event), { settings: SETTINGS, onSessionId: (id) => void ids.push(id), ...options }, flavor)
  const items = () => events.flatMap((event) => (event.kind === "item" ? [event.item] : []))
  const last = <T extends ThreadItem["type"]>(type: T) => items().findLast((item): item is Extract<ThreadItem, { type: T }> => item.type === type)
  return { session, agents, agent: () => agents.at(-1)!, events, items, last, ids, learned, folder, signedOut: () => signedOut }
}

test("runs a turn: starts the session in the tab's settings, sends the message and streams the reply", async () => {
  const run = start({ tools: TOOLS })
  const image = { mediaType: "image/png" as const, data: "aGk=" }
  run.session.send("Fix the build", [image])
  expect(run.session.busy).toBe(true)
  await until(() => run.agent().sent("session/prompt").length === 1)
  const agent = run.agent()

  expect(agent.written.map((message) => message.method)).toEqual(["initialize", "authenticate", "session/new", "session/set_mode", "session/set_config_option", "session/set_config_option", "session/prompt"])
  expect(agent.sent("session/new")[0]).toEqual({ cwd: "/repo", mcpServers: [{ type: "http", name: "desk", url: TOOLS.url, headers: [{ name: "Authorization", value: "Bearer t" }] }] })
  expect(agent.sent("session/set_mode")[0]).toEqual({ sessionId: "s1", modeId: "yolo" })
  expect(agent.sent("session/set_config_option")).toEqual([
    { sessionId: "s1", configId: "model", value: "claude-sonnet" },
    { sessionId: "s1", configId: "thinking", value: "low" },
  ])
  expect(agent.sent("session/prompt")[0]).toEqual({
    sessionId: "s1",
    prompt: [
      { type: "text", text: "<desk_instructions>\nHand work to other agents.\n</desk_instructions>\n\n<user_request>\nFix the build\n</user_request>" },
      { type: "image", data: "aGk=", mimeType: "image/png" },
    ],
  })
  expect(run.ids).toEqual(["s1"])
  expect(run.events).toContainEqual({ kind: "init", model: "Claude Sonnet" })
  expect(run.learned.length).toBe(3)

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
  expect((await acpThreads(() => run.folder).history("/repo", "s1")).map((item) => item.type)).toEqual(["user", "text", "result"])

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
  expect(await acpThreads(() => run.folder).list("/repo")).toEqual([])
})

test("changes the mode and model of a running session, and leaves the agent's default model alone", async () => {
  const run = start({ settings: { ...SETTINGS, model: "default", effort: undefined, permissionMode: "default" } })
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  expect(run.agent().sent("session/set_mode")).toEqual([])
  expect(run.agent().sent("session/set_config_option")).toEqual([])
  await run.session.configure({ ...SETTINGS, effort: "high" })
  expect(run.agent().sent("session/set_mode")).toEqual([{ sessionId: "s1", modeId: "yolo" }])
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

  const asked = run.agent().request("session/request_permission", { sessionId: "s1", toolCall: { toolCallId: "interaction_1", title: "Which one?" }, options: options.slice(0, 2) })
  await until(() => !!run.last("question"))
  run.session.answerQuestion("interaction_1", { "Which one?": "Always" })
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
  expect(run.last("error")?.message).toBe("Sign in, then send again.")
  expect(run.signedOut()).toBe(1)
})

test("fails the turn when the agent prints a sign-in link instead of answering", async () => {
  const run = start({}, { authenticate: () => new Promise(() => {}) })
  run.session.send("Hello")
  await until(() => run.agent().sent("authenticate").length === 1)
  run.agent().print("Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/v2/auth")
  await until(() => !run.session.busy)
  expect(run.last("error")?.message).toBe("Sign in, then send again.")
  expect(run.signedOut()).toBe(1)
})

test("fails a turn whose process dies with the end of its stderr, and resumes the session on the next message", async () => {
  const run = start()
  run.session.send("Hello")
  await until(() => run.agent().sent("session/prompt").length === 1)
  run.agent().die("Traceback: out of memory")
  await until(() => !run.session.busy)
  expect(run.last("error")?.message).toBe("The agent's process ended.\n\nTraceback: out of memory")

  run.agents.push(fakeAcpAgent())
  run.session.send("Again")
  await until(() => run.agent().sent("session/prompt").length === 1)
  expect(run.agent().sent("session/new")).toEqual([])
  expect(run.agent().sent("session/resume")[0]).toMatchObject({ sessionId: "s1", cwd: "/repo" })
})
