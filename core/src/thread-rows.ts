import { isStep, type CoreMessage, type ItemRow, type Step, type StepGroup, type StepKind, type ThreadItem, type ThreadRow } from "@comet/protocol"

type Tool = Extract<Step, { type: "tool" }>

/** Which kinds a group summary names first, when it has more than it can name. */
const PRIORITY: StepKind[] = ["command", "edit", "read", "search", "web", "other"]
/** A group summary names this many kinds, and counts the rest as other actions. */
const NAMED_KINDS = 2

/** What a folded turn keeps in view: errors, warnings, compactions, visuals, and permission requests still waiting for the user. */
const staysOut = (item: ThreadItem) => item.type === "error" || (item.type === "notice" && item.warning) || item.type === "compaction" || item.type === "permission" || item.type === "visual"

/** A message that only asks the agent to compact, such as `/compact` or `/compact keep the plan`. */
const COMPACT_COMMAND = /^\/compact(\s|$)/

/**
 * Requests show only while they wait, after T3 Code: an answered one leaves, and its tool call shows what
 * happened. Questions show in the composer, never in the thread.
 */
const shown = (item: ThreadItem) => !(item.type === "question" || (item.type === "permission" && item.answered))

const itemRow = (item: ThreadItem): ItemRow => ({ type: "item", id: item.id })

/** Items with each run of steps gathered into a group. Anything else, such as text or a request, ends a group. */
function grouped(items: readonly ThreadItem[], live: boolean): (ItemRow | StepGroup)[] {
  const out: (ItemRow | Step[])[] = []
  for (const item of items) {
    const last = out.at(-1)
    if (!isStep(item)) out.push(itemRow(item))
    else if (Array.isArray(last)) last.push(item)
    else out.push([item])
  }
  return out.map((row, index) =>
    Array.isArray(row) ? { type: "group", id: `group:${row[0]!.id}`, steps: row.map((step) => step.id), live: live && index === out.length - 1, summary: groupSummary(row) } : row,
  )
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
    } else if (event.kind === "items.remove") {
      const ids = new Set(event.ids)
      thread.items = thread.items.filter((item) => !ids.has(item.id))
    } else if (event.kind === "status") thread.busy = event.busy
    else return undefined
    return this.rows(tabId, thread, false)
  }

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

const phrase = (kind: StepKind, count: number): string => {
  const n = (one: string, many: string) => (count === 1 ? one : many.replace("N", String(count)))
  switch (kind) {
    case "command":
      return n("ran a command", "ran N commands")
    case "edit":
      return n("changed a file", "changed N files")
    case "read":
      return n("read a file", "read N files")
    case "search":
      return n("searched code once", "searched code N times")
    case "web":
      return n("searched the web once", "searched the web N times")
    default:
      return n("used a tool", "used N tools")
  }
}

/**
 * A group of steps in one line, after T3 Code: "Read 3 files and ran 2 commands". Files read or changed
 * count once each. Thoughts are not counted. It names the two kinds that matter most, in the order they
 * came, and counts the rest as other actions. A group of thoughts alone reads "Thought".
 */
function groupSummary(steps: readonly Step[]): string {
  const tools = steps.filter((step): step is Tool => step.type === "tool")
  if (!tools.length) return steps.length > 1 ? `Thought (×${steps.length})` : "Thought"
  const byKind = new Map<StepKind, Tool[]>()
  for (const tool of tools) byKind.set(tool.kind, [...(byKind.get(tool.kind) ?? []), tool])
  const count = (kind: StepKind, found: Tool[]) => (kind === "read" || kind === "edit" ? new Set(found.map((tool) => tool.file ?? tool.summary)).size : found.length)
  const named = [...byKind.keys()].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b)).slice(0, NAMED_KINDS)
  const parts = [...byKind.entries()].filter(([kind]) => named.includes(kind)).map(([kind, found]) => phrase(kind, count(kind, found)))
  const others = [...byKind.entries()].filter(([kind]) => !named.includes(kind)).reduce((sum, [, found]) => sum + found.length, 0)
  if (others) parts.push(others === 1 ? "performed 1 other action" : `performed ${others} other actions`)
  const joined = parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}
