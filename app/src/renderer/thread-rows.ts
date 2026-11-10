import type { ThreadItem } from "@desk/protocol"
import { isStep, type Step } from "./work"

/** Steps in a row, with nothing between them. The last group of a running turn is live: it shows its latest step. */
export type Group = { readonly type: "group"; readonly id: string; readonly steps: Step[]; readonly live: boolean }
/** A finished turn's work, folded into one row. A turn restored without timing has no duration. */
export type Fold<T> = { readonly type: "fold"; readonly id: string; readonly rows: (T | Group)[]; readonly durationMs?: number; readonly stopped: boolean }
/** The head of a running turn. `since` is when its message was sent. */
export type Working = { readonly type: "working"; readonly id: string; readonly since?: number }
export type Row<T> = T | Group | Fold<T> | Working

type NotStep<T> = Exclude<T, Step>

/** What a folded turn keeps in view: errors, compactions, and permission requests still waiting for the user. */
const staysOut = (item: ThreadItem) => item.type === "error" || item.type === "compaction" || item.type === "permission"

/** A message that only asks Claude Code to compact, such as `/compact` or `/compact keep the plan`. */
const COMPACT_COMMAND = /^\/compact(\s|$)/

/**
 * Requests show only while they wait, after T3 Code: an answered one leaves, and its tool call shows what
 * happened. Questions show in the composer, never in the thread.
 */
const shown = (item: ThreadItem) => !(item.type === "question" || (item.type === "permission" && item.answered))

/** Items with each run of steps gathered into a group. Anything else, such as text or a request, ends a group. */
function grouped<T extends ThreadItem>(items: readonly T[], live: boolean): (NotStep<T> | Group)[] {
  const out: (NotStep<T> | Group)[] = []
  for (const item of items) {
    const last = out.at(-1)
    if (!isStep(item)) out.push(item as NotStep<T>)
    else if (last?.type === "group") (last as Group).steps.push(item)
    else out.push({ type: "group", id: `group:${item.id}`, steps: [item], live: false })
  }
  const tail = out.at(-1)
  if (live && tail?.type === "group") out[out.length - 1] = { ...(tail as Group), live: true }
  return out
}

/**
 * The thread as rows, after T3 Code. A running turn opens with a "Working for" head, and shows its work
 * as groups, with the last one live. A finished turn folds everything before its closing text into one
 * row. Errors and open permission requests stay out of the fold. A turn is finished once another message follows
 * it, or once the tab stops working, so restored threads, which carry no live events, fold the same way.
 */
export function threadRows<T extends ThreadItem>(items: readonly T[], busy: boolean): Row<NotStep<T>>[] {
  const out: Row<NotStep<T>>[] = []
  let opener: Extract<T, { type: "user" }> | undefined
  let turn: T[] = []
  const close = (finished: boolean) => {
    const result = turn.find((item): item is Extract<T, { type: "result" }> => item.type === "result")
    // The turn's file summary arrives after its result, and shows under the answer.
    const summary = turn.filter((item) => item.type === "changes") as NotStep<T>[]
    const body = turn.filter((item) => item.type !== "result" && item.type !== "changes")
    const id = opener?.id ?? body[0]?.id ?? "start"
    turn = []
    // A /compact turn is the compaction itself, after T3 Code: its divider stands in for the message and the working head.
    if (opener && COMPACT_COMMAND.test(opener.text) && body.some((item) => item.type === "compaction")) {
      if ((out.at(-1) as unknown) === opener) out.pop()
      out.push(...(body.filter((item) => !isStep(item)) as NotStep<T>[]), ...summary)
      return
    }
    if (!finished) {
      out.push({ type: "working", id: `working:${id}`, since: opener?.at }, ...grouped(body, true), ...summary)
      return
    }
    let end = body.length
    while (end > 0 && body[end - 1]!.type === "text") end--
    const work = body.slice(0, end).filter((item) => !staysOut(item))
    if (work.length) out.push({ type: "fold", id: `fold:${id}`, rows: grouped(work, false), durationMs: result?.durationMs, stopped: !!result?.stopped })
    out.push(...(body.slice(0, end).filter(staysOut) as NotStep<T>[]), ...(body.slice(end) as NotStep<T>[]), ...summary)
  }
  for (const item of items.filter(shown)) {
    if (item.type === "user") {
      if (opener || turn.length) close(true)
      opener = item as Extract<T, { type: "user" }>
      out.push(item as NotStep<T>)
    } else turn.push(item)
  }
  if (busy || turn.length) close(!busy)
  return out
}
