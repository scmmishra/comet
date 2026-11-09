import type { Space } from "@desk/protocol"
import { createSignal, Show, type JSX } from "solid-js"
import { Icon, type IconName } from "./icons"

const NUMBER = new Intl.NumberFormat("en")

/**
 * The Space card: where the session runs and what has changed there. It sits inside the session.
 * Local facts come first. GitHub's pull request and checks sit below a line, when the branch has one.
 */
export function SpaceCard(props: { space: Space }) {
  const pr = () => props.space.pr
  return (
    <section class="flex flex-col rounded-3xl border border-outline bg-card">
      <div class="p-1.5">
        <Row icon="folder">{props.space.root.replace(/^\/Users\/[^/]+/, "~")}</Row>
        <div class="h-1.5" />
        <Row icon="branch" detail={upstream(props.space)}>
          {props.space.branch}
        </Row>
        <Row icon="diff" detail={<Changes changes={props.space.changes} />}>
          Changes
        </Row>
      </div>
      <Show when={pr()}>
        {(found) => (
          <div class="border-t border-outline p-1.5">
            <a class="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 rounded-lg px-2 py-[7px] hover:bg-panel" href={found().url} target="_blank">
              <Icon name="pr" class="text-fg-2" />
              <span class="leading-snug">{found().title}</span>
              <span class="col-start-2 flex items-center justify-between text-fg-3">
                <span class="font-mono">#{found().number}</span>
                <span class={`rounded-full px-[7px] text-[11px] leading-[19px] ${prTone(found())}`}>{prLabel(found())}</span>
              </span>
            </a>
            <Show when={checksTotal(found()) > 0}>
              <Row icon="check" detail={checksBadge(found())}>
                Checks
              </Row>
            </Show>
          </div>
        )}
      </Show>
    </section>
  )
}

/**
 * The Space card folded into the session header, for when the panel takes the room. Hovering or
 * focusing the chip opens the full card.
 */
export function SpaceChip(props: { space: Space }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocusIn={() => setOpen(true)} onFocusOut={() => setOpen(false)}>
      <button class="flex h-7 items-center gap-2 rounded-lg bg-raised px-2.5 text-[12px] text-fg-2 hover:text-fg" aria-expanded={open()}>
        <Icon name="branch" />
        <span class="max-w-[160px] truncate text-fg">{props.space.branch}</span>
        <Changes changes={props.space.changes} />
      </button>
      <Show when={open()}>
        {/* The padding bridges the gap to the card, so moving the pointer onto it keeps it open. */}
        <div class="absolute right-0 top-full z-30 w-[264px] pt-1.5">
          <div class="desk-pop shadow-[0_18px_40px_rgb(0_0_0/50%)]">
            <SpaceCard space={props.space} />
          </div>
        </div>
      </Show>
    </div>
  )
}

function Row(props: { icon: IconName; detail?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-[7px]">
      <Icon name={props.icon} class="text-fg-2" />
      <span class="min-w-0 flex-1 truncate">{props.children}</span>
      <Show when={props.detail}>
        <span class="shrink-0 text-fg-3">{props.detail}</span>
      </Show>
    </div>
  )
}

function Changes(props: { changes: Space["changes"] }) {
  return (
    <Show when={props.changes.files > 0} fallback={<span>None</span>}>
      <span class="flex gap-1.5 font-mono tabular-nums">
        <Show when={props.changes.additions}>
          <span class="text-add">+{NUMBER.format(props.changes.additions)}</span>
        </Show>
        <Show when={props.changes.deletions}>
          <span class="text-del">−{NUMBER.format(props.changes.deletions)}</span>
        </Show>
        <Show when={!props.changes.additions && !props.changes.deletions}>
          <span>{props.changes.files} files</span>
        </Show>
      </span>
    </Show>
  )
}

function upstream(space: Space) {
  if (!space.upstream) return undefined
  const parts = []
  if (space.upstream.ahead) parts.push(`↑${space.upstream.ahead}`)
  if (space.upstream.behind) parts.push(`↓${space.upstream.behind}`)
  return parts.join(" ") || undefined
}

type PullRequest = NonNullable<Space["pr"]>

function prLabel(pr: PullRequest) {
  if (pr.state === "MERGED") return "Merged"
  if (pr.state === "CLOSED") return "Closed"
  return pr.draft ? "Draft" : "Ready"
}

function prTone(pr: PullRequest) {
  return pr.state === "OPEN" && !pr.draft ? "bg-ready text-[#fff]" : "bg-hover text-fg-2"
}

const checksTotal = (pr: PullRequest) => pr.checks.passed + pr.checks.failed + pr.checks.pending

function checksBadge(pr: PullRequest) {
  const total = checksTotal(pr)
  if (pr.checks.failed) return <span class="rounded-full bg-del-soft px-[7px] text-[11px] leading-[19px] text-del">{pr.checks.failed} failing</span>
  if (pr.checks.pending) return <span class="rounded-full bg-hover px-[7px] text-[11px] leading-[19px] text-fg-2">{pr.checks.pending} running</span>
  return <span class="rounded-full bg-add-soft px-[7px] text-[11px] leading-[19px] text-add">{`${pr.checks.passed} / ${total}`}</span>
}
