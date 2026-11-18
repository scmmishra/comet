import type { ThreadEvent } from "@comet/protocol"
import { expect, test } from "bun:test"
import { BackgroundTasks } from "./background-tasks"

const changed = (tasks: object[]) => ({ type: "system", subtype: "background_tasks_changed", tasks, uuid: "u", session_id: "s" }) as never

test("keeps the live background commands, leaving out subagents and housekeeping, and keeps each one's start", () => {
  const events: ThreadEvent[] = []
  const tasks = new BackgroundTasks((event) => events.push(event))
  tasks.handle(changed([
    { task_id: "b1", task_type: "local_bash", description: "clueless review --pr 16542" },
    { task_id: "a1", task_type: "local_agent", description: "Explore the importer" },
    { task_id: "w1", task_type: "monitor", description: "watch", ambient: true },
  ]), 1000)
  expect(events.at(-1)).toEqual({ kind: "background", tasks: [{ id: "b1", label: "clueless review --pr 16542", startedAt: 1000 }] })

  tasks.handle(changed([
    { task_id: "b1", task_type: "local_bash", description: "clueless review --pr 16542" },
    { task_id: "b2", task_type: "local_bash", description: "npm run dev" },
  ]), 5000)
  expect(events.at(-1)).toEqual({ kind: "background", tasks: [{ id: "b1", label: "clueless review --pr 16542", startedAt: 1000 }, { id: "b2", label: "npm run dev", startedAt: 5000 }] })

  tasks.handle(changed([]), 9000)
  expect(events.at(-1)).toEqual({ kind: "background", tasks: [] })
})

test("labels a multi-line command by its first line", () => {
  const events: ThreadEvent[] = []
  const tasks = new BackgroundTasks((event) => events.push(event))
  tasks.handle(changed([{ task_id: "b1", task_type: "local_bash", description: "\n  mkdir -p /tmp/clueless && cd /tmp/clueless\nclueless review --pr 16542\n" }]), 1000)
  expect(events.at(-1)).toEqual({ kind: "background", tasks: [{ id: "b1", label: "mkdir -p /tmp/clueless && cd /tmp/clueless", startedAt: 1000 }] })
})
