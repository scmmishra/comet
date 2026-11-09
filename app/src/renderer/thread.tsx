import { createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js"
import { editTexts, lineDiff } from "./diff"
import { formatDuration, modelLabel } from "./format"
import { Icon } from "./icons"
import { Markdown } from "./markdown"
import { answerPermission, state, type Item, type Tab } from "./store"

type ToolItem = Extract<Item, { type: "tool" }>
type PermissionItem = Extract<Item, { type: "permission" }>
type Row = { readonly type: "tools"; readonly id: string; readonly tools: ToolItem[] } | Item

/** Edits show as diffs on their own. Other tool calls in a row fold into one "Used N" line. */
function rows(items: readonly Item[]): Row[] {
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

export function Thread(props: { tab: Tab }) {
  const grouped = createMemo(() => rows(props.tab.items))
  // Only what arrives while the thread is on screen rises in. A tab switch, a reload or a restored
  // transcript shows the thread at once, so switching tabs never replays motion.
  const mountedAt = performance.now()
  const rise = (row: Row) => {
    const item = row.type === "tools" ? row.tools[0] : row
    return (item?.arrivedAt ?? 0) > mountedAt ? "desk-rise" : ""
  }
  return (
    <div class="mx-auto flex w-full max-w-[720px] flex-col gap-3.5 px-6 pb-4 pt-2.5">
      {/* Rows only append, and a tool group is rebuilt each time an item arrives. Index keys rows by position, so a growing group keeps its element and its open state. */}
      <Index each={grouped()}>
        {(row) => (
          <div class={rise(row())}>
            <Switch>
              <Match when={row().type === "user" && (row() as Item)}>
                {(item) => <div class="ml-auto w-fit max-w-[80%] whitespace-pre-wrap rounded-3xl bg-raised px-3.5 py-[9px]">{(item() as Extract<Item, { type: "user" }>).text}</div>}
              </Match>
              <Match when={row().type === "text" && (row() as Extract<Item, { type: "text" }>)}>
                {(item) => <Markdown text={item().text} done={item().done} />}
              </Match>
              <Match when={row().type === "thinking"}>
                <div class="text-[12px] text-fg-3">Thought</div>
              </Match>
              <Match when={row().type === "tools" && (row() as Extract<Row, { type: "tools" }>)}>{(group) => <ToolGroup tools={group().tools} />}</Match>
              <Match when={row().type === "tool" && row()}>{(item) => <EditBlock tool={item() as ToolItem} />}</Match>
              <Match when={row().type === "permission" && row()}>{(item) => <PermissionCard item={item() as PermissionItem} />}</Match>
              <Match when={row().type === "result" && (row() as Extract<Item, { type: "result" }>)}>
                {(item) => (
                  <div class="flex items-center gap-1.5 text-[12px] text-fg-3">
                    <Icon name="bot" class="size-[15px]" />
                    {`${modelLabel(props.tab.model)} · ${formatDuration(item().durationMs)}`}
                  </div>
                )}
              </Match>
              <Match when={row().type === "error" && (row() as Extract<Item, { type: "error" }>)}>
                {(item) => <div class="rounded-2xl bg-del-soft px-3 py-2 text-del">{item().message}</div>}
              </Match>
            </Switch>
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
