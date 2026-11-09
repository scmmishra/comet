import type { Effort, ModelOption, PermissionMode } from "@desk/protocol"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { modelLabel } from "./format"
import { Icon, type IconName } from "./icons"
import { createPopover, PopoverPanel } from "./popover"
import { state, updateRunSettings, type Tab } from "./store"

const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }

/** Permission modes, in T3 Code's words and order. */
const PERMISSION: Record<PermissionMode, { label: string; description: string; icon: IconName }> = {
  default: { label: "Supervised", description: "Asks before commands and file changes.", icon: "lock" },
  acceptEdits: { label: "Auto-accept edits", description: "Makes edits, and asks before anything else.", icon: "edit" },
  auto: { label: "Auto", description: "Approves routine actions, asks about the rest.", icon: "sparkle" },
  bypassPermissions: { label: "Full access", description: "Edits and runs commands without asking.", icon: "shieldOff" },
}
const PERMISSION_MODES = Object.keys(PERMISSION) as PermissionMode[]

/**
 * ⌘1–⌘9 belong to the app menu, which switches tabs, and macOS hands menu shortcuts the key before
 * the page. While the picker is open, the menu's command asks it first.
 */
let pickByNumber: ((index: number) => boolean) | undefined
export const pickModelByNumber = (index: number) => pickByNumber?.(index) ?? false

/**
 * Aliases such as "opus" follow the newest model of a family, so they lead the list. Pinned
 * models, such as "claude-opus-4-8", wait behind "Show older models".
 */
const isAlias = (option: ModelOption) => !option.value.startsWith("claude-")

/**
 * Claude's starburst mark: eight lines through the centre make sixteen rays. In fast mode a solid
 * bolt sits on its bottom-right corner.
 */
function ClaudeMark(props: { fast?: boolean }) {
  return (
    <span class="relative shrink-0">
      <svg viewBox="0 0 16 16" class="size-4 text-claude" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true">
        <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2M5.3 1.9l5.4 12.2M10.7 1.9 5.3 14.1M1.9 5.3l12.2 5.4M14.1 5.3 1.9 10.7" />
      </svg>
      <Show when={props.fast}>
        {/* The card colour outlines the bolt, so it reads on top of the rays. */}
        <svg viewBox="0 0 16 16" class="absolute -bottom-1 -right-1 size-[11px] text-fast" aria-label="Fast">
          <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" fill="currentColor" stroke="var(--color-card)" stroke-width="2" stroke-linejoin="round" paint-order="stroke" />
        </svg>
      </Show>
    </span>
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
    setChoosingMode(false)
    popover.toggle(button)
  }

  // What the new model does not take falls back: its default effort, standard speed, Supervised.
  const pickModel = (option: ModelOption) =>
    updateRunSettings({
      model: option.value,
      effort: props.tab.effort && option.efforts.includes(props.tab.effort) ? props.tab.effort : undefined,
      fast: option.fast && props.tab.fast,
      permissionMode: props.tab.permissionMode === "auto" && !option.autoMode ? "default" : props.tab.permissionMode,
    })
  const modes = () => PERMISSION_MODES.filter((mode) => mode !== "auto" || selected()?.autoMode)
  const [choosingMode, setChoosingMode] = createSignal(false)

  // ⌘1–⌘9 pick an alias while the popover is open.
  const pickNumber = (index: number) => {
    const option = aliases()[index]
    if (option) pickModel(option)
    return !!option
  }
  createEffect(() => {
    if (popover.isOpen()) pickByNumber = pickNumber
    else if (pickByNumber === pickNumber) pickByNumber = undefined
  })
  onCleanup(() => pickByNumber === pickNumber && (pickByNumber = undefined))

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
        <ClaudeMark fast={props.tab.fast} />
        <span class="text-fg">{label(selected()) ?? (props.tab.resolvedModel ? modelLabel(props.tab.resolvedModel) : "Claude Code")}</span>
        {/* The effort that will run: the tab's choice, or the model's default. */}
        <Show when={props.tab.effort ?? selected()?.defaultEffort}>{(effort) => <span class="text-fg-3">{EFFORT_LABEL[effort()]}</span>}</Show>
        {/* Supervised is the plain case. Any other mode shows, so a thread never runs looser than you think. */}
        <Show when={props.tab.permissionMode !== "default"}>
          <span class="text-fg-3">·</span>
          <span class="text-fg-3">{PERMISSION[props.tab.permissionMode].label}</span>
        </Show>
        <Icon name="down" class="size-3 text-fg-3" />
      </button>
      <PopoverPanel popover={popover} label="Model and effort" class="grid grid-cols-[minmax(0,1fr)_minmax(0,168px)] grid-rows-[minmax(0,1fr)_auto]">
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
                    onClick={() => updateRunSettings({ effort })}
                  >
                    <span>
                      {effort ? EFFORT_LABEL[effort] : "Default"}
                      <Show when={!effort && selected()?.defaultEffort}>{(level) => <span class="ml-1.5 text-fg-3">{EFFORT_LABEL[level()]}</span>}</Show>
                    </span>
                    <Show when={effort === props.tab.effort}>
                      <Icon name="check" class="size-[15px] text-fg" />
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
        {/* The mode list floats over the columns above its button, so opening it moves nothing. */}
        <Show when={choosingMode()}>
          <div class="desk-pop desk-pop-up absolute bottom-[50px] right-1.5 z-10 grid w-[min(320px,calc(100%-12px))] gap-px rounded-xl border border-outline bg-raised p-1.5 shadow-[0_12px_32px_rgb(0_0_0/45%)]" style={{ "transform-origin": "bottom right" }}>
            <For each={modes()}>
              {(mode) => (
                <button
                  type="button"
                  class="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 rounded-lg px-2.5 py-[7px] text-left hover:bg-hover"
                  aria-pressed={mode === props.tab.permissionMode}
                  onClick={() => {
                    updateRunSettings({ permissionMode: mode })
                    setChoosingMode(false)
                  }}
                >
                  <Icon name={PERMISSION[mode].icon} class="size-[15px] text-fg-2" />
                  <span class="min-w-0">
                    <span class="block text-fg">{PERMISSION[mode].label}</span>
                    <span class="block truncate text-[12px] text-fg-3">{PERMISSION[mode].description}</span>
                  </span>
                  <Show when={mode === props.tab.permissionMode}>
                    <Icon name="check" class="size-[15px] text-fg" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="col-span-2 flex items-center justify-between gap-2 border-t border-outline p-1.5">
          {/* Fast mode is only offered on a model that has it. */}
          <Show when={selected()?.fast} fallback={<span />}>
            <div class="flex rounded-lg bg-panel p-0.5 text-[12px]">
              <For each={[false, true]}>
                {(fast) => (
                  <button
                    type="button"
                    class="flex h-7 items-center gap-1.5 rounded-md px-2.5"
                    classList={{ "bg-hover text-fg": fast === !!props.tab.fast, "text-fg-3 hover:text-fg-2": fast !== !!props.tab.fast }}
                    aria-pressed={fast === !!props.tab.fast}
                    onClick={() => updateRunSettings({ fast })}
                  >
                    <Show when={fast}>
                      <Icon name="bolt" class="size-[13px]" />
                    </Show>
                    {fast ? "Fast" : "Standard"}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <button
            type="button"
            class="flex h-8 items-center gap-2 rounded-lg px-2.5 text-fg-2 hover:bg-hover hover:text-fg"
            classList={{ "bg-hover text-fg": choosingMode() }}
            aria-expanded={choosingMode()}
            onClick={() => setChoosingMode(!choosingMode())}
          >
            <Icon name={PERMISSION[props.tab.permissionMode].icon} class="size-[15px]" />
            {PERMISSION[props.tab.permissionMode].label}
            <Icon name="down" class="size-3 text-fg-3 transition-transform duration-150" classList={{ "rotate-180": choosingMode() }} />
          </button>
        </div>
      </PopoverPanel>
    </div>
  )
}
