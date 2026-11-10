import type { TabInfo } from "@desk/protocol"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Icon } from "./icons"
import {
  currentIndex,
  EXPANDED_HIT_STRIP,
  hitStripWidth,
  markAt,
  markTop,
  minimapItems,
  MINIMAP_MIN_ITEMS,
  NAVIGATION_REACH_PX,
  PERSISTENT_GUTTER_PX,
  railHeight,
} from "./minimap-items"
import { threadOf } from "./threads"

/** How far a jump to a message stops short of it, so the message is not flush with the top. */
const JUMP_MARGIN_PX = 12

/**
 * The thread's minimap, a port of T3 Code's: a mark per message the user sent, evenly spaced down a rail
 * in the thread's left gutter. A mark is darker while its turn is on screen. Marks near the pointer grow,
 * the nearest previews the message and the start of Claude's answer, and a click jumps to it. Previous
 * and next step from the turn being read. A wide gutter shows the minimap all the time, and a narrow one
 * on hover. `box` is the thread's scroll area, and each message's row carries its id as `data-message`.
 */
export function ThreadMinimap(props: { tab: TabInfo; box: HTMLDivElement }) {
  const items = createMemo(() => minimapItems(threadOf(props.tab.id).items))
  const [active, setActive] = createSignal<number>()
  const [inView, setInView] = createSignal(new Set<string>())
  const [reading, setReading] = createSignal<number>()
  const [gutter, setGutter] = createSignal(0)

  const row = (id: string) => props.box.querySelector<HTMLElement>(`[data-message="${CSS.escape(id)}"]`)

  // Reads, from the rows' places, which turns are on screen, which one is being read, and how wide the gutter is.
  const measure = () => {
    const view = props.box.getBoundingClientRect()
    const tops = items().map((item) => row(item.id)?.getBoundingClientRect().top ?? Infinity)
    const end = view.top + props.box.scrollHeight - props.box.scrollTop
    setInView(new Set(items().filter((_, index) => tops[index]! < view.bottom && (tops[index + 1] ?? end) > view.top).map((item) => item.id)))
    setReading(currentIndex(tops, view.top, view.bottom))
    const lane = props.box.querySelector(".desk-lane")
    setGutter(lane ? lane.getBoundingClientRect().left - view.left : 0)
  }
  onMount(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    props.box.addEventListener("scroll", schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(props.box)
    if (props.box.firstElementChild) resize.observe(props.box.firstElementChild)
    schedule()
    onCleanup(() => {
      props.box.removeEventListener("scroll", schedule)
      resize.disconnect()
      cancelAnimationFrame(frame)
    })
  })

  const jumpTo = (index: number | undefined) => {
    const target = index === undefined ? undefined : items()[index] && row(items()[index]!.id)
    if (!target) return
    const top = target.getBoundingClientRect().top - props.box.getBoundingClientRect().top + props.box.scrollTop
    props.box.scrollTo({ top: top - JUMP_MARGIN_PX })
  }
  const indexAt = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return markAt((event.clientY - rect.top) / rect.height, items().length)
  }
  const strip = () => hitStripWidth(gutter())
  const persistent = () => gutter() >= PERSISTENT_GUTTER_PX
  const preview = () => (active() === undefined ? undefined : items()[active()!])
  // The first preview hangs down from its mark, the last up, and the rest centre on theirs.
  const previewShift = () => (active() === 0 ? "0%" : active() === items().length - 1 ? "-100%" : "-50%")

  return (
    <Show when={items().length >= MINIMAP_MIN_ITEMS}>
      <div
        class="group/minimap pointer-events-none absolute inset-y-0 left-0 z-40 w-18"
        classList={{ "opacity-100": persistent(), "opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100": !persistent() }}
        // A wheel over the minimap scrolls the thread, as over the thread itself.
        onWheel={(event) => props.box.scrollBy({ top: event.deltaY })}
      >
        <div class="relative h-full w-full select-none">
          <div
            class="absolute left-3 top-1/2 -translate-y-1/2"
            classList={{ "pointer-events-auto": strip() > 0, "pointer-events-none": strip() === 0 }}
            style={{ height: railHeight(items().length), width: preview() ? EXPANDED_HIT_STRIP : `${strip()}px` }}
          >
            <TurnButton direction="previous" disabled={reading() === undefined || reading() === 0} interactive={strip() >= NAVIGATION_REACH_PX} onClick={() => jumpTo(reading()! - 1)} />
            <button
              aria-label={`Jump to message: ${preview()?.text ?? "User message"}`}
              class="absolute inset-y-0 left-0 w-full cursor-pointer bg-transparent focus-visible:outline-none"
              onBlur={() => setActive(undefined)}
              onFocus={() => setActive((current) => current ?? reading() ?? 0)}
              onMouseLeave={() => setActive(undefined)}
              onMouseMove={(event) => setActive(indexAt(event))}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                jumpTo(indexAt(event))
                event.currentTarget.blur()
              }}
              onKeyDown={(event) => {
                const last = items().length - 1
                const move = { ArrowDown: 1, ArrowUp: -1 }[event.key as "ArrowDown" | "ArrowUp"]
                if (move) setActive((current) => Math.max(0, Math.min(last, (current ?? 0) + move)))
                else if (event.key === "Home") setActive(0)
                else if (event.key === "End") setActive(last)
                else if (event.key === "Enter" || event.key === " ") jumpTo(active())
                else return
                event.preventDefault()
              }}
              type="button"
            >
              <div class="absolute left-3 top-0 h-full w-px bg-[var(--color-line)]/15" />
              <For each={items()}>
                {(item, index) => {
                  const distance = () => (active() === undefined ? undefined : Math.abs(index() - active()!))
                  return (
                    <span
                      aria-hidden="true"
                      // A mark's turn on screen darkens it through an overlay, and the marks near the pointer grow.
                      class="pointer-events-none absolute left-0 h-0.5 w-6 origin-left -translate-y-1/2 rounded-full transition-transform duration-150 after:absolute after:inset-0 after:rounded-full after:bg-fg/55 after:opacity-0 after:transition-opacity after:duration-150 data-[in-view=true]:after:opacity-100"
                      classList={{ "bg-fg-3/60": distance() === 0, "bg-fg-3/25": distance() !== 0 }}
                      data-in-view={inView().has(item.id) ? "true" : "false"}
                      style={{ top: `${markTop(index(), items().length)}%`, scale: `${[1, 0.667, 0.417][distance() ?? 3] ?? 0.333} 1` }}
                    />
                  )
                }}
              </For>
              <Show when={preview()}>
                {(item) => (
                  <span class="pointer-events-auto absolute left-8 w-80 cursor-text select-text" style={{ top: `${markTop(active()!, items().length)}%`, transform: `translateY(${previewShift()})` }} onMouseMove={(event) => event.stopPropagation()}>
                    <span class="block rounded-xl bg-card/95 p-3 text-left shadow-xl shadow-black/25 backdrop-blur">
                      <span class="block max-w-full truncate text-[14px] font-medium leading-5 text-fg">{item().text}</span>
                      <Show when={item().answer}>{(answer) => <span class="mt-1 line-clamp-3 max-h-[60px] overflow-hidden text-[14px] leading-5 text-fg-3">{answer()}</span>}</Show>
                    </span>
                  </span>
                )}
              </Show>
            </button>
            <TurnButton direction="next" disabled={reading() === undefined || reading() === items().length - 1} interactive={strip() >= NAVIGATION_REACH_PX} onClick={() => jumpTo(reading()! + 1)} />
          </div>
        </div>
      </div>
    </Show>
  )
}

/** Steps to the turn before or after the one being read. It shows when the rail is hovered. */
function TurnButton(props: { direction: "previous" | "next"; disabled: boolean; interactive: boolean; onClick: () => void }) {
  const previous = () => props.direction === "previous"
  return (
    <Tooltip value={previous() ? "Previous turn" : "Next turn"} placement={previous() ? "top" : "bottom"}>
      <span
        class="absolute left-1 z-10 inline-flex -translate-x-1/2 opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100"
        classList={{ "pointer-events-auto": props.interactive, "pointer-events-none": !props.interactive, "bottom-[calc(100%+2px)]": previous(), "top-[calc(100%+2px)]": !previous() }}
      >
        <IconButton
          variant="ghost-muted"
          size="small"
          aria-label={previous() ? "Previous turn" : "Next turn"}
          disabled={props.disabled}
          onClick={props.onClick}
          icon={<Icon name="chevron-down" class={`size-4 text-fg/90 ${previous() ? "rotate-180" : ""}`} />}
        />
      </span>
    </Tooltip>
  )
}
