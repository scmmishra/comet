import { expect, test } from "bun:test"
import type { AgentInfo, CoreMessage } from "@desk/protocol"
import { fakeAgent, until } from "../test-support"
import { requireFeature } from "./agent"
import { Agents } from "./registry"

const settings = { compactIdle: () => false }
/** The agents of the last `agents` message sent. */
const last = (sent: CoreMessage[]) => (sent.findLast((message) => message.type === "agents") as Extract<CoreMessage, { type: "agents" }>).agents
const row = (agents: readonly AgentInfo[], id: string) => agents.find((agent) => agent.id === id)!

test("sends every agent as unread, reads each once on the first ask, and sends the list again as each reports", async () => {
  const sent: CoreMessage[] = []
  const agents = new Agents((message) => sent.push(message), settings, { claude: fakeAgent("claude").make, codex: fakeAgent("codex", ["steer"]).make })
  const replies: CoreMessage[] = []
  agents.send((message) => replies.push(message))
  expect(last(replies).map((agent) => [agent.id, agent.state, agent.features])).toEqual([
    ["claude", "checking", []],
    ["codex", "checking", ["steer"]],
  ])
  await Bun.sleep(0)
  expect(last(sent).map((agent) => [agent.id, agent.state, agent.models.length])).toEqual([
    ["claude", "ready", 1],
    ["codex", "ready", 1],
  ])
  const before = sent.length
  agents.send(() => {})
  await Bun.sleep(0)
  expect(sent.length).toBe(before)
})

test("keeps what an agent reported when it reports something else", async () => {
  const sent: CoreMessage[] = []
  const agents = new Agents((message) => sent.push(message), settings, { codex: fakeAgent("codex").make })
  agents.send(() => {})
  await Bun.sleep(0)
  agents.refreshUsage()
  await Bun.sleep(0)
  expect(row(last(sent), "codex")).toMatchObject({ state: "ready", usage: { windows: [{ percent: 10 }] } })
  expect(agents.info("codex")?.models).toHaveLength(1)
})

test("an agent that cannot be read says why in its own row, and the others still show", async () => {
  const sent: CoreMessage[] = []
  const broken = fakeAgent("codex")
  const agents = new Agents((message) => sent.push(message), settings, {
    claude: fakeAgent("claude").make,
    codex: (host) => ({ ...broken.make(host), inspect: () => Promise.reject(new Error("codex exited with code 1")) }),
  })
  agents.send(() => {})
  await Bun.sleep(0)
  expect(row(last(sent), "codex")).toMatchObject({ state: "signed-out", problem: "codex exited with code 1" })
  expect(row(last(sent), "claude").state).toBe("ready")
})

test("stops a sign-in the user cancels, reports no error, and reads the agent again", async () => {
  const sent: CoreMessage[] = []
  const codex = fakeAgent("codex", ["sign-in"])
  let started = false
  const agents = new Agents((message) => sent.push(message), settings, {
    codex: (host) => ({
      ...codex.make(host),
      signIn: (signal) => {
        started = true
        host.publish({ signInLink: "https://auth.openai.com/x" })
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Cancelled."))))
      },
    }),
  })
  const signingIn = agents.run("codex", "signIn")
  await until(() => started)
  expect(row(last(sent), "codex")).toMatchObject({ state: "signing-in", signInLink: "https://auth.openai.com/x" })
  // A second ask while one runs does nothing.
  await agents.run("codex", "signIn")
  agents.cancel("codex")
  await signingIn
  expect(row(last(sent), "codex").state).toBe("ready")
  expect(row(last(sent), "codex").signInLink).toBeUndefined()
})

test("lets an update run to its end, since stopping an updater can break the agent", async () => {
  const claude = fakeAgent("claude")
  let finish = () => {}
  let done = false
  const agents = new Agents(() => {}, settings, { claude: (host) => ({ ...claude.make(host), update: () => new Promise<void>((resolve) => (finish = resolve)) }) })
  const updating = agents.run("claude", "update").then(() => void (done = true))
  agents.cancel("claude")
  await Bun.sleep(10)
  expect(done).toBe(false)
  finish()
  await updating
  expect(done).toBe(true)
})

test("reads each agent's slash commands, and none from an agent that has none", async () => {
  const claude = fakeAgent("claude")
  const skill = { name: "pdf", description: "Reads a PDF", ownProject: false, group: "User" }
  const agents = new Agents(() => {}, settings, { claude: (host) => ({ ...claude.make(host), commands: async () => [skill] }), codex: fakeAgent("codex").make })
  expect(await agents.commands("/work/app")).toEqual({ claude: [skill], codex: [] })
})

test("runs what an agent can do to itself, reads it again, and refuses what it cannot do", async () => {
  const codex = fakeAgent("codex", ["sign-in"])
  const sent: CoreMessage[] = []
  const agents = new Agents((message) => sent.push(message), settings, { codex: codex.make })
  await agents.run("codex", "signIn")
  expect(codex.calls).toEqual(["signIn"])
  const states = sent.flatMap((message) => (message.type === "agents" ? [row(message.agents, "codex").state] : []))
  expect(states).toEqual(["signing-in", "ready"])
  await expect(agents.run("codex", "update")).rejects.toThrow("Fake codex has no updater Desk can run.")
  expect(() => agents.get("antigravity")).toThrow("Desk does not run an agent called antigravity.")
  expect(() => requireFeature(agents.get("codex"), "fork", "fork a thread")).toThrow("Fake codex cannot fork a thread.")
})
