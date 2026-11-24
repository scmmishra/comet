import { DEFAULT_MODEL, PERMISSION_MODES, type AgentId, type AgentInfo, type ModelOption, type PermissionAnswer, type PermissionMode, type RunSettings, type Subagent, type ThreadEvent, type ThreadItem } from "@comet/protocol"
import type { AgentSession } from "../agents/agent"
import type { Agents } from "../agents/registry"
import { notReady, startTask, type TaskOutcome } from "../agents/tasks"
import type { ToolResult } from "../tools/mcp"
import type { ToolGroup } from "../tools/tool"
import { DELEGATE, INSTRUCTIONS, LIST_AGENTS, taskWords } from "./tools"

/** What Comet reads about the session whose agent hands work off. */
export interface DelegationHost {
  /** The folder the session works in. */
  readonly project: string
  /** How the session's thread runs now. A task runs no broader. */
  settings(): RunSettings
  /** Adds an event to the session's thread. */
  emit(event: ThreadEvent): void
}

/** What one session's agent may hand off: the tools that hand a task off, and the tasks that run for it. */
export interface Handoffs {
  readonly tools: ToolGroup
  /** Answers a task's permission request. Says whether the request was a task's, so the session itself is not asked. */
  answerPermission(requestId: string, answer: PermissionAnswer): boolean
  answerQuestion(requestId: string, answers: Readonly<Record<string, string>> | undefined): boolean
  /** The tasks' requests that still wait for the user, to show again when the session's thread comes back into view. */
  pending(): ThreadItem[]
  /** Stops the tasks, as stopping the session's turn does. */
  stop(): void
  /** Ends the tasks, once the session has closed. */
  close(): void
}

/** One task running for a session: its own session, and the requests of it that wait for the user. */
interface Child {
  readonly session: AgentSession
  readonly requests: Map<string, ThreadItem>
  /** Stops the task, which then ends with what it has said so far. */
  stop(): void
}

/** A session that may hand work off, with the tasks running for it. */
interface Caller {
  readonly host: DelegationHost
  readonly children: Set<Child>
}

/**
 * Work one agent hands another, after T3 Code. A `delegate` call opens a session on the agent it names,
 * in the caller's folder, sends it the task and answers with its final message. The task shows as a subagent of the caller's thread. Its
 * permission requests and questions show in the thread, since only the user can answer them. A task gets
 * no tools of Comet's, so it cannot hand its work on.
 */
export class Delegations {
  constructor(private readonly agents: Pick<Agents, "get" | "all" | "info">) {}

  /** The tools that let a session hand tasks off, and the tasks it hands off. */
  open(host: DelegationHost): Handoffs {
    const caller: Caller = { host, children: new Set() }
    const answer = (requestId: string, give: (session: AgentSession) => void) => {
      const child = [...caller.children].find((found) => found.requests.has(requestId))
      if (child) give(child.session)
      return !!child
    }
    return {
      tools: {
        instructions: INSTRUCTIONS,
        tools: [LIST_AGENTS, DELEGATE],
        call: async (name, input, signal) =>
          name === LIST_AGENTS.name ? { text: JSON.stringify({ agents: this.agents.all().flatMap((agent) => listed(this.agents.info(agent.id))) }, null, 2) } : this.delegate(caller, input, signal),
      },
      answerPermission: (requestId, reply) => answer(requestId, (session) => session.answerPermission(requestId, reply)),
      answerQuestion: (requestId, answers) => answer(requestId, (session) => session.answerQuestion(requestId, answers)),
      pending: () => [...caller.children].flatMap((child) => [...child.requests.values()]),
      stop: () => {
        for (const child of caller.children) child.stop()
      },
      close: () => {
        for (const child of caller.children) child.session.close()
        caller.children.clear()
      },
    }
  }

  /** Runs a task on the agent it names and resolves with the agent's final message. */
  private async delegate({ host, children }: Caller, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult> {
    const task = typeof input.task === "string" ? input.task.trim() : ""
    if (!task) throw new Error("`task` says what the agent should do. It cannot be empty.")
    const info = this.ready(String(input.agent ?? ""))
    const model = chosenModel(info, input.model)
    const effort = chosenEffort(info, model, input.effort)
    const settings: RunSettings = { agent: info.id, model: model.value, ...(effort ? { effort } : {}), permissionMode: narrowed(host.settings().permissionMode, model.permissionModes) }

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
    const requests = new Map<string, ThreadItem>()
    const running = startTask(this.agents.get(info.id), host.project, settings, task, {
      items: (items) => show({ items: [...items], toolUses: items.filter((item) => item.type === "tool").length }),
      // Only the user can answer a request, so it shows in the caller's thread, and its answer comes back here.
      request: (item) => {
        if (item.answered) requests.delete(item.requestId)
        else requests.set(item.requestId, item)
        host.emit({ kind: "item", item })
      },
    })
    // The task shows once its session opened, so a session that fails to open leaves nothing running in the thread.
    show({})
    const child: Child = { session: running.session, requests, stop: running.stop }
    children.add(child)
    // The agent that asked gave up on the call, such as when the user stopped its turn.
    signal.addEventListener("abort", running.stop)
    const outcome = await running.done
    children.delete(child)
    const text = taskText(outcome)
    show({ status: outcome.status, endedAt: Date.now(), summary: taskWords(text) })
    return { text, isError: outcome.status !== "completed" }
  }

  /** An agent that can take a task now. One that cannot says why, in words the asking agent can pass on to the user. */
  private ready(id: string): AgentInfo {
    const info = this.agents.info(id as AgentId)
    if (!info) throw new Error(`Comet runs no agent called "${id}". Call list_agents to see the agents it runs.`)
    const reason = notReady(info)
    if (reason) throw new Error(`${reason} The user can set it up in Comet's Settings, under Providers.`)
    return info
  }
}

/** An agent as `list_agents` answers it. An agent Comet has not read yet is left out. */
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

/**
 * A task's outcome in words the agent that asked reads: its last text when it finished, else why it did
 * not. A task that failed or was stopped after it answered keeps that answer. A task whose turn stopped
 * after it answered adds the reason, so the agent that asked learns of it.
 */
function taskText(outcome: TaskOutcome): string {
  const report = (end: string) => ("lastAnswer" in outcome && outcome.lastAnswer ? `\n\nIts last report before it ${end}:\n\n${outcome.lastAnswer}` : "")
  if (outcome.status === "failed") return outcome.error ? `The task failed: ${outcome.error}${report("failed")}` : "The task ended without an answer."
  if (outcome.status === "stopped") return `The task was stopped before it finished.${report("was stopped")}`
  return outcome.stopReasons.length ? `${outcome.answer}\n\nIts turn was stopped after this answer:\n\n${outcome.stopReasons.join("\n\n")}` : outcome.answer
}
