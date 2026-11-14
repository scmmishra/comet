import { AGENTS, type AgentId, type AgentInfo, type CoreMessage, type Skill } from "@desk/protocol"
import { errorMessage } from "../errors"
import { requireFeature, type Agent, type AgentHost, type AgentMcp, type AgentReading } from "./agent"
import { antigravityAgent } from "./antigravity"
import { claudeAgent } from "./claude"
import { codexAgent } from "./codex"

type Send = (message: CoreMessage) => void

/** How to make each agent Desk runs. AGENTS.md lists the steps to add one. */
const MAKERS: Record<AgentId, (host: AgentHost) => Agent> = {
  claude: claudeAgent,
  codex: codexAgent,
  antigravity: antigravityAgent,
}

type AgentAction = "update" | "install" | "signIn"

/**
 * What each action is called when an agent lacks it, the state an agent shows while it runs, how it runs,
 * and whether the user can stop it. An update runs to its end, since stopping an updater midway can leave
 * the agent broken.
 */
const ACTIONS: Record<AgentAction, { readonly name: string; readonly state: AgentInfo["state"]; readonly stoppable: boolean; readonly run: (agent: Agent, signal: AbortSignal) => Promise<void> | undefined }> = {
  update: { name: "updater", state: "updating", stoppable: false, run: (agent) => agent.update?.() },
  install: { name: "installer", state: "installing", stoppable: true, run: (agent, signal) => agent.install?.(signal) },
  signIn: { name: "sign-in", state: "signing-in", stoppable: true, run: (agent, signal) => agent.signIn?.(signal) },
}

/** What the core lends every agent, less where each reports what it learns. */
export type AgentSettings = Omit<AgentHost, "publish">

/**
 * The agents Desk runs, and what Desk knows about each: whether it is installed and signed in, its
 * models and its plan usage. Each agent reports what it learns, and every client gets the whole list
 * again. Agents rarely change, so they are read once, on the first ask.
 */
export class Agents {
  private readonly agents: ReadonlyMap<AgentId, Agent>
  private readonly known: Map<AgentId, AgentInfo>
  /** What each agent does to itself now, with the way to stop it. */
  private readonly running = new Map<AgentId, { readonly action: AgentAction; readonly abort: AbortController }>()
  private inspected = false

  constructor(
    private readonly broadcast: Send,
    settings: AgentSettings,
    makers: Partial<Record<AgentId, (host: AgentHost) => Agent>> = MAKERS,
  ) {
    const made = AGENTS.flatMap((id) => (makers[id] ? [makers[id]({ ...settings, publish: (reading) => this.learn(id, reading) })] : []))
    this.agents = new Map(made.map((agent) => [agent.id, agent]))
    this.known = new Map(made.map((agent) => [agent.id, { id: agent.id, name: agent.name, state: "checking", models: [], features: agent.features }]))
  }

  get(id: AgentId): Agent {
    const agent = this.agents.get(id)
    if (!agent) throw new Error(`Desk does not run an agent called ${id}.`)
    return agent
  }

  /** Every agent, in Desk's order. */
  all(): readonly Agent[] {
    return [...this.agents.values()]
  }

  /** What Desk knows about an agent now. */
  info(id: AgentId): AgentInfo | undefined {
    return this.known.get(id)
  }

  /** Sends what is known. The first ask reads every agent, and every client then gets what each one reports. */
  send(reply: Send) {
    reply(this.message())
    if (this.inspected) return
    this.inspected = true
    for (const agent of this.agents.values()) void this.inspect(agent)
  }

  /** Each agent's skills and commands in a folder, by agent. An agent without any lists none. */
  async commands(dir: string): Promise<Partial<Record<AgentId, Skill[] | null>>> {
    const read = await Promise.all(this.all().map(async (agent) => [agent.id, agent.commands ? await agent.commands(dir) : []] as const))
    return Object.fromEntries(read)
  }

  /** An agent's MCP servers, for an agent that has `mcp`. */
  mcp(id: AgentId): AgentMcp {
    const agent = this.get(id)
    requireFeature(agent, "mcp", "list its MCP servers")
    if (!agent.mcp) throw new Error(`${agent.name} lists the mcp feature but has no MCP reader.`)
    return agent.mcp
  }

  /** Reads every agent's plan usage again. Usage is extra information, so a failed read keeps the last one. */
  refreshUsage() {
    for (const agent of this.agents.values()) void agent.refreshUsage().catch(() => undefined)
  }

  /**
   * Runs something an agent does to itself, such as its update. The agent's row says so while it runs,
   * and the agent is read again once it ends, whether it worked, failed or was stopped. An agent does one
   * such thing at a time. A stop is the user's choice, so it reports no error.
   */
  async run(id: AgentId, action: AgentAction) {
    const agent = this.get(id)
    const { name, state, run } = ACTIONS[action]
    if (!agent[action]) throw new Error(`${agent.name} has no ${name} Desk can run.`)
    if (this.running.has(id)) return
    const abort = new AbortController()
    this.running.set(id, { action, abort })
    this.learn(id, { state, problem: undefined })
    try {
      await run(agent, abort.signal)
    } catch (error) {
      if (!abort.signal.aborted) throw error
    } finally {
      this.running.delete(id)
      if (this.known.get(id)?.signInLink) this.learn(id, { signInLink: undefined })
      await this.inspect(agent)
    }
  }

  /** Stops what an agent does to itself, when that can be stopped. */
  cancel(id: AgentId) {
    const running = this.running.get(id)
    if (running && ACTIONS[running.action].stoppable) running.abort.abort()
  }

  close() {
    for (const agent of this.agents.values()) agent.close()
  }

  /** An agent that throws while it is read says so in its own row, and the others still show. */
  private async inspect(agent: Agent) {
    await agent.inspect().catch((error) => this.learn(agent.id, { state: "signed-out", problem: errorMessage(error) }))
  }

  private learn(id: AgentId, reading: AgentReading) {
    this.known.set(id, { ...this.known.get(id)!, ...reading })
    this.broadcast(this.message())
  }

  private message(): CoreMessage {
    return { type: "agents", agents: [...this.known.values()] }
  }
}
