import type { TabInfo } from "@desk/protocol"
import { Button } from "@opencode/ui/button"
import { Tooltip } from "@opencode/ui/tooltip"
import { For, Show } from "solid-js"
import { now } from "./clock"
import { formatDuration, plural } from "./format"
import { Icon } from "./icons"
import { stopTasks, threadOf } from "./threads"

/**
 * The commands Claude left running in the background, above the composer, after T3 Code: what runs, as
 * Claude described it, for how long, and a Stop for all of it. "Waiting" means the turn has ended and Claude picks up again
 * when a command finishes. The full commands show on hover.
 */
export function BackgroundRow(props: { tab: TabInfo }) {
  const tasks = () => threadOf(props.tab.id).background ?? []
  const state = () => (threadOf(props.tab.id).busy ? "Running" : "Waiting")
  const only = () => (tasks().length === 1 ? tasks()[0] : undefined)
  return (
    <Show when={tasks().length}>
      <div class="mb-2 flex min-w-0 items-center gap-2 px-1 text-[13px] text-fg-3" aria-label="Background commands">
        <Icon name="outline-console" class="size-[14px] shrink-0" />
        <Tooltip value={<span class="whitespace-pre-wrap">{tasks().map((task) => task.label).join("\n")}</span>} placement="top" class="min-w-0 flex-1">
          <span class="block min-w-0 truncate">
            <Show when={only()} fallback={`${state()} · ${plural(tasks().length, "background command")}: ${tasks().map((task) => task.label).join(", ")}`}>
              {(task) => (
                <>
                  {state()} · {task().label}
                </>
              )}
            </Show>
          </span>
        </Tooltip>
        <Show when={only()}>{(task) => <span class="shrink-0 tabular-nums">{formatDuration(Math.max(0, now() - task().startedAt))}</span>}</Show>
        <Button size="small" variant="ghost" class="shrink-0" onClick={() => stopTasks(props.tab.id, tasks().map((task) => task.id))}>
          Stop
        </Button>
      </div>
    </Show>
  )
}
