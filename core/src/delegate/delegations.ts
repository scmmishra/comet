import { DEFAULT_MODEL, PERMISSION_MODES, type AgentId, type AgentInfo, type ModelOption, type PermissionAnswer, type PermissionMode, type RunSettings, type Subagent, type ThreadEvent, type ThreadItem } from "@desk/protocol"
import type { AgentSession, ToolServer } from "../agents/agent"
import type { Agents } from "../agents/registry"
import type { ToolResult, ToolSet } from "./mcp"
import { DELEGATE, INSTRUCTIONS, LIST_AGENTS, taskWords } from "./tools"

/** What Desk reads about the session whose agent hands work off. */
export interface DelegationHost {
  /** The folder the session works in. */
  readonly project: string
  /** How the session's thread runs now. A task runs no broader. */
  settings(): RunSettings
  /** Adds an event to the session's thread. */
  emit(event: ThreadEvent): void
}

/** What one session's agent may hand off: Desk's tools for it, and the tasks that run for it. */
export interface Handoffs {
  readonly tools: ToolServer
  /** Answers a task's permission request. Says whether the request was a task's, so the session itself is not asked. */
  answerPermission(requestId: string, answer: PermissionAnswer): boolean
  answerQuestion(requestId: string, answers: Readonly<Record<string, string>> | undefined): boolean
  /** Stops the tasks, as stopping the session's turn does. */
  stop(): void
  /** Ends the tasks and takes back the tools, once the session has closed. */
  close(): void
}

/** One task running for a session: its own session, and the requests of it that wait for the user. */
interface Child {
  readonly session: AgentSession
  readonly requests: Set<string>
}

/** A session that may hand work off, with the tasks running for it. */
interface Caller {
  readonly host: DelegationHost
  readonly children: Set<Child>
}

/**
 * Work one agent hands another, after T3 Code. Each session gets Desk's tools over MCP, under a token
 * that names it. A `delegate` call opens a session on the agent it names, in the caller's folder, sends
 * it the task and answers with its final message. The task shows as a subagent of the caller's thread. Its
 * permission requests and questions show in the thread, since only the user can answer them. A task gets
 * no tools of Desk's, so it cannot hand its work on.
 */
export class Delegations {
  private readonly callers = new Map<string, Caller>()

  constructor(
    private readonly agents: Pick<Agents, "get" | "all" | "info">,
    /** Where Desk's MCP server listens. */
    private readonly endpoint: () => string,
  ) {}

  /** Gives a session Desk's tools, under a token of its own. */
  open(host: DelegationHost): Handoffs {
    const token = crypto.randomUUID() + crypto.randomUUID()
    const caller: Caller = { host, children: new Set() }
    this.callers.set(token, caller)
    const answer = (requestId: string, give: (session: AgentSession) => void) => {
      const child = [...caller.children].find((found) => found.requests.has(requestId))
      if (child) give(child.session)
      return !!child
    }
    return {
      tools: { url: this.endpoint(), authorization: `Bearer ${token}`, instructions: INSTRUCTIONS },
      answerPermission: (requestId, reply) => answer(requestId, (session) => session.answerPermission(requestId, reply)),
      answerQuestion: (requestId, answers) => answer(requestId, (session) => session.answerQuestion(requestId, answers)),
      stop: () => {
        for (const child of caller.children) void child.session.interrupt().catch(() => undefined)
      },
      close: () => {
        for (const child of caller.children) child.session.close()
        caller.children.clear()
        this.callers.delete(token)
      },
    }
  }

  /** The tools of the session an Authorization header names, or nothing for a header Desk did not give out. */
  toolsFor(authorization: string): ToolSet | undefined {
    const caller = this.callers.get(authorization.replace(/^Bearer /, ""))
    if (!caller) return undefined
    return {
      tools: [LIST_AGENTS, DELEGATE],
      call: async (name, input, signal) => {
        if (name === LIST_AGENTS.name) return { text: JSON.stringify({ agents: this.agents.all().flatMap((agent) => listed(this.agents.info(agent.id))) }, null, 2) }
        if (name === DELEGATE.name) return this.delegate(caller, input, signal)
        throw new Error(`Desk has no tool called ${name}.`)
      },
    }
  }

  /** Runs a task on the agent it names and resolves with the agent's final message. */
  private delegate({ host, children }: Caller, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
    const task = typeof input.task === "string" ? input.task.trim() : ""
    if (!task) throw new Error("`task` says what the agent should do. It cannot be empty.")
    const info = this.ready(String(input.agent ?? ""))
    const model = chosenModel(info, input.model)
    const effort = chosenEffort(info, model, input.effort)
    const settings: RunSettings = { agent: info.id, model: model.value, ...(effort ? { effort } : {}), permissionMode: narrowed(host.settings().permissionMode, model.permissionModes) }

    const items = new Map<string, ThreadItem>()
    let subagent: Subagent = {
      id: `delegated:${crypto.randomUUID()}`,
      description: typeof input.title === "string" && input.title.trim() ? input.title.trim() : taskWords(task),
      agent: info.id,
      model: model.runs ?? model.label,
      status: "running",
      background: false,
      startedAt: Date.now(),
      toolUses: 0,
      prompt: task,
      items: [],
    }
    const show = (change: Partial<Subagent>) => {
      subagent = { ...subagent, ...change }
      host.emit({ kind: "subagent", subagent })
    }

    return new Promise<ToolResult>((resolve) => {
      const finish = () => {
        const outcome = taskOutcome([...items.values()])
        show({ status: outcome.status, endedAt: Date.now(), summary: taskWords(outcome.text) })
        children.delete(child)
        child.session.close()
        resolve({ text: outcome.text, isError: outcome.status !== "completed" })
      }
      const emit = (event: ThreadEvent) => {
        if (event.kind === "status" && !event.busy) return finish()
        if (event.kind !== "item") return
        // Only the user can answer a request, so it shows in the caller's thread, and its answer comes back here.
        if (event.item.type === "permission" || event.item.type === "question") {
          if (event.item.answered) child.requests.delete(event.item.requestId)
          else child.requests.add(event.item.requestId)
          return host.emit(event)
        }
        if (event.item.type === "user") return
        items.set(event.item.id, event.item)
        show({ items: [...items.values()], toolUses: [...items.values()].filter((item) => item.type === "tool").length })
      }
      const child: Child = { session: this.agents.get(info.id).open(host.project, emit, { settings, onSessionId: () => {}, ephemeral: true }), requests: new Set() }
      children.add(child)
      // The agent that asked gave up on the call, such as when the user stopped its turn.
      signal.addEventListener("abort", () => void child.session.interrupt().catch(() => undefined))
      show({})
      child.session.send(task)
    })
  }

  /** An agent that can take a task now. One that cannot says why, in words the asking agent can pass on to the user. */
  private ready(id: string): AgentInfo {
    const info = this.agents.all().some((agent) => agent.id === id) ? this.agents.info(id as AgentId) : undefined
    if (!info) throw new Error(`Desk runs no agent called "${id}". Call list_agents to see the agents it runs.`)
    if (info.state !== "ready") throw new Error(`${info.name} is not ready: ${info.problem ?? info.state}. The user can set it up in Desk's Settings, under Providers.`)
    return info
  }
}

/** An agent as `list_agents` answers it. An agent Desk has not read yet is left out. */
function listed(info: AgentInfo | undefined) {
  if (!info || info.state === "checking") return []
  const models = info.models.map((model) => ({ model: model.value, name: model.runs ?? model.label, ...(model.efforts.length ? { efforts: model.efforts, ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}) } : {}) }))
  return [{ agent: info.id, name: info.name, ready: info.state === "ready", ...(info.state === "ready" ? { models } : { problem: info.problem ?? info.state }) }]
}

/** The model a task names, by its value or its name, else the agent's default. */
function chosenModel(info: AgentInfo, asked: unknown): ModelOption {
  const wanted = typeof asked === "string" && asked.trim() ? asked.trim().toLowerCase() : DEFAULT_MODEL
  const model = info.models.find((found) => [found.value, found.label, found.runs].some((name) => name?.toLowerCase() === wanted))
  if (!model) throw new Error(`${info.name} has no model called "${String(asked)}". Its models are: ${info.models.map((found) => found.value).join(", ")}.`)
  return model
}

function chosenEffort(info: AgentInfo, model: ModelOption, asked: unknown): string | undefined {
  if (typeof asked !== "string" || !asked.trim()) return undefined
  const effort = asked.trim().toLowerCase()
  if (!model.efforts.includes(effort)) throw new Error(`${info.name}'s ${model.label} has no effort level "${asked}". ${model.efforts.length ? `Its levels are: ${model.efforts.join(", ")}.` : "It takes none."}`)
  return effort
}

/**
 * The permission mode a task runs in: the broadest mode its model takes that is no broader than the mode
 * of the thread that started it. A task never gets more than the user gave the thread.
 */
export function narrowed(parent: PermissionMode, modes: readonly PermissionMode[]): PermissionMode {
  const limit = PERMISSION_MODES.indexOf(parent)
  return PERMISSION_MODES.findLast((mode, rank) => rank <= limit && modes.includes(mode)) ?? PERMISSION_MODES[0]
}

/** How a task ended, from what it left in its thread: its last text when it finished, else why it did not. */
function taskOutcome(items: readonly ThreadItem[]): { readonly status: "completed" | "failed" | "stopped"; readonly text: string } {
  const error = items.findLast((item) => item.type === "error")
  if (error?.type === "error") return { status: "failed", text: `The task failed: ${error.message}` }
  const result = items.findLast((item) => item.type === "result")
  if (result?.type === "result" && result.stopped) return { status: "stopped", text: "The task was stopped before it finished." }
  const answer = items.findLast((item) => item.type === "text" && item.text.trim())
  return answer?.type === "text" ? { status: "completed", text: answer.text } : { status: "failed", text: "The task ended without an answer." }
}

