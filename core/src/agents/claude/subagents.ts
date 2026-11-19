import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { Subagent, ThreadEvent, ThreadItem } from "@comet/protocol"
import { ThreadMapper } from "./thread"

/** Claude Code's task type for a subagent. Its other tasks, such as background shells, are not agents. */
const AGENT_TASK = "local_agent"
export const isSubagentTask = (taskType: string | undefined) => taskType === AGENT_TASK

/** `runId` is Claude Code's id for the subagent's latest run. A resumed subagent gets a new one. */
type Tracked = { subagent: Subagent; runId?: string; mapper: ThreadMapper; items: Map<string, ThreadItem> }

/**
 * The subagents a session's turns start. Claude Code reports each one as a task, and forwards its
 * messages tagged with the tool call that started or resumed it. Both become one Subagent, which this sends whole
 * on each change. The thread itself never shows a subagent's steps.
 */
export class Subagents {
  private readonly byTask = new Map<string, Tracked>()
  private readonly taskByTool = new Map<string, string>()

  constructor(
    private readonly dir: string,
    private readonly emit: (event: ThreadEvent) => void,
  ) {}

  handle(message: SDKMessage, now = Date.now()) {
    if (message.type === "system") return this.handleTask(message, now)
    if ((message.type === "assistant" || message.type === "user") && message.parent_tool_use_id) {
      const tracked = this.byTask.get(this.taskByTool.get(message.parent_tool_use_id) ?? "")
      if (!tracked) return
      // The subagent's own mapper reads its messages as a thread of their own.
      for (const event of tracked.mapper.map({ ...message, parent_tool_use_id: null } as SDKMessage, now)) {
        if (event.kind === "item") tracked.items.set(event.item.id, event.item)
        if (event.kind === "items.remove") for (const id of event.ids) tracked.items.delete(id)
      }
      this.update(tracked, { items: [...tracked.items.values()] })
    }
  }

  private handleTask(message: Extract<SDKMessage, { type: "system" }>, now: number) {
    if (message.subtype === "task_started") {
      if (!isSubagentTask(message.task_type) || message.ambient) return
      if (message.tool_use_id) this.taskByTool.set(message.tool_use_id, message.task_id)
      const known = this.byTask.get(message.task_id)
      const run = {
        description: message.description,
        ...(message.subagent_type ? { type: message.subagent_type } : {}),
        status: "running",
        background: !!message.is_backgrounded,
      } as const
      // Claude Code resumes a subagent with a new task_started under the same task id, from a new tool call.
      // The subagent keeps its steps, its prompt, its start and its last summary, and runs again.
      if (known) {
        known.runId = message.run_id
        const { endedAt: _, ...open } = known.subagent
        known.subagent = open
        return this.update(known, run)
      }
      const subagent: Subagent = { id: message.task_id, ...run, startedAt: now, ...(message.prompt ? { prompt: message.prompt } : {}), toolUses: 0, items: [] }
      this.byTask.set(message.task_id, { subagent, runId: message.run_id, mapper: new ThreadMapper(this.dir), items: new Map() })
      return this.emit({ kind: "subagent", subagent })
    }
    const tracked = "task_id" in message ? this.byTask.get(message.task_id as string) : undefined
    if (!tracked || isLate(tracked, message)) return
    if (message.subtype === "task_progress") {
      return this.update(tracked, { toolUses: message.usage.tool_uses, ...(message.summary ? { summary: message.summary } : {}) })
    }
    if (message.subtype === "task_updated") {
      const status = message.patch.status
      const ended = status === "completed" || status === "failed" || status === "killed"
      return this.update(tracked, {
        ...(ended ? { status: status === "killed" ? "stopped" : status, endedAt: message.patch.end_time ?? now } : {}),
        ...(message.patch.description ? { description: message.patch.description } : {}),
        ...(message.patch.is_backgrounded !== undefined ? { background: message.patch.is_backgrounded } : {}),
      })
    }
    if (message.subtype === "task_notification") {
      return this.update(tracked, {
        status: message.status,
        endedAt: tracked.subagent.endedAt ?? now,
        ...(message.summary ? { summary: message.summary } : {}),
        ...(message.usage ? { toolUses: message.usage.tool_uses } : {}),
      })
    }
  }

  /**
   * Ends the subagents still running as stopped, after T3 Code, once Claude Code's process is gone. They
   * end with it and never report it. The next process starts subagents of its own.
   */
  stopRunning(now = Date.now()) {
    for (const tracked of this.byTask.values()) {
      if (tracked.subagent.status === "running") this.update(tracked, { status: "stopped", endedAt: now })
    }
    this.byTask.clear()
    this.taskByTool.clear()
  }

  private update(tracked: Tracked, change: Partial<Subagent>) {
    tracked.subagent = { ...tracked.subagent, ...change }
    this.emit({ kind: "subagent", subagent: tracked.subagent })
  }
}

/**
 * Whether a task frame comes from a run before the latest. Claude Code's run ids of one task sort in the
 * order the runs opened. So a late end of the first run does not end the resumed one.
 */
function isLate(tracked: Tracked, message: object) {
  const runId = "run_id" in message ? (message.run_id as string | undefined) : undefined
  return !!runId && !!tracked.runId && runId < tracked.runId
}
