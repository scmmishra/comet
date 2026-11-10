import { Button } from "@opencode/ui/button"
import { Collapsible } from "@opencode/ui/collapsible"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { IconButton } from "@opencode/ui/icon-button"
import { Spinner } from "@opencode/ui/spinner"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js"
import type { TabInfo } from "@desk/protocol"
import { lineDiff } from "./diff"
import { COPIED_MS, formatDuration, formatMessageTime, plural } from "./format"
import { Chevron, Icon } from "./icons"
import { Markdown } from "./markdown"
import { openFile } from "./projects"
import { answerPermission, threadOf, type Item } from "./threads"

type ToolItem = Extract<Item, { type: "tool" }>
type PermissionItem = Extract<Item, { type: "permission" }>
type ToolsRow = { readonly type: "tools"; readonly id: string; readonly tools: ToolItem[] }
type WorkRow = { readonly type: "work"; readonly id: string; readonly items: Item[]; readonly durationMs?: number }
type Row = ToolsRow | WorkRow | Item

/** Edits show as diffs on their own. Other tool calls in a row fold into one "Used N" line. */
function groupTools(items: readonly Item[]): Row[] {
  const out: Row[] = []
  for (const item of items) {
    if (item.type === "tool" && !item.edits) {
      const last = out[out.length - 1]
      if (last?.type === "tools") last.tools.push(item)
      else out.push({ type: "tools", id: `tools:${item.id}`, tools: [item] })
    } else out.push(item)
  }
  return out
}

/** What a folded turn keeps in view: errors, and requests still waiting for the user. */
const staysOut = (item: Item) => item.type === "error" || (item.type === "permission" && item.answer === undefined)

/**
 * The thread as rows. A finished turn folds its work, everything before its closing text, into one
 * "Worked for" row, after T3 Code. Errors and open requests stay out of the fold. The turn in progress shows each step.
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
    const work = body.slice(0, end).filter((item) => !staysOut(item))
    if (work.length) out.push({ type: "work", id: `work:${work[0]!.id}`, items: work, durationMs: result?.type === "result" ? result.durationMs : undefined })
    out.push(...body.slice(0, end).filter(staysOut), ...body.slice(end))
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

export function Thread(props: { tab: TabInfo }) {
  const thread = () => threadOf(props.tab.id)
  const shown = createMemo(() => threadRows(thread().items, thread().busy))
  // Only what arrives while the thread is on screen rises in. A tab switch, a reload or a restored
  // transcript shows the thread at once, so switching tabs never replays motion.
  const mountedAt = performance.now()
  const rise = (row: Row) => {
    const item = row.type === "tools" ? row.tools[0] : row.type === "work" ? row.items[0] : row
    return (item?.arrivedAt ?? 0) > mountedAt ? "desk-rise" : ""
  }
  return (
    <div class="desk-lane flex flex-col gap-3.5 px-6 pb-4 pt-2.5">
      {/* Rows mostly append, and groups are rebuilt each time an item arrives. Index keys rows by position, so a growing group keeps its element and its open state. */}
      <Index each={shown()}>
        {(row) => (
          <div class={rise(row())}>
            <RowView row={row()} tab={props.tab} />
          </div>
        )}
      </Index>
      <Show when={thread().busy}>
        <div class="flex items-center gap-2 text-fg-3">
          <Spinner class="size-3.5" />
          <TextShimmer text="Working…" />
        </div>
      </Show>
    </div>
  )
}

/** A row of the thread. Edits are the only tool calls left on their own once groupTools has run. */
function RowView(props: { row: Row; tab: TabInfo }) {
  return (
    <Switch>
      <Match when={props.row.type === "user" && (props.row as Extract<Item, { type: "user" }>)}>
        {(item) => (
          <div class="group/message flex flex-col items-end gap-1">
            <div class="w-fit max-w-[80%] whitespace-pre-wrap rounded-3xl bg-raised px-3.5 py-[9px] text-[length:var(--desk-text-size)] leading-[1.625]">{item().text}</div>
            <MessageMeta text={item().text} at={item().at} />
          </div>
        )}
      </Match>
      <Match when={props.row.type === "text" && (props.row as Extract<Item, { type: "text" }>)}>
        {(item) => (
          <div class="group/message flex flex-col gap-1">
            {/* The reply stretches to the column, so a long code line scrolls inside its block instead of widening the reply. */}
            <Markdown text={item().text} done={item().done} onOpenFile={(path, line) => openFile(props.tab.project, path, line)} />
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
      <Match when={props.row.type === "work" && (props.row as WorkRow)}>{(work) => <WorkView work={work()} tab={props.tab} />}</Match>
      <Match when={props.row.type === "tools" && (props.row as ToolsRow)}>{(group) => <ToolGroup tools={group().tools} />}</Match>
      <Match when={props.row.type === "tool" && (props.row as ToolItem)}>{(item) => <EditBlock tool={item()} />}</Match>
      <Match when={props.row.type === "permission" && (props.row as PermissionItem)}>{(item) => <PermissionCard item={item()} tabId={props.tab.id} />}</Match>
      <Match when={props.row.type === "error" && (props.row as Extract<Item, { type: "error" }>)}>
        {(item) => <div class="rounded-2xl bg-del-soft px-3 py-2 text-del">{item().message}</div>}
      </Match>
    </Switch>
  )
}

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
      <Tooltip value={copied() ? "Copied" : "Copy"} placement="bottom">
        <IconButton variant="ghost-muted" size="normal" aria-label="Copy message" icon={<Icon name={copied() ? "check" : "copy"} class="size-[13px]" />} onClick={() => void copy()} />
      </Tooltip>
      <Show when={props.at}>{(at) => <span title={new Date(at()).toLocaleString()}>{formatMessageTime(at())}</span>}</Show>
    </div>
  )
}

/** A finished turn's work, folded. A restored turn has no timing, so it counts its steps instead. */
function WorkView(props: { work: WorkRow; tab: TabInfo }) {
  const [open, setOpen] = createSignal(false)
  const steps = () => props.work.items.filter((item) => item.type === "tool" || item.type === "thinking").length
  const label = () =>
    props.work.durationMs !== undefined ? `Worked for ${formatDuration(props.work.durationMs)}` : `Worked through ${plural(steps(), "step")}`
  return (
    <Collapsible variant="ghost" open={open()} onOpenChange={setOpen} class="gap-3.5">
      <Collapsible.Trigger class="inline-flex h-auto w-fit items-center gap-1 text-[13px] font-normal text-fg-3 hover:text-fg-2">
        {label()}
        <Chevron open={open()} class="size-[15px]" />
      </Collapsible.Trigger>
      <Collapsible.Content class="grid gap-3.5">
        <For each={groupTools(props.work.items)}>{(row) => <RowView row={row} tab={props.tab} />}</For>
      </Collapsible.Content>
    </Collapsible>
  )
}

function ToolGroup(props: { tools: ToolItem[] }) {
  const [open, setOpen] = createSignal(false)
  const names = () => [...new Set(props.tools.map((tool) => tool.name))].join(", ")
  return (
    <Collapsible variant="ghost" open={open()} onOpenChange={setOpen} class="gap-1.5">
      <Collapsible.Trigger class="inline-flex h-auto w-fit items-center gap-1.5 text-[13px] font-normal text-fg-3 hover:[&_b]:text-fg">
        <Chevron open={open()} class="size-[15px]" />
        Used <b class="font-medium text-fg-2">{props.tools.length}</b> · {names()}
      </Collapsible.Trigger>
      <Collapsible.Content class="ml-[7px] grid gap-0.5 pl-[13px] shadow-[inset_1px_0_0_var(--color-line)]">
        <For each={props.tools}>{(tool) => <ToolRow tool={tool} />}</For>
      </Collapsible.Content>
    </Collapsible>
  )
}

function ToolRow(props: { tool: ToolItem }) {
  const [open, setOpen] = createSignal(false)
  return (
    <Collapsible variant="ghost" open={open()} onOpenChange={setOpen} disabled={!props.tool.result} class="py-[3px] text-[12.5px]">
      <Collapsible.Trigger class="grid h-auto w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-left text-[12.5px] font-normal">
        <span class="font-medium text-fg-2">{props.tool.name}</span>
        <span class="min-w-0 truncate font-mono text-[12px] text-fg-2">{props.tool.summary}</span>
        <span class="col-start-2 text-[12px] text-fg-3">{outcome(props.tool)}</span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <pre class="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-ground px-3 py-2.5 font-mono text-[12px] text-fg-2 shadow-[0_0_0_1px_var(--color-line)]">
          {props.tool.result?.output || "(no output)"}
        </pre>
      </Collapsible.Content>
    </Collapsible>
  )
}

function EditBlock(props: { tool: ToolItem }) {
  const lines = createMemo(() => (props.tool.edits ?? []).flatMap((edit) => lineDiff(edit.before, edit.after)))
  const added = () => lines().filter((line) => line.kind === "add").length
  const removed = () => lines().filter((line) => line.kind === "del").length
  return (
    <div class="overflow-hidden rounded-2xl bg-ground shadow-[0_0_0_1px_var(--color-line)]">
      <div class="flex min-w-0 items-center gap-2 bg-raised px-3 py-[7px] text-[12px] text-fg-2">
        <Icon name="edit" class="size-[15px]" />
        <span class="min-w-0 truncate font-mono text-fg">{props.tool.file}</span>
        <DiffChanges class="ml-auto shrink-0" changes={{ additions: added(), deletions: removed() }} />
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

function PermissionCard(props: { item: PermissionItem; tabId: string }) {
  return (
    <div class="overflow-hidden rounded-3xl bg-raised">
      <div class="flex items-center gap-2 px-3.5 pt-2.5 text-[12px] text-fg-3">
        <Icon name="lock" class="size-[15px]" />
        Claude wants to use {props.item.tool}
      </div>
      <pre class="mx-3.5 mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-2xl bg-ground px-3 py-2 font-mono text-[12px] text-fg shadow-[0_0_0_1px_var(--color-line)]">
        {props.item.detail}
      </pre>
      <Show
        when={props.item.answer === undefined}
        fallback={<div class="px-3.5 pb-3 pt-2.5 text-[12px] text-fg-3">{props.item.answer ? "Allowed" : "Declined"}</div>}
      >
        <div class="flex gap-1.5 px-3 pb-3 pt-2.5">
          <Button variant="contrast" onClick={() => answerPermission(props.tabId, props.item.requestId, true)}>
            Allow
          </Button>
          <Button onClick={() => answerPermission(props.tabId, props.item.requestId, false)}>Decline</Button>
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
