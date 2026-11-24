import { expect, test } from "bun:test"
import type { AgentInfo, TabInfo } from "@comet/protocol"
import type { AgentHost } from "../agents/agent"
import { Agents } from "../agents/registry"
import { fakeAgent } from "../test-support"
import { runForPlugin } from "./runs"

const TAB: TabInfo = { id: "tab-1", title: "Guide", project: "/work/app", terminals: [], agent: "codex", model: "gpt", effort: "high", permissionMode: "bypassPermissions" }

/** Agents with a fake Codex that reports itself as `reading` says. */
async function agents(reading: Partial<AgentInfo> = {}) {
  const codex = fakeAgent("codex")
  const make = (host: AgentHost) => ({ ...codex.make(host), inspect: async () => host.publish({ state: "ready", ...reading }) })
  const found = new Agents(() => {}, { compactIdle: () => false }, { codex: make })
  found.send(() => {})
  await Bun.sleep(0)
  return { agents: found, codex }
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
