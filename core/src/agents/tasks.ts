import { DEFAULT_MODEL, type AgentInfo, type ModelOption, type ThreadEvent, type ThreadItem } from "@comet/protocol"
import type { Agent, AgentSession, SessionOptions } from "./agent"

/** A request a task's agent makes that only the user can answer: a permission request or a question. */
export type TaskRequest = Extract<ThreadItem, { readonly type: "permission" | "question" }>

/** What the code that runs a task hears of it while it runs. */
export interface TaskWatch {
  /** The task's thread items, as they are now, each time they change. The task's own prompt is left out. */
  readonly items?: (items: readonly ThreadItem[]) => void
  /** A request of the task's agent, when it asks and when it is answered. Its answer goes to `session`, the task's. */
  readonly request: (item: TaskRequest, session: AgentSession) => void
}

/**
 * How a task ended. A completed task gives its last text, with the reasons a turn was stopped after it,
 * such as by a hook, and the output its schema asked for, when it had one and the agent gave it. A task that failed or was stopped keeps the last text it gave before, since the work
 * it reports may be done. A failed task with no error ended without an answer.
 */
export type TaskOutcome =
  | { readonly status: "completed"; readonly answer: string; readonly stopReasons: readonly string[]; readonly output?: unknown }
  | { readonly status: "failed"; readonly error?: string; readonly lastAnswer?: string }
  | { readonly status: "stopped"; readonly lastAnswer?: string }

/** One task: a session of its own, run from a prompt until its final turn ends. */
export interface Task {
  readonly session: AgentSession
  /** Resolves once the task ends. The task's session is closed by then. */
  readonly done: Promise<TaskOutcome>
  /** Stops the task, which then ends with what it has said so far. */
  stop(): void
}

/**
 * Runs a prompt on an agent, in a session no thread lists, until its final turn ends. The delegate tool
 * and a plugin's `ctx.run` both run work this way, so they agree on when a task is over.
 */
export function startTask(agent: Pick<Agent, "open">, dir: string, run: Pick<SessionOptions, "settings" | "outputSchema">, prompt: string, watch: TaskWatch): Task {
  const items = new Map<string, ThreadItem>()
  // The agent's own subagents that still run. A turn can end while a background subagent runs. Claude
  // Code starts a turn of its own once it ends, and that turn gives the answer. Commands left running in
  // the background do not hold the task here: a dev server never ends. An agent's session may keep its
  // turn open for a command it waits on, as Antigravity's does, and the task then waits with it.
  const runningSubagents = new Set<string>()
  // An error ends the task as failed, whatever the agent left running.
  let failed = false
  let stopping = false
  let ended = false
  let resolve!: (outcome: TaskOutcome) => void
  const done = new Promise<TaskOutcome>((settle) => (resolve = settle))

  const finish = (stopped = false) => {
    if (ended) return
    ended = true
    session.close()
    resolve(outcomeOf([...items.values()], stopped))
  }
  const showItems = () => watch.items?.([...items.values()])
  const emit = (event: ThreadEvent) => {
    if (ended) return
    if (event.kind === "status") {
      if (event.busy) failed = false
      // A subagent may end just before the turn it starts, so the task ends only when a turn does.
      if (!event.busy && (stopping || failed || !runningSubagents.size)) finish(stopping)
      return
    }
    if (event.kind === "subagent") {
      if (event.subagent.status === "running") runningSubagents.add(event.subagent.id)
      else runningSubagents.delete(event.subagent.id)
      return
    }
    if (event.kind === "items.remove") {
      event.ids.forEach((id) => items.delete(id))
      return showItems()
    }
    if (event.kind !== "item") return
    if (event.item.type === "permission" || event.item.type === "question") return watch.request(event.item, session)
    if (event.item.type === "user") return
    items.set(event.item.id, event.item)
    showItems()
    if (event.item.type !== "error") return
    failed = true
    // An error between turns, such as the agent's process exiting while its subagents ran, has no turn to end.
    if (!session.busy) finish()
  }
  const session = agent.open(dir, emit, { ...run, onSessionId: () => {}, ephemeral: true })
  session.send(prompt)
  return {
    session,
    done,
    stop: () => {
      if (ended) return
      // Between turns there is no turn to stop. Closing the session ends the work it left running.
      if (!session.busy) return finish(true)
      stopping = true
      void session.interrupt().catch(() => undefined)
    },
  }
}

/** Why an agent cannot take a task now, as a sentence, or undefined when it can. */
export function notReady(info: AgentInfo): string | undefined {
  // A problem may end in a full stop. The sentence adds its own after it.
  return info.state === "ready" ? undefined : `${info.name} is not ready: ${(info.problem ?? info.state).replace(/\.$/, "")}.`
}

/** The model a task names, by its value or its name, else the agent's default. */
export function chosenModel(info: AgentInfo, asked: unknown): ModelOption {
  const wanted = typeof asked === "string" && asked.trim() ? asked.trim().toLowerCase() : DEFAULT_MODEL
  const model = info.models.find((found) => [found.value, found.label, found.runs].some((name) => name?.toLowerCase() === wanted))
  if (!model) throw new Error(`${info.name} has no model called "${String(asked)}". Its models are: ${info.models.map((found) => found.value).join(", ")}.`)
  return model
}

/** The effort level a task names, checked against its model, or undefined for the model's default. */
export function chosenEffort(info: AgentInfo, model: ModelOption, asked: unknown): string | undefined {
  if (typeof asked !== "string" || !asked.trim()) return undefined
  const effort = asked.trim().toLowerCase()
  if (!model.efforts.includes(effort)) throw new Error(`${info.name}'s ${model.label} has no effort level "${asked}". ${model.efforts.length ? `Its levels are: ${model.efforts.join(", ")}.` : "It takes none."}`)
  return effort
}

/**
 * How a task ended, from what it left in its thread, after T3 Code. `stopped` says Comet stopped it
 * between turns, which leaves no stopped result. A task whose turn stopped after it answered, such as by
 * a hook, still completed.
 */
function outcomeOf(items: readonly ThreadItem[], stopped: boolean): TaskOutcome {
  const answerAt = (among: readonly ThreadItem[]) => among.findLastIndex((item) => item.type === "text" && item.text.trim())
  const lastAnswer = (among: readonly ThreadItem[]) => {
    const answer = among[answerAt(among)]
    return answer?.type === "text" ? { lastAnswer: answer.text } : {}
  }
  const errorAt = items.findLastIndex((item) => item.type === "error")
  const error = items[errorAt]
  if (error?.type === "error") return { status: "failed", error: error.message, ...lastAnswer(items.slice(0, errorAt)) }
  const result = items.findLast((item) => item.type === "result")
  if (stopped || (result?.type === "result" && result.stopped)) return { status: "stopped", ...lastAnswer(items) }
  // A turn with a schema may give its output with no text, as Claude Code does through a tool of its own.
  const output = result?.type === "result" && result.output !== undefined ? { output: result.output } : undefined
  const answeredAt = answerAt(items)
  const answer = items[answeredAt]
  if (answer?.type !== "text" && !output) return { status: "failed" }
  const stopReasons = items.slice(answeredAt + 1).flatMap((item) => (item.type === "notice" && item.stopsTurn ? [item.text] : []))
  return { status: "completed", answer: answer?.type === "text" ? answer.text : "", stopReasons, ...output }
}
