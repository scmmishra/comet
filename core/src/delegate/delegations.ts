import { DEFAULT_MODEL, PERMISSION_MODES, type AgentId, type AgentInfo, type ModelOption, type PermissionAnswer, type PermissionMode, type RunSettings, type Subagent, type ThreadEvent, type ThreadItem } from "@desk/protocol"
import type { AgentSession, ToolServer } from "../agents/agent"
import type { Agents } from "../agents/registry"
import type { ToolResult, ToolSet } from "./mcp"
import { DELEGATE, taskWords, INSTRUCTIONS, LIST_AGENTS, SERVER_NAME } from "./tools"

/** What Desk reads about the tab whose agent hands work off. */
export interface DelegationHost {
  /** The tab's folder and how its thread runs, or nothing for a tab that is gone. */
  tab(tabId: string): { readonly project: string; readonly settings: RunSettings } | undefined
  /** Adds an event to the tab's thread. */
  emit(tabId: string, event: ThreadEvent): void
}

/** One task running for a tab: its session, and the requests of it that wait for the user. */
interface Child {
  readonly session: AgentSession
  readonly requests: Set<string>
}

/**
 * Work one agent hands another, after T3 Code. Each session gets Desk's tools over MCP, under a token
 * that names its tab. A `delegate` call opens a session on the agent it names, in the tab's folder, sends
 * it the task and answers with its final message. The task shows as a subagent of the tab's thread. Its
 * permission requests and questions show in the thread, since only the user can answer them. A task gets
 * no tools of Desk's, so it cannot hand its work on.
 */
export class Delegations {
  private readonly tabs = new Map<string, string>()
  private readonly tokens = new Map<string, string>()
  private readonly children = new Map<string, Set<Child>>()

  constructor(
    private readonly agents: Agents,
    private readonly host: DelegationHost,
    /** Where Desk's MCP server listens. */
    private readonly endpoint: () => string,
  ) {}

  /** Desk's tools for a tab's session. A tab keeps one token, so a session that restarts keeps its tools. */
  server(tabId: string): ToolServer {
    let token = this.tokens.get(tabId)
    if (!token) {
      token = crypto.randomUUID() + crypto.randomUUID()
      this.tokens.set(tabId, token)
      this.tabs.set(token, tabId)
    }
    return { url: this.endpoint(), authorization: `Bearer ${token}`, instructions: INSTRUCTIONS }
  }

  /** The tools of the session an Authorization header names, or nothing for a header Desk did not give out. */
  toolsFor(authorization: string): ToolSet | undefined {
    const tabId = this.tabs.get(authorization.replace(/^Bearer /, ""))
    if (!tabId) return undefined
    return {
      tools: [LIST_AGENTS, DELEGATE],
      call: async (name, input, signal) => {
        if (name === LIST_AGENTS.name) return { text: JSON.stringify({ agents: this.agents.all().flatMap((agent) => listed(this.agents.info(agent.id))) }, null, 2) }
        if (name === DELEGATE.name) return this.delegate(tabId, input, signal)
        throw new Error(`Desk has no tool called ${name}.`)
      },
    }
  }

  /** Answers a task's permission request. Says whether the request was a task's, so the tab's own session is not asked. */
  answerPermission(tabId: string, requestId: string, answer: PermissionAnswer): boolean {
    return this.answer(tabId, requestId, (session) => session.answerPermission(requestId, answer))
  }

  answerQuestion(tabId: string, requestId: string, answers: Readonly<Record<string, string>> | undefined): boolean {
    return this.answer(tabId, requestId, (session) => session.answerQuestion(requestId, answers))
  }

  /** Stops a tab's tasks, as stopping its turn does. */
  stop(tabId: string) {
    for (const child of this.children.get(tabId) ?? []) void child.session.interrupt().catch(() => undefined)
  }

  /** Ends a tab's tasks and forgets its token, once its session has closed. */
  drop(tabId: string) {
    for (const child of this.children.get(tabId) ?? []) child.session.close()
    this.children.delete(tabId)
    const token = this.tokens.get(tabId)
    if (token) this.tabs.delete(token)
    this.tokens.delete(tabId)
  }

  private answer(tabId: string, requestId: string, answer: (session: AgentSession) => void): boolean {
    const child = [...(this.children.get(tabId) ?? [])].find((found) => found.requests.has(requestId))
    if (child) answer(child.session)
    return !!child
  }

  /** Runs a task on the agent it names and resolves with the agent's final message. */
  private delegate(tabId: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
    const parent = this.host.tab(tabId)
    if (!parent) throw new Error("The tab this session ran in has closed.")
    const task = typeof input.task === "string" ? input.task.trim() : ""
    if (!task) throw new Error("`task` says what the agent should do. It cannot be empty.")
    const info = this.ready(String(input.agent ?? ""))
    const model = chosenModel(info, input.model)
    const effort = chosenEffort(info, model, input.effort)
    const settings: RunSettings = { agent: info.id, model: model.value, ...(effort ? { effort } : {}), permissionMode: narrowed(parent.settings.permissionMode, model.permissionModes) }

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
      this.host.emit(tabId, { kind: "subagent", subagent })
    }

    return new Promise<ToolResult>((resolve) => {
      const finish = () => {
        const outcome = taskOutcome([...items.values()])
        show({ status: outcome.status, endedAt: Date.now(), summary: taskWords(outcome.text) })
        this.children.get(tabId)?.delete(child)
        child.session.close()
        resolve({ text: outcome.text, isError: outcome.status !== "completed" })
      }
      const emit = (event: ThreadEvent) => {
        if (event.kind === "status" && !event.busy) return finish()
        if (event.kind !== "item") return
        // Only the user can answer a request, so it shows in the tab's thread, and its answer comes back here.
        if (event.item.type === "permission" || event.item.type === "question") {
          if (event.item.answered) child.requests.delete(event.item.requestId)
          else child.requests.add(event.item.requestId)
          return this.host.emit(tabId, event)
        }
        if (event.item.type === "user") return
        items.set(event.item.id, event.item)
        show({ items: [...items.values()], toolUses: [...items.values()].filter((item) => item.type === "tool").length })
      }
      const child: Child = { session: this.agents.get(info.id).open(parent.project, emit, { settings, onSessionId: () => {}, ephemeral: true }), requests: new Set() }
      this.children.set(tabId, (this.children.get(tabId) ?? new Set()).add(child))
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

