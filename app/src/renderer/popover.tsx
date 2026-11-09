import { createSignal, onCleanup, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"

/** Room kept between a popover and the window's edges, and between it and its button. */
const EDGE_PX = 8
const GAP_PX = 8

export interface PopoverSize {
  readonly width: number
  readonly maxHeight: number
  /** Which edge of the button the popover lines up with. */
  readonly align: "start" | "end"
  /** The side it opens on when it fits there. It takes the roomier side when it does not. */
  readonly side: "above" | "below"
}

type Placement = { left: number; width: number; maxHeight: number; up: boolean; edge: number; origin: string }

/**
 * Where a popover fits: on its preferred side of the button when there is room, else on the roomier
 * side, and always inside the window. Its height shrinks to the room it has.
 */
function place(button: DOMRect, size: PopoverSize): Placement {
  const width = Math.min(size.width, innerWidth - 2 * EDGE_PX)
  const wanted = size.align === "end" ? button.right - width : button.left
  const left = Math.min(Math.max(wanted, EDGE_PX), innerWidth - EDGE_PX - width)
  const above = button.top - GAP_PX - EDGE_PX
  const below = innerHeight - button.bottom - GAP_PX - EDGE_PX
  const preferred = size.side === "above" ? above : below
  const up = preferred >= size.maxHeight ? size.side === "above" : above >= below
  return {
    left,
    width,
    maxHeight: Math.min(size.maxHeight, up ? above : below),
    up,
    edge: up ? innerHeight - button.top + GAP_PX : button.bottom + GAP_PX,
    // The popover grows out of the corner nearest its button.
    origin: `${up ? "bottom" : "top"} ${size.align === "end" ? "right" : "left"}`,
  }
}

/**
 * A popover's open state. It closes on a click outside its button and panel, and on Escape. Escape
 * stops there, so the composer's Escape, which stops a running turn, does not also fire.
 */
export function createPopover(size: PopoverSize) {
  const [placement, setPlacement] = createSignal<Placement>()
  let button: HTMLElement | undefined
  let panel: HTMLElement | undefined

  const open = (from: HTMLElement) => {
    button = from
    setPlacement(place(from.getBoundingClientRect(), size))
  }
  const close = () => setPlacement(undefined)

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !placement()) return
    event.stopPropagation()
    close()
  }
  const onPointer = (event: PointerEvent) => {
    const target = event.target as Node
    if (placement() && !button?.contains(target) && !panel?.contains(target)) close()
  }
  const onResize = () => placement() && button && setPlacement(place(button.getBoundingClientRect(), size))
  document.addEventListener("keydown", onKey, true)
  document.addEventListener("pointerdown", onPointer)
  addEventListener("resize", onResize)
  onCleanup(() => {
    document.removeEventListener("keydown", onKey, true)
    document.removeEventListener("pointerdown", onPointer)
    removeEventListener("resize", onResize)
  })

  return {
    placement,
    isOpen: () => !!placement(),
    toggle: (from: HTMLElement) => (placement() ? close() : open(from)),
    close,
    setPanel: (element: HTMLElement) => (panel = element),
  }
}

export type Popover = ReturnType<typeof createPopover>

/** The popover's panel. It renders in a portal, so no ancestor's overflow or stacking can clip it. */
export function PopoverPanel(props: { popover: Popover; label: string; class?: string; children: JSX.Element }) {
  return (
    <Show when={props.popover.placement()}>
      {(at) => (
        <Portal>
          <div
            ref={props.popover.setPanel}
            class={`desk-pop fixed z-50 overflow-hidden rounded-2xl border border-outline bg-raised text-[13px] shadow-[0_18px_40px_rgb(0_0_0/50%)] ${props.class ?? ""}`}
            classList={{ "desk-pop-up": at().up }}
            // Both top and bottom are named. Solid's compiler dropped a computed key from this object.
            style={{
              left: `${at().left}px`,
              width: `${at().width}px`,
              "max-height": `${at().maxHeight}px`,
              top: at().up ? undefined : `${at().edge}px`,
              bottom: at().up ? `${at().edge}px` : undefined,
              "transform-origin": at().origin,
            }}
            role="dialog"
            aria-label={props.label}
            // Solid passes portal events up the component tree, and the composer's click would move focus to its text box.
            onClick={(event) => event.stopPropagation()}
          >
            {props.children}
          </div>
        </Portal>
      )}
    </Show>
  )
}
