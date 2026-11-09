import type { Effort, ModelOption } from "@desk/protocol"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { modelLabel } from "./format"
import { Icon } from "./icons"
import { createPopover, PopoverPanel } from "./popover"
import { chooseModel, state, type Tab } from "./store"

const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }

/**
 * Aliases such as "opus" follow the newest model of a family, so they lead the list. Pinned
 * models, such as "claude-opus-4-8", wait behind "Show older models".
 */
const isAlias = (option: ModelOption) => !option.value.startsWith("claude-")

/** Claude's starburst mark: eight lines through the centre make sixteen rays. */
function ClaudeMark() {
  return (
    <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-claude" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true">
      <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2M5.3 1.9l5.4 12.2M10.7 1.9 5.3 14.1M1.9 5.3l12.2 5.4M14.1 5.3 1.9 10.7" />
    </svg>
  )
}

/**
 * The composer's model button. The popover sets the model on the left and its effort on the
 * right. The button names the model that runs, so "Default" reads as "Opus 5.5".
 */
export function ModelPicker(props: { tab: Tab }) {
  const popover = createPopover({ width: 520, maxHeight: 420, align: "end", side: "above" })
  const [showAll, setShowAll] = createSignal(false)
  let button!: HTMLButtonElement

  const selected = () => state.models.find((option) => option.value === props.tab.model)
  const label = (option: ModelOption | undefined) => (option?.resolvedModel ? modelLabel(option.resolvedModel) : option?.label)
  const aliases = createMemo(() => state.models.filter(isAlias))
  const shown = () => (showAll() ? state.models : aliases())

  const toggle = () => {
    // A pinned model is only visible with the full list, so choosing one opens it that way.
    const current = selected()
    setShowAll(!!current && !isAlias(current))
    popover.toggle(button)
  }

  // An effort the new model does not take falls back to the model's default.
  const pickModel = (option: ModelOption) => chooseModel(option.value, props.tab.effort && option.efforts.includes(props.tab.effort) ? props.tab.effort : undefined)

  // ⌘1–⌘9 pick an alias while the popover is open.
  const onKey = (event: KeyboardEvent) => {
    if (!popover.isOpen() || !event.metaKey || !/^[1-9]$/.test(event.key)) return
    const option = aliases()[Number(event.key) - 1]
    if (!option) return
    event.preventDefault()
    event.stopPropagation()
    pickModel(option)
  }
  document.addEventListener("keydown", onKey, true)
  onCleanup(() => document.removeEventListener("keydown", onKey, true))

  return (
    <div class="ml-auto" onClick={(event) => event.stopPropagation()}>
      <button
        ref={button}
        type="button"
        class="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] hover:bg-hover"
        classList={{ "bg-hover": popover.isOpen() }}
        aria-haspopup="dialog"
        aria-expanded={popover.isOpen()}
        onClick={toggle}
      >
        <ClaudeMark />
        <span class="text-fg">{label(selected()) ?? (props.tab.resolvedModel ? modelLabel(props.tab.resolvedModel) : "Claude Code")}</span>
        <Show when={props.tab.effort}>{(effort) => <span class="text-fg-3">{EFFORT_LABEL[effort()]}</span>}</Show>
        <Icon name="down" class="size-3 text-fg-3" />
      </button>
      <PopoverPanel popover={popover} label="Model and effort" class="grid grid-cols-[minmax(0,1fr)_minmax(0,168px)]">
        <div class="flex min-h-0 flex-col">
          <div class="flex h-9 shrink-0 items-center px-3.5 pt-1.5 text-[12px] text-fg-3">Model</div>
          <div class="desk-no-scrollbar grid min-h-0 content-start gap-px overflow-y-auto p-1.5">
            <For each={shown()} fallback={<div class="px-2.5 py-2 text-fg-3">Loading models…</div>}>
              {(option) => {
                const shortcut = () => aliases().indexOf(option)
                return (
                  <button
                    type="button"
                    class="flex h-9 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-hover"
                    aria-pressed={option.value === props.tab.model}
                    title={option.description}
                    onClick={() => pickModel(option)}
                  >
                    <span class="shrink-0 text-fg">{option.label}</span>
                    <span class="min-w-0 flex-1 truncate text-[12px] text-fg-3">{option.description}</span>
                    <Show when={option.value === props.tab.model}>
                      <Icon name="check" class="size-[15px] shrink-0 text-fg" />
                    </Show>
                    <Show when={shortcut() >= 0 && shortcut() < 9}>
                      <kbd class="shrink-0 font-sans text-[11px] text-fg-3">⌘{shortcut() + 1}</kbd>
                    </Show>
                  </button>
                )
              }}
            </For>
            <Show when={!showAll() && state.models.length > aliases().length}>
              <button type="button" class="flex h-9 items-center rounded-lg px-2.5 text-left text-fg-3 hover:text-fg-2" onClick={() => setShowAll(true)}>
                Show older models
              </button>
            </Show>
          </div>
        </div>
        <div class="flex min-h-0 flex-col border-l border-outline">
          <div class="flex h-9 shrink-0 items-center justify-between gap-2 px-3.5 pt-1.5 text-[12px] text-fg-3">
            Effort
            <span class="truncate">{label(selected())}</span>
          </div>
          <div class="desk-no-scrollbar grid min-h-0 content-start gap-px overflow-y-auto p-1.5">
            <Show when={selected()?.efforts.length} fallback={<div class="px-2 py-2 text-[12px] text-fg-3">This model has no effort levels.</div>}>
              <For each={[undefined, ...selected()!.efforts]}>
                {(effort) => (
                  <button
                    type="button"
                    class="flex h-9 items-center justify-between rounded-lg px-2.5 text-left hover:bg-hover"
                    classList={{ "text-fg": effort === props.tab.effort, "text-fg-2": effort !== props.tab.effort }}
                    aria-pressed={effort === props.tab.effort}
                    onClick={() => chooseModel(props.tab.model, effort)}
                  >
                    {effort ? EFFORT_LABEL[effort] : "Default"}
                    <Show when={effort === props.tab.effort}>
                      <Icon name="check" class="size-[15px] text-fg" />
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </PopoverPanel>
    </div>
  )
}
