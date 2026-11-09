import { createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js"
import { editTexts, lineDiff } from "./diff"
import { formatDuration, formatMessageTime } from "./format"
import { Icon } from "./icons"
import { Markdown } from "./markdown"
import { answerPermission, state, type Item, type Tab } from "./store"

type ToolItem = Extract<Item, { type: "tool" }>
type PermissionItem = Extract<Item, { type: "permission" }>
type ToolsRow = { readonly type: "tools"; readonly id: string; readonly tools: ToolItem[] }
type WorkRow = { readonly type: "work"; readonly id: string; readonly items: Item[]; readonly durationMs?: number }
type Row = ToolsRow | WorkRow | Item

/** Edits show as diffs on their own. Other tool calls in a row fold into one "Used N" line. */
function groupTools(items: readonly Item[]): Row[] {
  const out: Row[] = []
  for (const item of items) {
    if (item.type === "tool" && !editTexts(item.name, item.input)) {
      const last = out[out.length - 1]
      if (last?.type === "tools") last.tools.push(item)
      else out.push({ type: "tools", id: `tools:${item.id}`, tools: [item] })
    } else out.push(item)
  }
  return out
}

/**
 * The thread as rows. A finished turn folds its work, everything before its closing text, into one
 * "Worked for" row, after T3 Code. Errors stay out of the fold. The turn in progress shows each step.
 * A turn is finished once another message follows it, or once the tab stops working, so restored
 * threads, which carry no result events, fold the same way.
 */
function threadRows(items: readonly Item[], busy: boolean): Row[] {
  const out: Row[] = []
  let turn: Item[] = []
  const close = (finished: boolean) => {
    const result = turn.find((item) => item.type === "result")
    const body = turn.filter((item) => item.type !== "result")
    turn = []
    if (!finished) return void out.push(...groupTools(body))
    let end = body.length
    while (end > 0 && body[end - 1]!.type === "text") end--
    const work = body.slice(0, end).filter((item) => item.type !== "error")
    if (work.length) out.push({ type: "work", id: `work:${work[0]!.id}`, items: work, durationMs: result?.type === "result" ? result.durationMs : undefined })
    out.push(...body.slice(0, end).filter((item) => item.type === "error"), ...body.slice(end))
  }
  for (const item of items) {
    if (item.type === "user") {
      close(true)
      out.push(item)
    } else turn.push(item)
  }
  close(!busy)
  return out
}

export function Thread(props: { tab: Tab }) {
  const shown = createMemo(() => threadRows(props.tab.items, props.tab.busy))
  // Only what arrives while the thread is on screen rises in. A tab switch, a reload or a restored
  // transcript shows the thread at once, so switching tabs never replays motion.
  const mountedAt = performance.now()
  const rise = (row: Row) => {
    const item = row.type === "tools" ? row.tools[0] : row.type === "work" ? row.items[0] : row
    return (item?.arrivedAt ?? 0) > mountedAt ? "desk-rise" : ""
  }
  return (
    <div class="mx-auto flex w-full max-w-[720px] flex-col gap-3.5 px-6 pb-4 pt-2.5">
      {/* Rows mostly append, and groups are rebuilt each time an item arrives. Index keys rows by position, so a growing group keeps its element and its open state. */}
      <Index each={shown()}>
        {(row) => (
          <div class={rise(row())}>
            <RowView row={row()} />
          </div>
        )}
      </Index>
      <Show when={props.tab.busy}>
        <div class="flex items-center gap-2 text-fg-3">
          <span class="desk-spin" />
          Working…
        </div>
      </Show>
    </div>
  )
}

function RowView(props: { row: Row }) {
  return (
    <Switch>
      <Match when={props.row.type === "user" && (props.row as Extract<Item, { type: "user" }>)}>
        {(item) => (
          <div class="group/message flex flex-col items-end gap-1">
            <div class="w-fit max-w-[80%] whitespace-pre-wrap rounded-3xl bg-raised px-3.5 py-[9px] text-[14px] leading-[1.625]">{item().text}</div>
            <MessageMeta text={item().text} at={item().at} />
          </div>
        )}
      </Match>
      <Match when={props.row.type === "text" && (props.row as Extract<Item, { type: "text" }>)}>
        {(item) => (
          <div class="group/message flex flex-col items-start gap-1">
            <Markdown text={item().text} done={item().done} />
            {/* A reply still streaming has nothing final to copy. */}
            <Show when={item().done}>
              <MessageMeta text={item().text} at={item().at} />
            </Show>
          </div>
        )}
      </Match>
      <Match when={props.row.type === "thinking"}>
        <div class="text-[12px] text-fg-3">Thought</div>
      </Match>
      <Match when={props.row.type === "work" && (props.row as WorkRow)}>{(work) => <WorkView work={work()} />}</Match>
      <Match when={props.row.type === "tools" && (props.row as ToolsRow)}>{(group) => <ToolGroup tools={group().tools} />}</Match>
      <Match when={props.row.type === "tool" && (props.row as ToolItem)}>{(item) => <EditBlock tool={item()} />}</Match>
      <Match when={props.row.type === "permission" && (props.row as PermissionItem)}>{(item) => <PermissionCard item={item()} />}</Match>
      <Match when={props.row.type === "error" && (props.row as Extract<Item, { type: "error" }>)}>
        {(item) => <div class="rounded-2xl bg-del-soft px-3 py-2 text-del">{item().message}</div>}
      </Match>
    </Switch>
  )
}

const COPIED_MS = 1500

/**
 * A message's copy button and time, after T3 Code. They stay hidden until the message is hovered,
 * or a button in them has focus, so the thread reads as text.
 */
function MessageMeta(props: { text: string; at?: number }) {
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    await navigator.clipboard.writeText(props.text)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <div class="flex h-6 items-center gap-1.5 text-[12px] tabular-nums text-fg-3 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/message:opacity-100">
      <button type="button" class="grid size-6 place-items-center rounded-md hover:bg-hover hover:text-fg" aria-label="Copy message" title="Copy" onClick={() => void copy()}>
        <Icon name={copied() ? "check" : "copy"} class="size-[13px]" />
      </button>
      <Show when={props.at}>{(at) => <span title={new Date(at()).toLocaleString()}>{formatMessageTime(at())}</span>}</Show>
    </div>
  )
}

/** A finished turn's work, folded. A restored turn has no timing, so it counts its steps instead. */
function WorkView(props: { work: WorkRow }) {
  const [open, setOpen] = createSignal(false)
  const steps = () => props.work.items.filter((item) => item.type === "tool" || item.type === "thinking").length
  const label = () =>
    props.work.durationMs !== undefined ? `Worked for ${formatDuration(props.work.durationMs)}` : `Worked through ${steps()} ${steps() === 1 ? "step" : "steps"}`
  return (
    <div class="grid gap-3.5">
      <button class="inline-flex w-fit items-center gap-1 text-fg-3 hover:text-fg-2" aria-expanded={open()} onClick={() => setOpen(!open())}>
        {label()}
        <Icon name="chevron" class={`size-[15px] transition-transform duration-150 ${open() ? "rotate-90" : ""}`} />
      </button>
      <Show when={open()}>
        <div class="grid gap-3.5">
          <For each={groupTools(props.work.items)}>{(row) => <RowView row={row} />}</For>
        </div>
      </Show>
    </div>
  )
}

function ToolGroup(props: { tools: ToolItem[] }) {
  const [open, setOpen] = createSignal(false)
  const names = () => [...new Set(props.tools.map((tool) => tool.name))].join(", ")
  return (
    <div class="grid gap-1.5">
      <button class="inline-flex w-fit items-center gap-1.5 text-fg-3 hover:[&_b]:text-fg" onClick={() => setOpen(!open())}>
        <Icon name="chevron" class={`size-[15px] transition-transform duration-150 ${open() ? "rotate-90" : ""}`} />
        Used <b class="font-medium text-fg-2">{props.tools.length}</b> · {names()}
      </button>
      <Show when={open()}>
        <div class="ml-[7px] grid gap-0.5 pl-[13px] shadow-[inset_1px_0_0_var(--color-line)]">
          <For each={props.tools}>{(tool) => <ToolRow tool={tool} />}</For>
        </div>
      </Show>
    </div>
  )
}

function ToolRow(props: { tool: ToolItem }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="grid py-[3px] text-[12.5px]">
      <button class="grid grid-cols-[auto_1fr] gap-x-2 text-left" onClick={() => setOpen(!open())}>
        <span class="font-medium text-fg-2">{props.tool.name}</span>
        <span class="min-w-0 truncate font-mono text-[12px] text-fg-2">{summarize(props.tool.input)}</span>
        <span class="col-start-2 text-[12px] text-fg-3">{outcome(props.tool)}</span>
      </button>
      <Show when={open() && props.tool.result}>
        {(result) => (
          <pre class="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-ground px-3 py-2.5 font-mono text-[12px] text-fg-2 shadow-[0_0_0_1px_var(--color-line)]">
            {result().output || "(no output)"}
          </pre>
        )}
      </Show>
    </div>
  )
}

function EditBlock(props: { tool: ToolItem }) {
  const lines = createMemo(() => (editTexts(props.tool.name, props.tool.input) ?? []).flatMap((edit) => lineDiff(edit.before, edit.after)))
  const added = () => lines().filter((line) => line.kind === "add").length
  const removed = () => lines().filter((line) => line.kind === "del").length
  return (
    <div class="overflow-hidden rounded-2xl bg-ground shadow-[0_0_0_1px_var(--color-line)]">
      <div class="flex min-w-0 items-center gap-2 bg-raised px-3 py-[7px] text-[12px] text-fg-2">
        <Icon name="edit" class="size-[15px]" />
        <span class="min-w-0 truncate font-mono text-fg">{relativePath(String(props.tool.input.file_path ?? ""))}</span>
        <span class="ml-auto flex shrink-0 gap-2 font-mono tabular-nums">
          <span class="text-add">+{added()}</span>
          <span class="text-del">−{removed()}</span>
        </span>
      </div>
      <div class="max-h-80 overflow-auto font-mono text-[12px] leading-5">
        <For each={lines()}>
          {(line) => (
            <div class="whitespace-pre px-2.5" classList={{ "bg-add-soft": line.kind === "add", "bg-del-soft": line.kind === "del" }}>
              <span class="mr-2" classList={{ "text-add": line.kind === "add", "text-del": line.kind === "del" }}>
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
              </span>
              {line.text}
            </div>
          )}
        </For>
      </div>
      <Show when={props.tool.result?.isError}>
        <div class="bg-raised px-3 py-[7px] text-[12px] text-del">{props.tool.result!.output}</div>
      </Show>
    </div>
  )
}

function PermissionCard(props: { item: PermissionItem }) {
  return (
    <div class="overflow-hidden rounded-3xl bg-raised">
      <div class="flex items-center gap-2 px-3.5 pt-2.5 text-[12px] text-fg-3">
        <Icon name="lock" class="size-[15px]" />
        Claude wants to use {props.item.tool}
      </div>
      <pre class="mx-3.5 mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-2xl bg-ground px-3 py-2 font-mono text-[12px] text-fg shadow-[0_0_0_1px_var(--color-line)]">
        {summarize(props.item.input, true)}
      </pre>
      <Show
        when={props.item.answer === undefined}
        fallback={<div class="px-3.5 pb-3 pt-2.5 text-[12px] text-fg-3">{props.item.answer ? "Allowed" : "Declined"}</div>}
      >
        <div class="flex gap-1.5 px-3 pb-3 pt-2.5">
          <button class="h-7 rounded-lg bg-fg px-[11px] font-medium text-ground hover:bg-[#fff]" onClick={() => answerPermission(props.item.requestId, true)}>
            Allow
          </button>
          <button class="h-7 rounded-lg bg-hover px-[11px] hover:bg-[#2e2e33]" onClick={() => answerPermission(props.item.requestId, false)}>
            Decline
          </button>
        </div>
      </Show>
    </div>
  )
}

function outcome(tool: ToolItem) {
  if (!tool.result) return "Running…"
  if (tool.result.isError) return "Failed"
  const first = tool.result.output.split("\n").find((line) => line.trim())
  return first ? first.slice(0, 120) : "Done"
}

/** What a tool call was given, in short: the command, path or pattern. */
function summarize(input: Record<string, unknown>, full = false) {
  const key = ["command", "file_path", "pattern", "path", "url", "query", "description"].find((name) => typeof input[name] === "string")
  if (key && !full) return relativePath(String(input[key]))
  if (key && full && Object.keys(input).length === 1) return String(input[key])
  return JSON.stringify(input, null, full ? 2 : 0)
}

function relativePath(path: string) {
  const root = state.space?.root
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}
