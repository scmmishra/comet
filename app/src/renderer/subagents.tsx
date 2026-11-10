import type { Subagent, TabInfo } from "@desk/protocol"
import { Popover } from "@opencode/ui/popover"
import { createEffect, createSignal, For, on, Show } from "solid-js"
import { now } from "./clock"
import { formatDuration, plural } from "./format"
import { ClaudeMark, Icon } from "./icons"
import { Transcript } from "./thread"
import { threadOf } from "./threads"

const STATUS: Record<Subagent["status"], { label: string; dot: string }> = {
  running: { label: "Running", dot: "bg-accent" },
  completed: { label: "Done", dot: "bg-add" },
  failed: { label: "Failed", dot: "bg-del" },
  stopped: { label: "Stopped", dot: "bg-fg-3" },
}

const elapsed = (subagent: Subagent) => formatDuration(Math.max(0, (subagent.endedAt ?? now()) - subagent.startedAt))

/**
 * The subagents Claude started, in a card at the top of the stack. The card shows while one runs, or
 * while the turn that started them runs, and leaves when both are done. A subagent opens in a popover
 * beside the card with what it has done so far. It never becomes a thread of its own.
 */
export function SubagentsCard(props: { tab: TabInfo }) {
  const thread = () => threadOf(props.tab.id)
  const list = () => Object.values(thread().subagents ?? {}).sort((a, b) => a.startedAt - b.startedAt)
  const running = () => list().filter((subagent) => subagent.status === "running").length
  return (
    <Show when={running() > 0 || (thread().busy && list().length > 0)}>
      <section class="flex flex-col rounded-3xl border border-outline bg-card p-1.5" aria-label="Subagents">
        <span class="px-2 pb-1 pt-1.5 text-[12px] text-fg-3">
          Subagents{running() ? ` · ${running()} running` : ""}
        </span>
        <For each={list()}>{(subagent) => <SubagentRow subagent={subagent} tab={props.tab} />}</For>
      </section>
    </Show>
  )
}

/** Claude's mark with a dot for how the subagent stands. */
function StatusMark(props: { status: Subagent["status"] }) {
  return (
    <span class="relative flex shrink-0">
      <ClaudeMark />
      <span class={`absolute -bottom-0.5 -right-0.5 size-[7px] rounded-full ring-2 ring-[var(--color-card)] ${STATUS[props.status].dot}`} />
    </span>
  )
}

function SubagentRow(props: { subagent: Subagent; tab: TabInfo }) {
  const [open, setOpen] = createSignal(false)
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="left-start"
      gutter={12}
      class="w-[min(440px,calc(100vw-32px))] max-w-none [&>[data-slot=popover-body]]:p-0"
      triggerAs="button"
      triggerProps={{
        type: "button",
        class: "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-[7px] text-left hover:bg-panel",
        classList: { "bg-panel": open() },
      }}
      trigger={
        <>
          <StatusMark status={props.subagent.status} />
          <span class="min-w-0 flex-1 truncate text-[13px] text-fg">{props.subagent.description}</span>
          <span class="shrink-0 text-[12px] tabular-nums text-fg-3">{elapsed(props.subagent)}</span>
          <Icon name="chevron-right" class="size-3 shrink-0 text-fg-3" />
        </>
      }
    >
      <SubagentDetail subagent={props.subagent} tab={props.tab} />
    </Popover>
  )
}

/** What a subagent was asked, how it stands, and its steps so far, following new ones while scrolled to the end. */
function SubagentDetail(props: { subagent: Subagent; tab: TabInfo }) {
  let body!: HTMLDivElement
  let atEnd = true
  createEffect(on(() => props.subagent.items.length, () => atEnd && body.scrollTo({ top: body.scrollHeight })))
  const facts = () =>
    [props.subagent.type, STATUS[props.subagent.status].label, elapsed(props.subagent), props.subagent.toolUses ? plural(props.subagent.toolUses, "tool use") : undefined]
      .filter(Boolean)
      .join(" · ")
  return (
    <div class="flex max-h-[min(560px,70vh)] flex-col">
      <header class="border-b border-outline px-4 py-3">
        <div class="flex min-w-0 items-center gap-2">
          <StatusMark status={props.subagent.status} />
          <b class="min-w-0 truncate text-[13px] font-medium text-fg">{props.subagent.description}</b>
        </div>
        <div class="mt-1 text-[12px] text-fg-3">{facts()}</div>
        <Show when={props.subagent.summary}>{(summary) => <div class="mt-1.5 text-[13px] text-fg-2">{summary()}</div>}</Show>
      </header>
      <div ref={body} class="min-h-0 overflow-y-auto px-4 py-3" onScroll={() => (atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 4)}>
        <Show when={props.subagent.prompt}>{(prompt) => <p class="mb-2 line-clamp-3 whitespace-pre-wrap text-[12px] text-fg-3">{prompt()}</p>}</Show>
        <Show when={props.subagent.items.length} fallback={<span class="text-[13px] text-fg-3">No steps yet.</span>}>
          <Transcript items={props.subagent.items} tab={props.tab} />
        </Show>
      </div>
    </div>
  )
}
