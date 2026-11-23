import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { BackgroundTask, ThreadEvent } from "@comet/protocol"
import { isSubagentTask } from "./subagents"

/**
 * The commands a session runs in the background. Claude Code sends the whole set of live tasks each
 * time it changes, so the set is replaced, never patched. Housekeeping tasks it marks ambient stay out,
 * as it asks. Subagents have their own card, so they stay out too. Each task keeps the time Comet first
 * saw it, so its timer does not restart. A command's description is the one the Bash tool call gave,
 * not the command. The label keeps its first line, since the card draws one line per task.
 */
export class BackgroundTasks {
  private tasks: BackgroundTask[] = []

  constructor(private readonly emit: (event: ThreadEvent) => void) {}

  handle(message: SDKMessage, now = Date.now()) {
    if (message.type !== "system" || message.subtype !== "background_tasks_changed") return
    const seen = new Map(this.tasks.map((task) => [task.id, task.startedAt]))
    this.tasks = message.tasks
      .filter((task) => !task.ambient && !isSubagentTask(task.task_type))
      .map((task) => ({ id: task.task_id, label: firstLine(task.description), startedAt: seen.get(task.task_id) ?? now }))
    this.emit({ kind: "background", tasks: this.tasks })
  }

  /** Whether a command runs in the background. */
  get running() {
    return this.tasks.length > 0
  }

  /** Empties the list once Claude Code's process is gone, since its commands end with it. */
  clear() {
    if (!this.tasks.length) return
    this.tasks = []
    this.emit({ kind: "background", tasks: this.tasks })
  }
}

function firstLine(text: string) {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? ""
}
