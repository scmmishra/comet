import type { TabInfo } from "@comet/protocol"
import type { Agents } from "../agents/registry"
import { notReady, startTask, type Task, type TaskOutcome } from "../agents/tasks"

/** A run a plugin started: the reply it waits for, and a way to stop it. */
export interface PluginRun {
  /** The agent's final reply. It rejects when the run fails or is stopped. */
  readonly done: Promise<string>
  /** Stops the run, which then rejects. */
  stop(): void
  /** Ends the run at once, for a plugin that stopped. Its reply never comes. */
  close(): void
}

/**
 * Runs a plugin's prompt on a tab's agent and model, in the tab's folder, in a session no thread shows.
 * It runs in Supervised, where the agent asks before it edits a file or runs a command that may change
 * something. Nobody sees its requests, so each is declined. The agent may still read files and run
 * commands it treats as read-only, such as `git diff`, without asking.
 */
export function runForPlugin(agents: Pick<Agents, "get" | "info">, tab: TabInfo, prompt: string): PluginRun {
  if (!prompt.trim()) throw new Error("A plugin's run needs a prompt. It cannot be empty.")
  const info = agents.info(tab.agent)
  if (!info) throw new Error(`Comet runs no agent called "${tab.agent}".`)
  const reason = notReady(info)
  if (reason) throw new Error(`${reason} Set it up in Settings, under Providers.`)
  const settings = { agent: tab.agent, model: tab.model, ...(tab.effort ? { effort: tab.effort } : {}), ...(tab.fast ? { fast: tab.fast } : {}), permissionMode: "default" as const }
  const task: Task = startTask(agents.get(tab.agent), tab.project, settings, prompt, {
    request: (item, session) => {
      if (item.answered) return
      if (item.type === "permission") session.answerPermission(item.requestId, "decline")
      else session.answerQuestion(item.requestId, undefined)
    },
  })
  return { done: task.done.then(replyOf), stop: task.stop, close: () => task.session.close() }
}

/** The reply a completed run gives, else why there is none. */
function replyOf(outcome: TaskOutcome): string {
  if (outcome.status === "completed") return outcome.answer
  if (outcome.status === "stopped") throw new Error("The run was stopped before it finished.")
  throw new Error(outcome.error ? `The run failed: ${outcome.error}` : "The run ended without an answer.")
}
