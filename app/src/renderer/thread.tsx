import { Button } from "@opencode/ui/button"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { editTexts, lineDiff } from "./diff"
import { formatDuration, modelLabel } from "./format"
import { Markdown } from "./markdown"
import { answerPermission, state, type Item, type Tab } from "./store"

type ToolItem = Extract<Item, { type: "tool" }>
type Row = { readonly type: "tools"; readonly id: string; readonly tools: ToolItem[] } | Item

/** Edits show as diffs on their own. Other tool calls in a row fold into one "Used N" line. */
function rows(items: Item[]): Row[] {
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
  return (
    <div class="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pb-4 pt-2">
      <For each={grouped()}>
        {(row) => (
          <Switch>
            <Match when={row.type === "user" && row}>
              {(item) => <div class="max-w-[80%] self-end whitespace-pre-wrap rounded-xl bg-surface-raised-base px-3.5 py-2 text-text-strong">{item().text}</div>}
            </Match>
            <Match when={row.type === "text" && row}>{(item) => <Markdown text={item().text} />}</Match>
            <Match when={row.type === "thinking"}>
              <div class="text-sm text-text-weaker">Thought</div>
            </Match>
            <Match when={row.type === "tools" && row}>{(group) => <ToolGroup tools={group().tools} />}</Match>
            <Match when={row.type === "tool" && row}>{(item) => <EditBlock tool={item()} />}</Match>
            <Match when={row.type === "permission" && row}>{(item) => <PermissionBlock item={item()} />}</Match>
            <Match when={row.type === "result" && row}>
              {(item) => <div class="text-sm text-text-weaker">{`${modelLabel(props.tab.model)} · ${formatDuration(item().durationMs)}`}</div>}
            </Match>
            <Match when={row.type === "error" && row}>
              {(item) => <div class="text-sm text-text-diff-delete-base">{item().message}</div>}
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.tab.busy}>
        <TextShimmer text="Working…" class="text-sm text-text-weak" />
      </Show>
    </div>
  )
}

function ToolGroup(props: { tools: ToolItem[] }) {
  const [open, setOpen] = createSignal(false)
  const names = () => [...new Set(props.tools.map((tool) => tool.name))].join(", ")
  const running = () => props.tools.some((tool) => !tool.result)
  return (
    <div class="flex flex-col gap-1.5">
      <button class="flex w-fit items-center gap-1.5 text-sm text-text-weak hover:text-text-base" onClick={() => setOpen(!open())}>
        <span class={`inline-block transition-transform ${open() ? "rotate-90" : ""}`}>›</span>
        <span>
          Used <span class="text-text-base">{props.tools.length}</span> · {names()}
        </span>
        <Show when={running()}>
          <span class="text-text-weaker">running</span>
        </Show>
      </button>
      <Show when={open()}>
        <div class="ml-1.5 flex flex-col gap-2 border-l border-border-weak-base pl-3">
          <For each={props.tools}>{(tool) => <ToolRow tool={tool} />}</For>
        </div>
      </Show>
    </div>
  )
}

function ToolRow(props: { tool: ToolItem }) {
  return (
    <div class="flex min-w-0 flex-col gap-1 text-sm">
      <div class="flex min-w-0 gap-2">
        <span class="font-medium text-text-base">{props.tool.name}</span>
        <span class="truncate font-mono text-text-weak">{summarize(props.tool.input)}</span>
      </div>
      <Show when={props.tool.result}>
        {(result) => (
          <pre class={`max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-surface-inset-base p-2 font-mono text-xs ${result().isError ? "text-text-diff-delete-base" : "text-text-weak"}`}>
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
    <div class="overflow-hidden rounded-lg border border-border-weak-base">
      <div class="flex items-center gap-2 bg-surface-raised-base px-3 py-1.5 text-xs">
        <span class="truncate font-mono text-text-base">{relativePath(String(props.tool.input.file_path ?? ""))}</span>
        <span class="ml-auto font-mono text-text-diff-add-base">+{added()}</span>
        <span class="font-mono text-text-diff-delete-base">−{removed()}</span>
      </div>
      <div class="max-h-80 overflow-auto bg-surface-inset-base font-mono text-xs leading-5">
        <For each={lines()}>
          {(line) => (
            <div
              class="whitespace-pre px-3"
              classList={{
                "bg-surface-diff-add-base text-text-diff-add-strong": line.kind === "add",
                "bg-surface-diff-delete-base text-text-diff-delete-strong": line.kind === "del",
                "text-text-weak": line.kind === "same",
              }}
            >
              {`${line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "} ${line.text}`}
            </div>
          )}
        </For>
      </div>
      <Show when={props.tool.result?.isError}>
        <div class="px-3 py-1.5 text-xs text-text-diff-delete-base">{props.tool.result!.output}</div>
      </Show>
    </div>
  )
}

function PermissionBlock(props: { item: Extract<Item, { type: "permission" }> }) {
  return (
    <div class="flex flex-col gap-2 rounded-xl bg-surface-raised-base p-3">
      <div class="text-sm">
        Claude wants to use <span class="font-medium">{props.item.tool}</span>
      </div>
      <pre class="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-inset-base p-2 font-mono text-xs text-text-weak">{summarize(props.item.input, true)}</pre>
      <Show
        when={props.item.answer === undefined}
        fallback={<div class="text-sm text-text-weak">{props.item.answer ? "Allowed" : "Declined"}</div>}
      >
        <div class="flex gap-2">
          <Button variant="contrast" onClick={() => answerPermission(props.item.requestId, true)}>
            Allow
          </Button>
          <Button onClick={() => answerPermission(props.item.requestId, false)}>Decline</Button>
        </div>
      </Show>
    </div>
  )
}

/** One line that says what a tool call does: the command, path or pattern it was given. */
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
