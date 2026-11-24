import { expect, test } from "bun:test"
import type { AgentInfo, ModelOption, TabInfo } from "@comet/protocol"
import type { AgentHost } from "../agents/agent"
import { Agents } from "../agents/registry"
import { fakeAgent } from "../test-support"
import { runForPlugin } from "./runs"

const TAB: TabInfo = { id: "tab-1", title: "Guide", project: "/work/app", terminals: [], agent: "codex", model: "gpt", effort: "high", permissionMode: "bypassPermissions" }

const MODELS: ModelOption[] = [
  { value: "default", label: "Default", runs: "Sonnet 5.5", description: "", efforts: ["low", "high"], fast: false, permissionModes: ["default"] },
  { value: "haiku", label: "Haiku", description: "", efforts: [], fast: false, permissionModes: ["default"] },
]

/** Agents with a fake Codex that reports itself as `reading` says, and a fake Claude that follows a schema. */
async function agents(reading: Partial<AgentInfo> = {}) {
  const codex = fakeAgent("codex")
  const claude = fakeAgent("claude", ["structured-output"])
  const makeCodex = (host: AgentHost) => ({ ...codex.make(host), inspect: async () => host.publish({ state: "ready", ...reading }) })
  const makeClaude = (host: AgentHost) => ({ ...claude.make(host), inspect: async () => host.publish({ state: "ready", models: MODELS }) })
  const found = new Agents(() => {}, { compactIdle: () => false }, { codex: makeCodex, claude: makeClaude })
  found.send(() => {})
  await Bun.sleep(0)
  return { agents: found, codex, claude }
}

test("runs the prompt on the tab's agent and model, in its folder, in a session that asks first and leaves no thread", async () => {
  const { agents: found, codex } = await agents()
  const run = runForPlugin(found, TAB, "Write a guide.")
  const [session] = codex.sessions
  expect(session).toMatchObject({ dir: "/work/app", options: { ephemeral: true, settings: { agent: "codex", model: "gpt", effort: "high", permissionMode: "default" } } })
  expect(session!.options.tools).toBeUndefined()
  expect(codex.calls).toEqual(["send Write a guide."])

  session!.emit({ kind: "item", item: { type: "text", id: "t1", text: "The guide.", done: true } })
  session!.finish()
  expect(await run.done).toBe("The guide.")
  expect(codex.calls.at(-1)).toBe("close")
})

test("declines every request, since no thread shows them", async () => {
  const { agents: found, codex } = await agents()
  runForPlugin(found, TAB, "Write a guide.")
  const [session] = codex.sessions
  session!.emit({ kind: "item", item: { type: "permission", id: "p1", requestId: "r1", tool: "Bash", kind: "command", detail: "git diff", allowSession: false } })
  session!.emit({ kind: "item", item: { type: "question", id: "q1", requestId: "r2", questions: [] } })
  expect(codex.calls).toEqual(["send Write a guide.", "permission r1 decline", "question r2"])
})

test("rejects when the run fails, ends without an answer, or is stopped", async () => {
  const { agents: found, codex } = await agents()
  const failed = runForPlugin(found, TAB, "One.")
  codex.sessions[0]!.emit({ kind: "item", item: { type: "error", id: "e1", message: "The agent exited." } })
  codex.sessions[0]!.finish()
  await expect(failed.done).rejects.toThrow("The run failed: The agent exited.")

  const silent = runForPlugin(found, TAB, "Two.")
  codex.sessions[1]!.finish()
  await expect(silent.done).rejects.toThrow("The run ended without an answer.")

  const stopped = runForPlugin(found, TAB, "Three.")
  stopped.stop()
  await expect(stopped.done).rejects.toThrow("The run was stopped before it finished.")
  expect(codex.calls).toContain("interrupt")
})

test("refuses an empty prompt, and an agent that is not ready, before it opens a session", async () => {
  const { agents: found, codex } = await agents({ state: "signed-out", problem: "Sign in to use your ChatGPT plan." })
  expect(() => runForPlugin(found, TAB, "  ")).toThrow("needs a prompt")
  expect(() => runForPlugin(found, TAB, "Write a guide.")).toThrow("Fake codex is not ready: Sign in to use your ChatGPT plan. Set it up in Settings, under Providers.")
  expect(codex.sessions).toEqual([])
})

test("runs on the agent, model and effort the plugin names, and takes none of the tab's settings", async () => {
  const { agents: found, claude } = await agents()
  runForPlugin(found, { ...TAB, fast: true }, "Write a guide.", { agent: "claude", model: "Sonnet 5.5", effort: "low" })
  expect(claude.sessions[0]!.options.settings).toEqual({ agent: "claude", model: "default", effort: "low", permissionMode: "default" })

  runForPlugin(found, { ...TAB, fast: true }, "Write a guide.", { agent: "claude" })
  expect(claude.sessions[1]!.options.settings).toEqual({ agent: "claude", model: "default", permissionMode: "default" })
})

test("refuses a model without its agent, and an agent, model or effort Comet does not have", async () => {
  const { agents: found, claude } = await agents()
  expect(() => runForPlugin(found, TAB, "Go.", { model: "haiku" })).toThrow("names a model only with its agent")
  expect(() => runForPlugin(found, TAB, "Go.", { agent: "gemini" })).toThrow('Comet runs no agent called "gemini". Its agents are: claude, codex, antigravity.')
  expect(() => runForPlugin(found, TAB, "Go.", { agent: "claude", model: "opus" })).toThrow('has no model called "opus"')
  expect(() => runForPlugin(found, TAB, "Go.", { agent: "claude", model: "haiku", effort: "high" })).toThrow('has no effort level "high"')
  expect(claude.sessions).toEqual([])
})

test("asks for a reply that follows a schema and resolves with its JSON, on an agent that can", async () => {
  const { agents: found, claude } = await agents()
  const schema = { type: "object", properties: { title: { type: "string" } } }
  const run = runForPlugin(found, TAB, "Write a guide.", { agent: "claude", schema })
  const [session] = claude.sessions
  expect(session!.options.outputSchema).toEqual(schema)
  // Claude Code gives the output through a tool of its own, with no text.
  session!.emit({ kind: "item", item: { type: "result", id: "r1", durationMs: 1, isError: false, output: { title: "Guide" } } })
  session!.emit({ kind: "status", busy: false })
  expect(await run.done).toEqual({ title: "Guide" })

  const missing = runForPlugin(found, TAB, "Write a guide.", { agent: "claude", schema })
  claude.sessions[1]!.emit({ kind: "item", item: { type: "text", id: "t1", text: "Here is the guide.", done: true } })
  claude.sessions[1]!.finish()
  await expect(missing.done).rejects.toThrow("did not follow the run's schema")
})

test("refuses a schema on an agent that cannot follow one, and a schema that is not an object", async () => {
  const { agents: found, codex } = await agents()
  expect(() => runForPlugin(found, TAB, "Go.", { schema: { type: "object" } })).toThrow("Fake codex cannot give a reply that follows a JSON schema.")
  expect(() => runForPlugin(found, TAB, "Go.", { agent: "claude", schema: [] })).toThrow("must be a JSON schema object")
  expect(codex.sessions).toEqual([])
})
