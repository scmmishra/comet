import { AGENTS, type AgentId, type AgentInfo, type CoreMessage, type Skill } from "@desk/protocol"
import type { Agent, AgentHost, AgentReading } from "./agent"
import { claudeAgent } from "./claude"

type Send = (message: CoreMessage) => void

/** How to make each agent Desk runs. Adding an agent means adding it to `AGENTS` in the protocol, and here. */
const MAKERS: Partial<Record<AgentId, (host: AgentHost) => Agent>> = {
  claude: claudeAgent,
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

  /** The agent a tab names. */
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

  /** Each agent's slash commands in a folder, by agent. An agent without any lists none. */
  async commands(dir: string): Promise<Partial<Record<AgentId, Skill[] | null>>> {
    const read = await Promise.all(this.all().map(async (agent) => [agent.id, agent.commands ? await agent.commands(dir) : []] as const))
    return Object.fromEntries(read)
  }

  /** Reads every agent's plan usage again. */
  refreshUsage() {
    for (const agent of this.agents.values()) void agent.refreshUsage().catch(() => undefined)
  }

  /**
   * Runs something an agent does to itself, such as its update. The agent's row says so while it runs,
   * and the agent is read again once it ends, whether it worked or not.
   */
  async run(id: AgentId, action: AgentAction) {
    const agent = this.get(id)
    const run = agent[action]
    if (!run) throw new Error(`${agent.name} has no ${ACTIONS[action].name} Desk can run.`)
    this.learn(id, { state: ACTIONS[action].state, problem: undefined })
    try {
      await run.call(agent)
    } finally {
      await this.inspect(agent)
    }
  }

  close() {
    for (const agent of this.agents.values()) agent.close()
  }

  /** An agent that throws while it is read says so in its own row, and the others still show. */
  private async inspect(agent: Agent) {
    await agent.inspect().catch((error) => this.learn(agent.id, { state: "signed-out", problem: error instanceof Error ? error.message : String(error) }))
  }

  private learn(id: AgentId, reading: AgentReading) {
    const before = this.known.get(id)
    if (!before) return
    this.known.set(id, { ...before, ...reading })
    this.broadcast(this.message())
  }

  private message(): CoreMessage {
    return { type: "agents", agents: [...this.known.values()] }
  }
}

type AgentAction = "update" | "install" | "signIn"

/** What each action is called when an agent lacks it, and the state an agent shows while it runs. */
const ACTIONS: Record<AgentAction, { readonly name: string; readonly state: AgentInfo["state"] }> = {
  update: { name: "updater", state: "updating" },
  install: { name: "installer", state: "installing" },
  signIn: { name: "sign-in", state: "signing-in" },
}
