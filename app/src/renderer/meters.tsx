import type { PlanUsage, UsageWindow } from "@desk/protocol"
import { Popover } from "@opencode/ui/popover"
import { Progress } from "@opencode/ui/progress"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, For, Show } from "solid-js"
import { Icon } from "./icons"

const NUMBER = new Intl.NumberFormat("en")
const DAY_MS = 24 * 60 * 60 * 1000

/** The title bar's plan usage: the fullest window as a small meter, every window in a popover. */
export function UsageButton(props: { usage: PlanUsage }) {
  const [open, setOpen] = createSignal(false)
  const fullest = () => props.usage.windows.reduce((a, b) => (b.percent > a.percent ? b : a))

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      gutter={8}
      class="desk-no-drag w-[280px] max-w-none"
      triggerAs="button"
      triggerProps={{
        class: "desk-no-drag flex h-[30px] items-center gap-[7px] rounded-lg px-[9px] text-[12px] tabular-nums text-fg-2 hover:bg-hover hover:text-fg",
        classList: { "bg-hover text-fg": open() },
      }}
      trigger={
        <>
          <Icon name="gauge" />
          <Progress value={fullest().percent} class="w-[26px] [&_[data-slot=progress-track]]:h-[5px]" aria-label="Plan usage" />
          {Math.round(fullest().percent)}%
        </>
      }
    >
      <div class="grid gap-3">
        <h4 class="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-3">Claude plan usage</h4>
        <For each={props.usage.windows}>{(window) => <UsageRow window={window} />}</For>
      </div>
    </Popover>
  )
}

function UsageRow(props: { window: UsageWindow }) {
  return (
    <div class="grid gap-[5px]">
      <Progress value={props.window.percent} showValueLabel getValueLabel={({ value }) => `${Math.round(value)}%`}>
        {props.window.label}
      </Progress>
      <Show when={props.window.resetsAt}>{(at) => <small class="text-[12px] text-fg-3">{resetLabel(at())}</small>}</Show>
    </div>
  )
}

/** "Resets in 2 h 14 min" within a day, else "Resets Thursday 09:00". */
function resetLabel(iso: string) {
  const at = new Date(iso)
  const left = at.getTime() - Date.now()
  if (left <= 0) return "Resets now"
  if (left < DAY_MS) {
    const minutes = Math.round(left / 60_000)
    return minutes < 60 ? `Resets in ${minutes} min` : `Resets in ${Math.floor(minutes / 60)} h ${minutes % 60} min`
  }
  return `Resets ${at.toLocaleDateString("en", { weekday: "long" })} ${at.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false })}`
}

/** How full the session's context window is, as a ring and a percentage. */
export function ContextRing(props: { percent: number; tokens: number; maxTokens: number }) {
  return (
    <Tooltip value={`${NUMBER.format(props.tokens)} of ${NUMBER.format(props.maxTokens)} tokens in context`} placement="bottom">
      <span class="flex items-center gap-1.5 px-1.5 tabular-nums text-fg-2">
        <ProgressCircle percentage={props.percent} size={15} strokeWidth={2} />
        {Math.round(props.percent)}%
      </span>
    </Tooltip>
  )
}
