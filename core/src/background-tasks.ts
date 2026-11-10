import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { BackgroundTask, ThreadEvent } from "@desk/protocol"

/** Claude Code's task type for a subagent. Subagents have their own card, so they stay out of this list. */
const AGENT_TASK = "local_agent"

/**
 * The commands a session runs in the background. Claude Code sends the whole set of live tasks each
 * time it changes, so the set is replaced, never patched. Housekeeping tasks it marks ambient stay out,
 * as it asks. Each task keeps the time Desk first saw it, so its timer does not restart.
 */
export class BackgroundTasks {
  private tasks: BackgroundTask[] = []

  constructor(private readonly emit: (event: ThreadEvent) => void) {}

  handle(message: SDKMessage, now = Date.now()) {
    if (message.type !== "system" || message.subtype !== "background_tasks_changed") return
    const seen = new Map(this.tasks.map((task) => [task.id, task.startedAt]))
    this.tasks = message.tasks
      .filter((task) => !task.ambient && task.task_type !== AGENT_TASK)
      .map((task) => ({ id: task.task_id, label: task.description, startedAt: seen.get(task.task_id) ?? now }))
    this.emit({ kind: "background", tasks: this.tasks })
  }
}
