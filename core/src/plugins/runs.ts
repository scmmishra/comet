import { AGENTS, type AgentId, type RunSettings, type TabInfo } from "@comet/protocol"
import { requireFeature } from "../agents/agent"
import type { Agents } from "../agents/registry"
import { chosenEffort, chosenModel, notReady, startTask, type TaskOutcome } from "../agents/tasks"

/** What a plugin may choose for a run. Each is unchecked until `runForPlugin` reads it. */
export interface RunOptions {
  /** The agent to run on, else the tab's. */
  readonly agent?: unknown
  /** The agent's model, by its value or its name. It needs `agent`. Absent means the agent's default. */
  readonly model?: unknown
  /** The model's effort level. Absent means the tab's, on the tab's agent, else the model's default. */
  readonly effort?: unknown
  /** A JSON schema the reply follows. The run then gives the parsed JSON, not text. */
  readonly schema?: unknown
}

/** A run a plugin started: the reply it waits for, and a way to stop it. */
export interface PluginRun {
  /** The agent's final reply: its text, or its JSON for a run with a schema. It rejects when the run fails or is stopped. */
  readonly done: Promise<unknown>
  /** Stops the run, which then rejects. */
  stop(): void
  /** Ends the run at once, for a plugin that stopped. Its reply never comes. */
  close(): void
}

/**
 * Runs a plugin's prompt in the tab's folder, in a session no thread shows, on the agent and model the
 * plugin names, else the tab's. It runs in Supervised, where the agent asks before it edits a file or
 * runs a command that may change something. Nobody sees its requests, so each is declined. The agent may
 * still read files and run commands it treats as read-only, such as `git diff`, without asking.
 */
export function runForPlugin(agents: Pick<Agents, "get" | "info">, tab: TabInfo, prompt: string, options: RunOptions = {}): PluginRun {
  if (!prompt.trim()) throw new Error("A plugin's run needs a prompt. It cannot be empty.")
  const { agent: named, model: asked, effort: askedEffort, schema } = options
  if (named !== undefined && !AGENTS.includes(named as AgentId)) throw new Error(`Comet runs no agent called "${String(named)}". Its agents are: ${AGENTS.join(", ")}.`)
  if (asked !== undefined && named === undefined) throw new Error("A run names a model only with its agent, since each agent names its models its own way.")
  if (schema !== undefined && (typeof schema !== "object" || schema === null || Array.isArray(schema))) throw new Error("A run's schema must be a JSON schema object.")

  const id = (named as AgentId | undefined) ?? tab.agent
  const info = agents.info(id)
  if (!info) throw new Error(`Comet runs no agent called "${id}".`)
  const reason = notReady(info)
  if (reason) throw new Error(`${reason} Set it up in Settings, under Providers.`)
  const agent = agents.get(id)
  if (schema !== undefined) requireFeature(agent, "structured-output", "give a reply that follows a JSON schema")

  // On the tab's agent, the run takes the tab's model, effort and fast mode, unless the plugin names an effort.
  const ownAgent = named === undefined
  const model = ownAgent ? tab.model : chosenModel(info, asked).value
  const effort = askedEffort !== undefined ? chosenEffort(info, chosenModel(info, model), askedEffort) : ownAgent ? tab.effort : undefined
  const settings: RunSettings = { agent: id, model, ...(effort ? { effort } : {}), ...(ownAgent && tab.fast ? { fast: true } : {}), permissionMode: "default" }

  const task = startTask(agent, tab.project, { settings, ...(schema ? { outputSchema: schema as Record<string, unknown> } : {}) }, prompt, {
    request: (item, session) => {
      if (item.answered) return
      if (item.type === "permission") session.answerPermission(item.requestId, "decline")
      else session.answerQuestion(item.requestId, undefined)
    },
  })
  return { done: task.done.then((outcome) => replyOf(outcome, schema !== undefined)), stop: task.stop, close: () => task.session.close() }
}

/** The reply a completed run gives, its JSON for a run with a schema, else why there is none. */
function replyOf(outcome: TaskOutcome, structured: boolean): unknown {
  if (outcome.status === "stopped") throw new Error("The run was stopped before it finished.")
  if (outcome.status === "failed") throw new Error(outcome.error ? `The run failed: ${outcome.error}` : "The run ended without an answer.")
  if (!structured) return outcome.answer
  if (outcome.output === undefined) throw new Error("The agent's reply did not follow the run's schema.")
  return outcome.output
}
