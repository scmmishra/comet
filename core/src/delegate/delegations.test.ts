import { expect, test } from "bun:test"
import type { AgentId, AgentInfo, PermissionMode, Subagent, ThreadEvent } from "@desk/protocol"
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

/** Delegations for one tab, "a", whose thread runs Claude in `mode`, with Codex to hand work to. */
async function delegations(mode: PermissionMode = "acceptEdits", codexReading: Partial<AgentInfo> = {}) {
  const codex = agentThat("codex", codexReading)
  const agents = new Agents(() => {}, { compactIdle: () => false }, { claude: agentThat("claude").make, codex: codex.make })
  agents.send(() => {})
  await Bun.sleep(0)
  const events: ThreadEvent[] = []
  const service = new Delegations(
    agents,
    { tab: (tabId) => (tabId === "a" ? { project: "/work/app", settings: { agent: "claude", model: "default", permissionMode: mode } } : undefined), emit: (_tabId, event) => void events.push(event) },
    () => "http://127.0.0.1:4000/mcp",
  )
  const server = service.server("a")
  const tools = service.toolsFor(server.authorization)!
  const subagents = () => events.flatMap((event) => (event.kind === "subagent" ? [event.subagent] : []))
  const call = (input: Record<string, unknown>, signal = new AbortController().signal) => tools.call("delegate", input, signal)
  return { service, server, tools, codex, events, call, last: (): Subagent => subagents().at(-1)! }
}

test("gives each tab a server under its own token, and knows no other caller", async () => {
  const { service, server } = await delegations()
  expect(server).toMatchObject({ url: "http://127.0.0.1:4000/mcp" })
  expect(server.authorization).toMatch(/^Bearer .{40,}$/)
  expect(service.server("a").authorization).toBe(server.authorization)
  expect(service.server("b").authorization).not.toBe(server.authorization)
  expect(service.toolsFor("Bearer nope")).toBeUndefined()
  expect(service.toolsFor(server.authorization)!.tools.map((tool) => tool.name)).toEqual(["list_agents", "delegate"])
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

test("runs a task on the agent it names, in the tab's folder, and answers with the agent's final message", async () => {
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
  expect(await refusal({ agent: "cursor", task: "x" })).toBe('Desk runs no agent called "cursor". Call list_agents to see the agents it runs.')
  expect(await refusal({ agent: "codex", task: " " })).toBe("`task` says what the agent should do. It cannot be empty.")
  expect(await refusal({ agent: "codex", task: "x", model: "gpt-9" })).toBe('Fake codex has no model called "gpt-9". Its models are: default.')
  expect(await refusal({ agent: "codex", task: "x", effort: "max" })).toBe('Fake codex\'s Default has no effort level "max". Its levels are: low, high.')
  expect(codex.sessions).toEqual([])
  const signedOut = await delegations("default", { state: "signed-out", problem: "Sign in to use your ChatGPT plan." })
  expect(await signedOut.call({ agent: "codex", task: "x" }).catch((error: Error) => error.message)).toBe("Fake codex is not ready: Sign in to use your ChatGPT plan.. The user can set it up in Desk's Settings, under Providers.")
})

test("names a model by its value or the name it runs under", async () => {
  const { codex, call } = await delegations()
  void call({ agent: "codex", task: "x", model: "GPT-6 Astra" })
  expect(codex.sessions[0]!.options.settings.model).toBe("default")
})

test("shows a task's permission request in the thread and sends the answer back to the task", async () => {
  const { service, codex, call, events } = await delegations()
  void call({ agent: "codex", task: "Fix it." })
  const request = { type: "permission" as const, id: "permission:r1", requestId: "r1", tool: "Bash", kind: "command" as const, detail: "rm -rf dist", allowSession: true }
  codex.sessions[0]!.emit({ kind: "item", item: request })
  expect(events).toContainEqual({ kind: "item", item: request })
  expect(service.answerPermission("a", "other", "allow")).toBe(false)
  expect(service.answerPermission("a", "r1", "allow")).toBe(true)
  expect(codex.calls).toContain("permission r1 allow")
  codex.sessions[0]!.emit({ kind: "item", item: { ...request, answered: true } })
  expect(service.answerPermission("a", "r1", "allow")).toBe(false)
})

test("a stopped thread stops its tasks, and a task that was stopped or failed says so", async () => {
  const { service, codex, call, last } = await delegations()
  const stopped = call({ agent: "codex", task: "Long task." })
  service.stop("a")
  expect(await stopped).toEqual({ text: "The task was stopped before it finished.", isError: true })
  expect(last().status).toBe("stopped")

  const failed = call({ agent: "codex", task: "Bad task." })
  codex.sessions[1]!.emit({ kind: "item", item: { type: "error", id: "e1", message: "Rate limited" } })
  codex.sessions[1]!.emit({ kind: "status", busy: false })
  expect(await failed).toEqual({ text: "The task failed: Rate limited", isError: true })
  expect(last().status).toBe("failed")
})

test("the asking agent giving up on the call stops the task", async () => {
  const { codex, call } = await delegations()
  const abort = new AbortController()
  const answer = call({ agent: "codex", task: "Long task." }, abort.signal)
  abort.abort()
  expect((await answer).isError).toBe(true)
  expect(codex.calls).toContain("interrupt")
})

test("a closed session ends its tasks and loses its token", async () => {
  const { service, server, codex, call } = await delegations()
  void call({ agent: "codex", task: "Long task." })
  service.drop("a")
  expect(codex.calls.at(-1)).toBe("close")
  expect(service.toolsFor(server.authorization)).toBeUndefined()
})
