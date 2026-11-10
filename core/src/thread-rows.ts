import { isStep, type CoreMessage, type ItemRow, type StepGroup, type ThreadItem, type ThreadRow } from "@desk/protocol"

/** What a folded turn keeps in view: errors, compactions, and permission requests still waiting for the user. */
const staysOut = (item: ThreadItem) => item.type === "error" || item.type === "compaction" || item.type === "permission"

/** A message that only asks Claude Code to compact, such as `/compact` or `/compact keep the plan`. */
const COMPACT_COMMAND = /^\/compact(\s|$)/

/**
 * Requests show only while they wait, after T3 Code: an answered one leaves, and its tool call shows what
 * happened. Questions show in the composer, never in the thread.
 */
const shown = (item: ThreadItem) => !(item.type === "question" || (item.type === "permission" && item.answered))

const itemRow = (item: ThreadItem): ItemRow => ({ type: "item", id: item.id })

/** Items with each run of steps gathered into a group. Anything else, such as text or a request, ends a group. */
function grouped(items: readonly ThreadItem[], live: boolean): (ItemRow | StepGroup)[] {
  const out: (ItemRow | { type: "group"; id: string; steps: string[]; live: boolean })[] = []
  for (const item of items) {
    const last = out.at(-1)
    if (!isStep(item)) out.push(itemRow(item))
    else if (last?.type === "group") last.steps.push(item.id)
    else out.push({ type: "group", id: `group:${item.id}`, steps: [item.id], live: false })
  }
  const tail = out.at(-1)
  if (live && tail?.type === "group") tail.live = true
  return out
}

/**
 * The thread as rows, after T3 Code. A running turn opens with a "Working for" head, and shows its work
 * as groups, with the last one live. A finished turn folds everything before its closing text into one
 * row. Errors and open permission requests stay out of the fold. A turn is finished once another message follows
 * it, or once the tab stops working, so restored threads, which carry no live events, fold the same way.
 */
export function threadRows(items: readonly ThreadItem[], busy: boolean): ThreadRow[] {
  const out: ThreadRow[] = []
  let opener: Extract<ThreadItem, { type: "user" }> | undefined
  let turn: ThreadItem[] = []
  const close = (finished: boolean) => {
    const result = turn.find((item): item is Extract<ThreadItem, { type: "result" }> => item.type === "result")
    // The turn's file summary arrives after its result, and shows under the answer.
    const summary = turn.filter((item) => item.type === "changes").map(itemRow)
    const body = turn.filter((item) => item.type !== "result" && item.type !== "changes")
    const id = opener?.id ?? body[0]?.id ?? "start"
    turn = []
    // A /compact turn is the compaction itself, after T3 Code: its divider stands in for the message and the working head.
    if (opener && COMPACT_COMMAND.test(opener.text) && body.some((item) => item.type === "compaction")) {
      const last = out.at(-1)
      if (last?.type === "item" && last.id === opener.id) out.pop()
      out.push(...body.filter((item) => !isStep(item)).map(itemRow), ...summary)
      return
    }
    if (!finished) {
      out.push({ type: "working", id: `working:${id}`, ...(opener?.at ? { since: opener.at } : {}) }, ...grouped(body, true), ...summary)
      return
    }
    let end = body.length
    while (end > 0 && body[end - 1]!.type === "text") end--
    const work = body.slice(0, end).filter((item) => !staysOut(item))
    if (work.length) out.push({ type: "fold", id: `fold:${id}`, rows: grouped(work, false), ...(result ? { durationMs: result.durationMs } : {}), stopped: !!result?.stopped })
    out.push(...body.slice(0, end).filter(staysOut).map(itemRow), ...body.slice(end).map(itemRow), ...summary)
  }
  for (const item of items.filter(shown)) {
    if (item.type === "user") {
      if (opener || turn.length) close(true)
      opener = item
      out.push(itemRow(item))
    } else turn.push(item)
  }
  if (busy || turn.length) close(!busy)
  return out
}

/**
 * Keeps each tab's items and busy state as the core sends them, so it can lay their rows out. It reads
 * every message the core sends, and answers with the rows message that should follow it, if any.
 */
export class ThreadRows {
  private threads = new Map<string, { items: ThreadItem[]; busy: boolean; rows: string }>()

  /** The rows to send after `message`: always after a thread's history, and after an event only when the rows change. */
  after(message: CoreMessage): CoreMessage | undefined {
    if (message.type === "session.history") {
      const thread = { items: [...message.items], busy: false, rows: "" }
      this.threads.set(message.tabId, thread)
      return this.rows(message.tabId, thread, true)
    }
    if (message.type !== "session.event") return undefined
    const { tabId, event } = message
    const thread = this.threads.get(tabId) ?? { items: [], busy: false, rows: "" }
    this.threads.set(tabId, thread)
    if (event.kind === "item") {
      const index = thread.items.findIndex((item) => item.id === event.item.id)
      if (index < 0) thread.items.push(event.item)
      else thread.items[index] = event.item
    } else if (event.kind === "status") thread.busy = event.busy
    else return undefined
    return this.rows(tabId, thread, false)
  }

  /** Drops a closed tab's thread. */
  forget(tabId: string) {
    this.threads.delete(tabId)
  }

  private rows(tabId: string, thread: { items: ThreadItem[]; busy: boolean; rows: string }, always: boolean): CoreMessage | undefined {
    const rows = threadRows(thread.items, thread.busy)
    const key = JSON.stringify(rows)
    if (!always && key === thread.rows) return undefined
    thread.rows = key
    return { type: "session.rows", tabId, rows }
  }
}
