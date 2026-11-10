import type { ThreadItem } from "@desk/protocol"

/** One mark on the thread's minimap: a message the user sent, and the start of Claude's final answer to it. */
export interface MinimapItem {
  readonly id: string
  readonly text: string
  readonly answer?: string
}

// T3 Code's measures for its timeline minimap, kept as they are.
/** The fewest messages a thread needs before its minimap shows. One message has nothing to move between. */
export const MINIMAP_MIN_ITEMS = 2
/** The gap between marks. */
const MARK_SPACING_PX = 8
/** The tallest the rail grows, however many marks it holds. */
const RAIL_MAX_HEIGHT = "calc(100vh - 18rem)"
/** A gutter at least this wide shows the minimap all the time. A narrower one shows it on hover. */
export const PERSISTENT_GUTTER_PX = 48
/** The hit strip starts this far into the gutter, and is at most this wide while no preview shows. */
const HIT_STRIP_LEFT_PX = 12
const HIT_STRIP_MAX_PX = 40
/** The strip widens to take the preview while one shows, so the pointer can reach it. */
export const EXPANDED_HIT_STRIP = "22rem"
/** A strip narrower than this cannot hold the previous and next buttons. */
export const NAVIGATION_REACH_PX = 14

/**
 * The minimap's marks, after T3 Code: one per message the user sent, with the last text Claude wrote
 * before the next one. A turn Claude started itself, after a background task, gets no mark.
 */
export function minimapItems(items: readonly ThreadItem[]): MinimapItem[] {
  const out: MinimapItem[] = []
  let current: { id: string; text: string; answer?: string } | undefined
  for (const item of items) {
    if (item.type === "user" && !item.fromTask) {
      if (current) out.push(current)
      current = { id: item.id, text: oneLine(item.text) || "User message" }
    } else if (item.type === "text" && current) current.answer = oneLine(item.text)
  }
  if (current) out.push(current)
  return out
}

/** The rail's height: the marks' spacing, up to its tallest. */
export const railHeight = (count: number) => `min(${Math.max(1, (count - 1) * MARK_SPACING_PX)}px, ${RAIL_MAX_HEIGHT})`

/** Where a mark sits down the rail, as a percent: evenly spaced, whatever each turn's length. */
export const markTop = (index: number, count: number) => (count <= 1 ? 0 : (Math.max(0, Math.min(index, count - 1)) / (count - 1)) * 100)

/** The mark nearest a point down the rail, given as a fraction of its height. */
export const markAt = (fraction: number, count: number) => Math.max(0, Math.min(count - 1, Math.round(Math.max(0, Math.min(1, fraction)) * (count - 1))))

/** How wide the hit strip is in a gutter of `gutter` pixels. None when the gutter is too narrow. */
export const hitStripWidth = (gutter: number) => Math.max(0, Math.min(HIT_STRIP_MAX_PX, Math.floor(gutter) - HIT_STRIP_LEFT_PX))

/**
 * The turn being read, which the previous and next buttons step from: the first message on screen, else
 * the last one above the screen. `tops` are the messages' tops, in order, against the screen's.
 */
export function currentIndex(tops: readonly number[], viewTop: number, viewBottom: number): number | undefined {
  let preceding: number | undefined
  for (const [index, top] of tops.entries()) {
    if (top >= viewTop) return top <= viewBottom ? index : preceding
    preceding = index
  }
  return preceding
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()
