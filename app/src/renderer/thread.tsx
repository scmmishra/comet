import { Button } from "@opencode/ui/button"
import { Collapsible } from "@opencode/ui/collapsible"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { IconButton } from "@opencode/ui/icon-button"
import { Spinner } from "@opencode/ui/spinner"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEffect, createMemo, createSignal, For, Index, Match, on, Show, Switch } from "solid-js"
import type { PermissionAnswer, TabInfo, ThreadItem } from "@desk/protocol"
import { imageUrl } from "./attachments"
import { now } from "./clock"
import { lineDiff } from "./diff"
import { fileIcon } from "./file-icons"
import { COPIED_MS, formatDuration, formatMessageTime, formatTokens, plural } from "./format"
import { Chevron, Icon, type IconName } from "./icons"
import { Markdown } from "./markdown"
import { openFile } from "./file-tabs"
import { threadRows, type Fold, type Group, type Row as ThreadRow, type Working } from "./thread-rows"
import { answerPermission, threadOf, type Item } from "./threads"
import { openReview } from "./workspace"
import { groupSummary, ICON_BY_KIND, isStep, stepKind, stepLabel, type Step } from "./work"

type ToolItem = Extract<Item, { type: "tool" }>
type PermissionItem = Extract<Item, { type: "permission" }>
type ChangesItem = Extract<Item, { type: "changes" }>
type CompactionItem = Extract<Item, { type: "compaction" }>
type RetryEvent = NonNullable<ReturnType<typeof threadOf>["retry"]>
type Row = ThreadRow<Exclude<Item, Step>>

/** The first item a row draws, which says when the row arrived. */
const firstItem = (row: Row): Item | undefined =>
  row.type === "group" ? row.steps[0] : row.type === "fold" ? (row.rows[0]?.type === "group" ? row.rows[0].steps[0] : (row.rows[0] as Item | undefined)) : row.type === "working" ? undefined : row

export function Thread(props: { tab: TabInfo }) {
  const thread = () => threadOf(props.tab.id)
  const shown = createMemo(() => threadRows(thread().items, thread().busy))
  // Only what arrives while the thread is on screen rises in. A tab switch, a reload or a restored
  // transcript shows the thread at once, so switching tabs never replays motion.
  const mountedAt = performance.now()
  const rise = (row: Row) => ((firstItem(row)?.arrivedAt ?? 0) > mountedAt ? "desk-rise" : "")
  return (
    <div class="desk-lane flex flex-col gap-3.5 px-6 pb-4 pt-2.5">
      {/* Rows mostly append, and groups are rebuilt each time an item arrives. Index keys rows by position, so a growing group keeps its element and its open state. */}
      <Index each={shown()}>
        {(row) => (
          // A message's row carries its id, so the minimap can find it.
          <div class={rise(row())} data-message={row().type === "user" ? (row() as Item).id : undefined}>
            <RowView row={row()} tab={props.tab} />
          </div>
        )}
      </Index>
    </div>
  )
}

/** A row of the thread, or of a folded turn. */
function RowView(props: { row: Row; tab: TabInfo }) {
  return (
    <Switch>
      {/* A turn Claude Code started itself opens with a line that says why, not a bubble. */}
      <Match when={props.row.type === "user" && (props.row as Extract<Item, { type: "user" }>).selfStarted && (props.row as Extract<Item, { type: "user" }>)}>
        {(item) => (
          <div class="flex items-center gap-2 text-[13px] text-fg-3">
            <Icon name="outline-console" class="size-[14px] shrink-0" />
            <span class="min-w-0 truncate">{item().text}</span>
          </div>
        )}
      </Match>
      <Match when={props.row.type === "user" && (props.row as Extract<Item, { type: "user" }>)}>
        {(item) => (
          <div class="group/message flex flex-col items-end gap-1">
            <Show when={item().steered}>
              <span class="flex items-center gap-1 text-[12px] text-fg-3" title="Sent into the turn while Claude worked">
                <Icon name="arrow-up-right" class="size-3" />
                Steered
              </span>
            </Show>
            <Show when={item().images?.length}>
              <div class="flex max-w-[80%] flex-wrap justify-end gap-2">
                <For each={item().images}>{(image) => <img src={imageUrl(image)} alt="" class="max-h-48 max-w-[240px] rounded-2xl object-cover shadow-[0_0_0_1px_var(--color-line)]" />}</For>
              </div>
            </Show>
            <Show when={item().text}>
              {/* A long token, such as an ID or a URL, wraps anywhere, as in a reply, rather than running past the bubble. */}
              <div class="w-fit max-w-[80%] whitespace-pre-wrap rounded-3xl bg-raised px-3.5 py-[9px] text-[length:var(--desk-text-size)] leading-[1.625] [overflow-wrap:anywhere]">{item().text}</div>
            </Show>
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
      <Match when={props.row.type === "working" && (props.row as Working)}>{(working) => <WorkingRow since={working().since} retry={threadOf(props.tab.id).retry} />}</Match>
      <Match when={props.row.type === "compaction" && (props.row as CompactionItem)}>{(item) => <CompactionRow item={item()} />}</Match>
      <Match when={props.row.type === "fold" && (props.row as Fold<Exclude<Item, Step>>)}>{(fold) => <FoldView fold={fold()} tab={props.tab} />}</Match>
      <Match when={props.row.type === "group" && (props.row as Group)}>{(group) => <GroupView group={group()} tab={props.tab} />}</Match>
      <Match when={props.row.type === "changes" && (props.row as ChangesItem)}>{(item) => <TurnChanges item={item()} tab={props.tab} />}</Match>
      <Match when={props.row.type === "permission" && (props.row as PermissionItem)}>{(item) => <PermissionRow item={item()} tabId={props.tab.id} />}</Match>
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

/** The head of a running turn: how long Claude has worked on it, counted each second. */
/**
 * The head of a running turn. While Claude Code retries a failed API request, it says so, after T3 Code,
 * so a slow turn does not look stuck.
 */
function WorkingRow(props: { since?: number; retry?: RetryEvent }) {
  const label = () => (props.since ? `Working for ${formatDuration(Math.max(0, now() - props.since))}` : "Working…")
  return (
    <div class="flex min-w-0 items-center gap-2 text-[13px] text-fg-3">
      <Spinner class="size-3.5 shrink-0" />
      <TextShimmer text={label()} />
      <Show when={props.retry}>
        {(retry) => (
          <span class="min-w-0 truncate text-warning">
            · {retry().error}. Retrying, attempt {retry().attempt} of {retry().maxRetries}
          </span>
        )}
      </Show>
    </div>
  )
}

const COMPACTION_LABEL: Record<CompactionItem["status"], string> = {
  running: "Compacting context",
  done: "Context compacted",
  failed: "Context compaction failed",
  stopped: "Context compaction stopped",
}

/**
 * Where Claude Code compacted the thread's context, as a line across the thread after T3 Code: the token
 * counts before and after once it is done, a shimmer while it runs, and the reason when it failed.
 */
function CompactionRow(props: { item: CompactionItem }) {
  const label = () => {
    const { status, preTokens, postTokens } = props.item
    return status === "done" && preTokens && postTokens ? `${COMPACTION_LABEL.done} ${formatTokens(preTokens)} → ${formatTokens(postTokens)} tokens` : COMPACTION_LABEL[status]
  }
  const failed = () => props.item.status === "failed"
  return (
    <div role="separator" aria-label={label()} class="flex items-center gap-3 py-1 text-[12px]" classList={{ "text-del": failed(), "text-fg-3": !failed() }}>
      <span class="h-px flex-1" classList={{ "bg-del/30": failed(), "bg-line": !failed() }} />
      <span class="flex min-w-0 items-center gap-1.5">
        <Icon name={failed() ? "circle-exclamation" : "collapse"} class="size-3 shrink-0" />
        <Show when={props.item.status === "running"} fallback={<span>{label()}</span>}>
          <TextShimmer text={label()} />
        </Show>
        <Show when={props.item.error}>{(error) => <span class="min-w-0 truncate opacity-80">· {error()}</span>}</Show>
      </span>
      <span class="h-px flex-1" classList={{ "bg-del/30": failed(), "bg-line": !failed() }} />
    </div>
  )
}

/** A finished turn's work, folded into one row after T3 Code. It opens to the turn's groups and the text between them. */
function FoldView(props: { fold: Fold<Exclude<Item, Step>>; tab: TabInfo }) {
  const [open, setOpen] = createSignal(false)
  const label = () => {
    const duration = props.fold.durationMs === undefined ? undefined : formatDuration(props.fold.durationMs)
    if (props.fold.stopped) return duration ? `You stopped after ${duration}` : "You stopped this response"
    return duration ? `Worked for ${duration}` : "Worked"
  }
  return (
    <Collapsible variant="ghost" open={open()} onOpenChange={setOpen} class="gap-3.5">
      <Collapsible.Trigger class="inline-flex h-auto w-fit items-center gap-1 text-[13px] font-normal text-fg-3 hover:text-fg-2">
        {label()}
        <Chevron open={open()} class="size-[15px]" />
      </Collapsible.Trigger>
      <Collapsible.Content class="grid gap-3.5">
        <For each={props.fold.rows}>{(row) => <RowView row={row} tab={props.tab} />}</For>
      </Collapsible.Content>
    </Collapsible>
  )
}

/** The icon for a group: its kind's, or a general one when it mixes kinds. */
const groupIcon = (steps: readonly Step[]) => {
  const kinds = new Set(steps.filter((step) => step.type === "tool").map(stepKind))
  return kinds.size === 1 ? ICON_BY_KIND[[...kinds][0]!] : kinds.size ? "code-slash" : ICON_BY_KIND.thought
}

/**
 * Steps in a row, after T3 Code. A live group shows only its latest step, with the latest thought above
 * a tool call, and opens to every step. A finished group shows a summary, such as "Read 3 files and ran
 * 2 commands". A group of one finished step is that step.
 */
function GroupView(props: { group: Group; tab: TabInfo }) {
  const [open, setOpen] = createSignal(false)
  const latest = () => props.group.steps.at(-1)!
  const thought = () => (latest().type === "tool" ? props.group.steps.findLast((step) => step.type === "thinking" && step.text) : undefined)
  return (
    <Switch>
      <Match when={!props.group.live && props.group.steps.length === 1}>
        <StepRow step={latest()} tab={props.tab} />
      </Match>
      <Match when={props.group.live}>
        <div class="grid gap-1.5">
          <Show when={!open() && thought()}>
            {(step) => (
              <div class="flex gap-2 text-[13px] text-fg-3">
                <Icon name={ICON_BY_KIND.thought} class="mt-[3px] size-[14px] shrink-0" />
                <span class="line-clamp-4">{stepLabel(step())}</span>
              </div>
            )}
          </Show>
          <button class="flex h-6 w-fit max-w-full min-w-0 items-center gap-2 text-left text-[13px] text-fg-2" aria-expanded={open()} onClick={() => setOpen(!open())}>
            <Icon name={ICON_BY_KIND[stepKind(latest())]} class="size-[14px] shrink-0 text-fg-3" />
            <TextShimmer class="min-w-0 truncate" text={stepLabel(latest())} />
            <Chevron open={open()} class="size-[13px] shrink-0 text-fg-3" />
          </button>
          <Show when={open()}>
            <StepList steps={props.group.steps} tab={props.tab} />
          </Show>
        </div>
      </Match>
      <Match when={true}>
        <Collapsible variant="ghost" open={open()} onOpenChange={setOpen} class="gap-1.5">
          <Collapsible.Trigger class="inline-flex h-6 w-fit max-w-full items-center gap-2 text-[13px] font-normal text-fg-2 hover:text-fg">
            <Icon name={groupIcon(props.group.steps)} class="size-[14px] shrink-0 text-fg-3" />
            <span class="min-w-0 truncate">{groupSummary(props.group.steps)}</span>
            <Chevron open={open()} class="size-[13px] shrink-0 text-fg-3" />
          </Collapsible.Trigger>
          <Collapsible.Content>
            <StepList steps={props.group.steps} tab={props.tab} />
          </Collapsible.Content>
        </Collapsible>
      </Match>
    </Switch>
  )
}

/** A group's steps, one per row. A long list scrolls in place, and follows new steps while it is scrolled to the end. */
function StepList(props: { steps: Step[]; tab: TabInfo }) {
  let list!: HTMLDivElement
  let atEnd = true
  createEffect(on(() => props.steps.length, () => atEnd && list.scrollTo({ top: list.scrollHeight })))
  return (
    <div
      ref={list}
      class="ml-[7px] grid max-h-[min(18rem,50dvh)] content-start overflow-y-auto pl-[13px] shadow-[inset_1px_0_0_var(--color-line)]"
      onScroll={() => (atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 4)}
    >
      <For each={props.steps}>{(step) => <StepRow step={step} tab={props.tab} />}</For>
    </div>
  )
}

/** A transcript drawn plainly, step by step, for a subagent's card. Steps show their labels, and text shows in full. */
export function Transcript(props: { items: readonly ThreadItem[]; tab: TabInfo }) {
  return (
    <div class="grid min-w-0 gap-0.5">
      <For each={props.items}>
        {(item) => (
          <Switch>
            <Match when={isStep(item) && item}>{(step) => <StepRow step={step()} tab={props.tab} />}</Match>
            <Match when={item.type === "text" && item}>
              {(text) => (
                <div class="my-1 text-[13px]">
                  <Markdown text={text().text} done onOpenFile={(path, line) => openFile(props.tab.project, path, line)} />
                </div>
              )}
            </Match>
          </Switch>
        )}
      </For>
    </div>
  )
}

/** One step: its icon and label. It opens to the thought in full, the edit's diff or the call's output. */
function StepRow(props: { step: Step; tab: TabInfo }) {
  const [open, setOpen] = createSignal(false)
  const failed = () => props.step.type === "tool" && !!props.step.result?.isError
  const isCommand = () => props.step.type === "tool" && stepKind(props.step) === "command"
  const hasDetail = () => (props.step.type === "thinking" ? !!props.step.text : isCommand() || !!props.step.edits?.length || !!props.step.result)
  return (
    <div class="min-w-0">
      <button
        class="flex h-6 w-full min-w-0 items-center gap-2 text-left text-[13px] text-fg-2 enabled:hover:text-fg"
        disabled={!hasDetail()}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <Icon name={ICON_BY_KIND[stepKind(props.step)]} class="size-[14px] shrink-0 text-fg-3" />
        <span class="min-w-0 truncate" classList={{ "text-del": failed() }}>
          {stepLabel(props.step)}
        </span>
        <Show when={hasDetail()}>
          <Chevron open={open()} class="size-[13px] shrink-0 text-fg-3" />
        </Show>
      </button>
      <Show when={open()}>
        <div class="mb-2 mt-1 pl-[22px]">
          <Switch>
            <Match when={props.step.type === "thinking" && props.step.text}>
              {(text) => (
                <div class="text-[13px] text-fg-2">
                  <Markdown text={text()} done onOpenFile={(path, line) => openFile(props.tab.project, path, line)} />
                </div>
              )}
            </Match>
            <Match when={props.step.type === "tool" && !!props.step.edits?.length && (props.step as ToolItem)}>{(tool) => <EditBlock tool={tool()} />}</Match>
            <Match when={props.step.type === "tool" && (props.step as ToolItem)}>
              {(tool) => (
                <pre class="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-ground px-3 py-2.5 font-mono text-[12px] text-fg-2 shadow-[0_0_0_1px_var(--color-line)]">
                  {/* The label names only the program, so a command's detail starts with the command in full. */}
                  <Show when={isCommand()}>
                    <span class="text-fg">$ {tool().summary}</span>
                    {"\n"}
                  </Show>
                  {tool().result ? tool().result!.output || "(no output)" : "Running…"}
                </pre>
              )}
            </Match>
          </Switch>
        </div>
      </Show>
    </div>
  )
}

/**
 * The files a turn changed, under its answer, after T3 Code: one quiet box with a count, the line totals
 * and the files. Each file opens in the editor. The latest turn's box also opens Review on its changes.
 */
function TurnChanges(props: { item: ChangesItem; tab: TabInfo }) {
  const totals = () => props.item.files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 })
  const latest = () => threadOf(props.tab.id).items.findLast((item) => item.type === "changes")?.id === props.item.id
  return (
    <div class="rounded-2xl bg-well">
      <div class="flex min-w-0 items-center gap-3 px-3 pb-1 pt-2 text-[12px] font-medium text-fg">
        {plural(props.item.files.length, "changed file")}
        <DiffChanges changes={totals()} />
        <Show when={latest()}>
          <Button size="small" variant="ghost-muted" icon="review" class="ml-auto" onClick={() => openReview("turn")}>
            Open diff
          </Button>
        </Show>
      </div>
      <div class="max-h-60 overflow-y-auto px-1.5 pb-1.5">
        <For each={props.item.files}>
          {(file) => {
            const slash = file.path.lastIndexOf("/")
            return (
              <button class="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] hover:bg-hover" title={file.path} onClick={() => openFile(props.tab.project, file.path)}>
                <svg class="size-[13px] shrink-0" aria-hidden="true">
                  <use href={`#${fileIcon(file.path)}`} />
                </svg>
                <span class="min-w-0 flex-1 truncate">
                  <span class="text-fg">{file.path.slice(slash + 1)}</span>
                  <Show when={slash > 0}>
                    <span class="ml-1.5 text-fg-3">{file.path.slice(0, slash)}</span>
                  </Show>
                </span>
                <DiffChanges class="shrink-0" changes={file} />
              </button>
            )
          }}
        </For>
      </div>
    </div>
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

/** How each kind of permission request reads, after T3 Code. Requests share the icons of the steps they would run. */
const PERMISSION: Record<PermissionItem["kind"], { icon: IconName; label: string }> = {
  command: { icon: ICON_BY_KIND.command, label: "Command approval" },
  "file-change": { icon: ICON_BY_KIND.edit, label: "File change approval" },
  "file-read": { icon: ICON_BY_KIND.read, label: "File read approval" },
  permission: { icon: "lock", label: "Permission approval" },
}

/**
 * A tool call waiting for approval, as a work row after T3 Code: what Claude would run or touch, why
 * Claude Code asks, then Decline and Approve. More holds Always allow this session and Cancel, which also
 * stops the turn.
 */
function PermissionRow(props: { item: PermissionItem; tabId: string }) {
  const answer = (value: PermissionAnswer) => answerPermission(props.tabId, props.item.requestId, value)
  return (
    <div role="group" aria-label={PERMISSION[props.item.kind].label} class="flex min-w-0 flex-col gap-1 text-[13px]">
      <div class="flex min-w-0 items-start gap-2">
        <span class="flex h-5 shrink-0 items-center">
          <Icon name={PERMISSION[props.item.kind].icon} class="size-[14px] text-fg-3" />
        </span>
        <code tabIndex={0} class="block max-h-40 min-w-0 select-text overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-5 text-fg [overflow-wrap:anywhere]">
          {props.item.detail}
        </code>
      </div>
      <div class="flex min-w-0 flex-col gap-1 pl-[22px] text-[12px]">
        <Show when={props.item.reason}>{(reason) => <span class="select-text text-fg-3 [overflow-wrap:anywhere]">{reason()}</span>}</Show>
        <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span class="inline-flex items-center gap-1 text-warning">
            <Icon name="lock" class="size-3 shrink-0" />
            Waiting for approval
          </span>
          <span aria-hidden="true" class="text-fg-3">
            ·
          </span>
          <Button size="small" variant="ghost-muted" onClick={() => answer("decline")}>
            Decline
          </Button>
          <Button size="small" variant="contrast" onClick={() => answer("allow")}>
            Approve
          </Button>
          <Menu>
            <Menu.Trigger as={Button} size="small" variant="ghost-muted" aria-label="More approval options">
              More
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Show when={props.item.allowSession}>
                  <Menu.Item onSelect={() => answer("allow-session")}>Always allow this session</Menu.Item>
                </Show>
                <Menu.Item onSelect={() => answer("cancel")}>Cancel and stop the turn</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </div>
      </div>
    </div>
  )
}
