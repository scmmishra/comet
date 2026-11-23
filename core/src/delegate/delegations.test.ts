import { expect, test } from "bun:test"
import type { AgentId, AgentInfo, PermissionMode, Subagent, ThreadEvent } from "@comet/protocol"
import type { AgentHost } from "../agents/agent"
import { Agents } from "../agents/registry"
import { fakeAgent } from "../test-support"
import { Delegations, narrowed } from "./delegations"

const MODES: PermissionMode[] = ["default", "acceptEdits", "auto", "bypassPermissions"]

/** A fake agent that reports itself as `reading` says, on top of one model that takes every mode and two effort levels. */
function agentThat(id: AgentId, reading: Partial<AgentInfo> = {}) {
  const fake = fakeAgent(id)
  const make = (host: AgentHost) => ({
    ...fake.make(host),
    inspect: async () => host.publish({ state: "ready", models: [{ value: "default", label: "Default", runs: "GPT-6 Astra", description: "", efforts: ["low", "high"], defaultEffort: "low", fast: false, permissionModes: MODES }], ...reading }),
  })
  return { ...fake, make }
}

/** Delegations for one session, whose thread runs Claude in `mode`, with Codex and Claude to hand work to. */
async function delegations(mode: PermissionMode = "acceptEdits", codexReading: Partial<AgentInfo> = {}) {
  const codex = agentThat("codex", codexReading)
  const claude = agentThat("claude")
  const agents = new Agents(() => {}, { compactIdle: () => false }, { claude: claude.make, codex: codex.make })
  agents.send(() => {})
  await Bun.sleep(0)
  const events: ThreadEvent[] = []
  const service = new Delegations(agents)
  const host = { project: "/work/app", settings: () => ({ agent: "claude" as const, model: "default", permissionMode: mode }), emit: (event: ThreadEvent) => void events.push(event) }
  const handoffs = service.open(host)
  const tools = handoffs.tools
  const subagents = () => events.flatMap((event) => (event.kind === "subagent" ? [event.subagent] : []))
  const call = (input: Record<string, unknown>, signal = new AbortController().signal) => tools.call("delegate", input, signal)
  return { service, host, handoffs, tools, codex, claude, events, call, last: (): Subagent => subagents().at(-1)! }
}

test("offers the tools that hand a task off, and tells the agent when to use them", async () => {
  const { tools } = await delegations()
  expect(tools.tools.map((tool) => tool.name)).toEqual(["list_agents", "delegate"])
  expect(tools.instructions).toContain("Call `list_agents` once before the first `delegate`")
})

test("lists the agents with their models, and why one is not ready", async () => {
  const { tools } = await delegations("default", { state: "signed-out", problem: "Sign in to use your ChatGPT plan." })
  const listed = JSON.parse((await tools.call("list_agents", {}, new AbortController().signal)).text)
  expect(listed).toEqual({
    agents: [
      { agent: "claude", name: "Fake claude", ready: true, models: [{ model: "default", name: "GPT-6 Astra", efforts: ["low", "high"], defaultEffort: "low" }] },
      { agent: "codex", name: "Fake codex", ready: false, problem: "Sign in to use your ChatGPT plan." },
    ],
  })
})

test("runs a task on the agent it names, in the caller's folder, and answers with the agent's final message", async () => {
  const { codex, call, last } = await delegations()
  const answer = call({ agent: "codex", task: "Review the login form.\nReport the bugs.", effort: "high", title: "Review login" })
  const [session] = codex.sessions
  expect(codex.calls).toEqual(["send Review the login form.\nReport the bugs."])
  expect(session).toMatchObject({ dir: "/work/app", options: { ephemeral: true, settings: { agent: "codex", model: "default", effort: "high", permissionMode: "acceptEdits" } } })
  expect(session!.options.tools).toBeUndefined()
  expect(last()).toMatchObject({ description: "Review login", agent: "codex", model: "GPT-6 Astra", status: "running", prompt: "Review the login form.\nReport the bugs.", items: [] })

  session!.emit({ kind: "item", item: { type: "tool", id: "t1", name: "Bash", summary: "ls", kind: "command", label: "Ran ls" } })
  session!.emit({ kind: "item", item: { type: "text", id: "x1", text: "Two bugs.\nBoth in validate().", done: true } })
  expect(last()).toMatchObject({ status: "running", toolUses: 1 })
  expect(last().items.map((item) => item.id)).toEqual(["t1", "x1"])
  session!.finish()
  expect(await answer).toEqual({ text: "Two bugs.\nBoth in validate().", isError: false })
  expect(last()).toMatchObject({ status: "completed", summary: "Two bugs." })
  expect(codex.calls.at(-1)).toBe("close")
})

test("a task that answered before a hook stopped its turn passes on the hook's reason with the answer", async () => {
  const { codex, call, last } = await delegations()
  const answer = call({ agent: "codex", task: "Fix the bug." })
  const [session] = codex.sessions
  // An earlier turn's stop reason, before the last answer, is stale. So is a notice that stopped nothing.
  session!.emit({ kind: "item", item: { type: "notice", id: "hook-stop:t0", text: "Old reason.", warning: true, stopsTurn: true } })
  session!.emit({ kind: "item", item: { type: "text", id: "x1", text: "Fixed the bug.", done: true } })
  session!.emit({ kind: "item", item: { type: "notice", id: "mcp-failed:1", text: "MCP server github did not start.", warning: true } })
  session!.emit({ kind: "item", item: { type: "notice", id: "hook-stop:t1", text: "Run the tests before you finish.", warning: true, stopsTurn: true } })
  session!.finish()
  expect(await answer).toEqual({ text: "Fixed the bug.\n\nIts turn was stopped after this answer:\n\nRun the tests before you finish.", isError: false })
  expect(last()).toMatchObject({ status: "completed", summary: "Fixed the bug." })
})

test("a task handed to Claude passes on the reason of a hook that stopped its turn after it answered", async () => {
  const { claude, call } = await delegations()
  const answer = call({ agent: "claude", task: "Fix the bug." })
  const [session] = claude.sessions
  // Claude Code reports the reply, then the hook's notice, then the turn's result.
  session!.emit({ kind: "item", item: { type: "text", id: "a1", text: "Fixed the bug.", done: true } })
  session!.emit({ kind: "item", item: { type: "notice", id: "n1", text: "Stop says: run the tests first", warning: true, stopsTurn: true } })
  session!.finish()
  expect(await answer).toEqual({ text: "Fixed the bug.\n\nIts turn was stopped after this answer:\n\nStop says: run the tests first", isError: false })
})

test("a task never runs with more than the thread that started it", async () => {
  expect(narrowed("acceptEdits", MODES)).toBe("acceptEdits")
  expect(narrowed("bypassPermissions", ["default", "acceptEdits"])).toBe("acceptEdits")
  expect(narrowed("auto", ["default", "bypassPermissions"])).toBe("default")
  expect(narrowed("default", ["acceptEdits", "bypassPermissions"])).toBe("default")
  const { codex, call } = await delegations("default")
  void call({ agent: "codex", task: "Fix it." })
  expect(codex.sessions[0]!.options.settings.permissionMode).toBe("default")
})

test("refuses a task it cannot run, in words the asking agent can pass on", async () => {
  const { call, codex } = await delegations()
  const refusal = (input: Record<string, unknown>) => call(input).then(() => "ran", (error: Error) => error.message)
  expect(await refusal({ agent: "cursor", task: "x" })).toBe('Comet runs no agent called "cursor". Call list_agents to see the agents it runs.')
  expect(await refusal({ agent: "codex", task: " " })).toBe("`task` says what the agent should do. It cannot be empty.")
  expect(await refusal({ agent: "codex", task: "x", model: "gpt-9" })).toBe('Fake codex has no model called "gpt-9". Its models are: default.')
  expect(await refusal({ agent: "codex", task: "x", effort: "max" })).toBe('Fake codex\'s Default has no effort level "max". Its levels are: low, high.')
  expect(codex.sessions).toEqual([])
  const signedOut = await delegations("default", { state: "signed-out", problem: "Sign in to use your ChatGPT plan." })
  expect(await signedOut.call({ agent: "codex", task: "x" }).catch((error: Error) => error.message)).toBe("Fake codex is not ready: Sign in to use your ChatGPT plan. The user can set it up in Comet's Settings, under Providers.")
})

test("names a model by its value or the name it runs under", async () => {
  const { codex, call } = await delegations()
  void call({ agent: "codex", task: "x", model: "GPT-6 Astra" })
  expect(codex.sessions[0]!.options.settings.model).toBe("default")
})

test("shows a task's permission request in the thread and sends the answer back to the task", async () => {
  const { handoffs, codex, call, events } = await delegations()
  void call({ agent: "codex", task: "Fix it." })
  const request = { type: "permission" as const, id: "permission:r1", requestId: "r1", tool: "Bash", kind: "command" as const, detail: "rm -rf dist", allowSession: true }
  codex.sessions[0]!.emit({ kind: "item", item: request })
  expect(events).toContainEqual({ kind: "item", item: request })
  expect(handoffs.pending()).toEqual([request])
  expect(handoffs.answerPermission("other", "allow")).toBe(false)
  expect(handoffs.answerPermission("r1", "allow")).toBe(true)
  expect(codex.calls).toContain("permission r1 allow")
  codex.sessions[0]!.emit({ kind: "item", item: { ...request, answered: true } })
  expect(handoffs.pending()).toEqual([])
  expect(handoffs.answerPermission("r1", "allow")).toBe(false)
})

test("a stopped thread stops its tasks, and a task that was stopped or failed says so", async () => {
  const { handoffs, codex, call, last } = await delegations()
  const stopped = call({ agent: "codex", task: "Long task." })
  handoffs.stop()
  expect(await stopped).toEqual({ text: "The task was stopped before it finished.", isError: true })
  expect(last().status).toBe("stopped")

  const failed = call({ agent: "codex", task: "Bad task." })
  codex.sessions[1]!.emit({ kind: "item", item: { type: "error", id: "e1", message: "Rate limited" } })
  codex.sessions[1]!.emit({ kind: "status", busy: false })
  expect(await failed).toEqual({ text: "The task failed: Rate limited", isError: true })
  expect(last().status).toBe("failed")

  const reported = call({ agent: "codex", task: "Review it." })
  codex.sessions[2]!.emit({ kind: "item", item: { type: "text", id: "t1", text: "No blocking issues.", done: true } })
  codex.sessions[2]!.emit({ kind: "item", item: { type: "error", id: "e2", message: "Connection lost" } })
  codex.sessions[2]!.emit({ kind: "status", busy: false })
  expect(await reported).toEqual({ text: "The task failed: Connection lost\n\nIts last report before it failed:\n\nNo blocking issues.", isError: true })
})

test("the asking agent giving up on the call stops the task", async () => {
  const { codex, call } = await delegations()
  const abort = new AbortController()
  const answer = call({ agent: "codex", task: "Long task." }, abort.signal)
  abort.abort()
  expect((await answer).isError).toBe(true)
  expect(codex.calls).toContain("interrupt")
})

test("a closed session ends its tasks", async () => {
  const { handoffs, codex, call } = await delegations()
  void call({ agent: "codex", task: "Long task." })
  handoffs.close()
  expect(codex.calls.at(-1)).toBe("close")
})

const subagentOf = (status: Subagent["status"]): ThreadEvent => ({ kind: "subagent", subagent: { id: "a1", description: "Explore", status, background: true, startedAt: 0, toolUses: 0, items: [] } })

/** Whether a promise has settled yet. */
const settled = async (promise: Promise<unknown>) => Promise.race([promise.then(() => true), Bun.sleep(0).then(() => false)])

test("a task waits for its background subagent, and answers with the turn Claude Code starts once it ends", async () => {
  const { codex, call, last } = await delegations()
  const answer = call({ agent: "codex", task: "Explore it." })
  const session = codex.sessions[0]!
  session.emit(subagentOf("running"))
  session.emit({ kind: "item", item: { type: "text", id: "x1", text: "The sub-agent is still running.", done: true } })
  session.finish()
  expect(await settled(answer)).toBe(false)
  expect(last().status).toBe("running")

  // The subagent ends before Claude Code starts its own turn. The task waits for that turn.
  session.emit(subagentOf("completed"))
  expect(await settled(answer)).toBe(false)
  session.emit({ kind: "status", busy: true })
  session.emit({ kind: "item", item: { type: "text", id: "x2", text: "Found three callers.", done: true } })
  session.finish()
  expect(await answer).toEqual({ text: "Found three callers.", isError: false })
  expect(codex.calls.at(-1)).toBe("close")
})

test("a later turn that ends without text keeps the task's earlier answer", async () => {
  const { codex, call } = await delegations()
  const answer = call({ agent: "codex", task: "Explore it." })
  const session = codex.sessions[0]!
  session.emit(subagentOf("running"))
  session.emit({ kind: "item", item: { type: "text", id: "x1", text: "Tests pass.", done: true } })
  session.finish()
  session.emit({ kind: "status", busy: true })
  session.emit(subagentOf("completed"))
  session.emit({ kind: "item", item: { type: "tool", id: "t1", name: "Bash", summary: "true", kind: "command", label: "Ran true" } })
  session.finish()
  expect(await answer).toEqual({ text: "Tests pass.", isError: false })
})

test("a task that leaves a command running in the background, such as a dev server, answers at once", async () => {
  const { codex, call } = await delegations()
  const answer = call({ agent: "codex", task: "Start the dev server." })
  const session = codex.sessions[0]!
  session.emit({ kind: "background", tasks: [{ id: "b1", label: "bun run dev", startedAt: 0 }] })
  session.emit({ kind: "item", item: { type: "text", id: "x1", text: "The dev server runs on port 3000.", done: true } })
  session.finish()
  expect(await answer).toEqual({ text: "The dev server runs on port 3000.", isError: false })
})

test("a task whose subagent runs ends at once when it fails, even between turns", async () => {
  const { codex, call } = await delegations()
  const inTurn = call({ agent: "codex", task: "Explore it." })
  codex.sessions[0]!.emit(subagentOf("running"))
  codex.sessions[0]!.emit({ kind: "item", item: { type: "error", id: "e1", message: "Claude Code exited before it finished the turn." } })
  codex.sessions[0]!.emit({ kind: "status", busy: false })
  expect(await inTurn).toEqual({ text: "The task failed: Claude Code exited before it finished the turn.", isError: true })

  // Claude Code's process exits while no turn runs, so no turn ends. The error ends the task.
  const between = call({ agent: "codex", task: "Explore it." })
  const session = codex.sessions[1]!
  session.emit(subagentOf("running"))
  session.emit({ kind: "item", item: { type: "text", id: "x1", text: "The sub-agent is still running.", done: true } })
  session.finish()
  session.emit({ kind: "item", item: { type: "error", id: "e2", message: "Claude Code exited before its subagents finished." } })
  expect(await between).toEqual({ text: "The task failed: Claude Code exited before its subagents finished.\n\nIts last report before it failed:\n\nThe sub-agent is still running.", isError: true })
})

test("a task stopped in its turn waits for that turn to end, whatever its subagents do", async () => {
  const { handoffs, codex, call } = await delegations()
  const answer = call({ agent: "codex", task: "Explore it." })
  codex.sessions[0]!.emit(subagentOf("running"))
  handoffs.stop()
  expect(await answer).toEqual({ text: "The task was stopped before it finished.", isError: true })
})

test("the asking agent giving up on a task that waits for its subagent stops it, and keeps what it said", async () => {
  const { codex, call, last } = await delegations()
  const abort = new AbortController()
  const answer = call({ agent: "codex", task: "Explore it." }, abort.signal)
  const session = codex.sessions[0]!
  session.emit(subagentOf("running"))
  session.emit({ kind: "item", item: { type: "text", id: "x1", text: "The sub-agent is still running.", done: true } })
  session.finish()
  expect(await settled(answer)).toBe(false)
  abort.abort()
  expect(await answer).toEqual({ text: "The task was stopped before it finished.\n\nIts last report before it was stopped:\n\nThe sub-agent is still running.", isError: true })
  expect(last().status).toBe("stopped")
  // No turn runs, so there is none to interrupt. Closing the session ends the subagent.
  expect(codex.calls.slice(-1)).toEqual(["close"])
})
