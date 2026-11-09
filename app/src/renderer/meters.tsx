import type { PlanUsage, UsageWindow } from "@desk/protocol"
import { createSignal, For, onCleanup, Show } from "solid-js"
import { Icon } from "./icons"

const NUMBER = new Intl.NumberFormat("en")
const RING_RADIUS = 6
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
const DAY_MS = 24 * 60 * 60 * 1000

/** The title bar's plan usage: the fullest window as a small meter, every window in a popover. */
export function UsageButton(props: { usage: PlanUsage }) {
  const [open, setOpen] = createSignal(false)
  const fullest = () => props.usage.windows.reduce((a, b) => (b.percent > a.percent ? b : a))
  let root!: HTMLDivElement

  const closeOutside = (event: MouseEvent) => {
    if (!root.contains(event.target as Node)) setOpen(false)
  }
  const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
  document.addEventListener("mousedown", closeOutside)
  document.addEventListener("keydown", closeOnEscape)
  onCleanup(() => {
    document.removeEventListener("mousedown", closeOutside)
    document.removeEventListener("keydown", closeOnEscape)
  })

  return (
    <div ref={root} class="desk-no-drag relative">
      <button
        class="flex h-[30px] items-center gap-[7px] rounded-lg px-[9px] text-[12px] tabular-nums text-fg-2 hover:bg-hover hover:text-fg"
        classList={{ "bg-hover text-fg": open() }}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <Icon name="gauge" />
        <span class="block h-[5px] w-[26px] shrink-0 overflow-hidden rounded-full bg-track">
          <span class="block h-full rounded-full bg-fg-2" style={{ width: `${fullest().percent}%` }} />
        </span>
        {Math.round(fullest().percent)}%
      </button>
      <Show when={open()}>
        <div class="desk-pop absolute right-0 top-[38px] z-30 grid w-[280px] gap-3 rounded-2xl border border-outline bg-raised p-3 shadow-[0_18px_40px_rgb(0_0_0/50%)]">
          <h4 class="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-3">Claude plan usage</h4>
          <For each={props.usage.windows}>{(window) => <UsageRow window={window} />}</For>
        </div>
      </Show>
    </div>
  )
}

function UsageRow(props: { window: UsageWindow }) {
  return (
    <div class="grid gap-[5px]">
      <div class="flex justify-between text-fg-2">
        <span>{props.window.label}</span>
        <b class="font-medium tabular-nums text-fg">{Math.round(props.window.percent)}%</b>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-track">
        <i class="block h-full rounded-full bg-accent" style={{ width: `${props.window.percent}%` }} />
      </div>
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
    <span
      class="flex items-center gap-1.5 px-1.5 tabular-nums text-fg-2"
      title={`${NUMBER.format(props.tokens)} of ${NUMBER.format(props.maxTokens)} tokens in context`}
    >
      <svg viewBox="0 0 16 16" class="size-[15px] -rotate-90">
        <circle cx="8" cy="8" r={RING_RADIUS} fill="none" stroke="var(--color-track)" stroke-width="2" />
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-fg-2)"
          stroke-width="2"
          stroke-dasharray={`${(RING_LENGTH * Math.min(props.percent, 100)) / 100} ${RING_LENGTH}`}
        />
      </svg>
      {Math.round(props.percent)}%
    </span>
  )
}
