import type { Space } from "@desk/protocol"
import { Show } from "solid-js"

const NUMBER = new Intl.NumberFormat("en")

/** The Space card: where the session runs and what has changed there. It sits inside the session. */
export function SpaceCard(props: { space: Space }) {
  const pr = () => props.space.pr
  return (
    <section class="flex flex-col gap-0.5 rounded-xl bg-surface-raised-base p-1.5 text-sm">
      <Row label={props.space.root.replace(/^\/Users\/[^/]+/, "~")} muted />
      <Row label={props.space.branch} detail={upstream(props.space)} />
      <Show when={pr()}>
        {(found) => (
          <a class="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-surface-raised-base-hover" href={found().url} target="_blank">
            <span class="leading-snug text-text-strong">{found().title}</span>
            <span class="flex items-center justify-between text-text-weak">
              <span class="font-mono">#{found().number}</span>
              <span class={`rounded-full px-2 text-xs leading-5 ${prTone(found())}`}>{prLabel(found())}</span>
            </span>
          </a>
        )}
      </Show>
      <Show when={pr() && checksTotal(pr()!) > 0}>
        <Row label="Checks" detail={checksLabel(pr()!)} />
      </Show>
      <div class="flex items-center gap-2 rounded-md px-2 py-1.5">
        <span class="flex-1 text-text-base">Changes</span>
        <Show when={props.space.changes.files > 0} fallback={<span class="text-text-weaker">None</span>}>
          <span class="font-mono text-text-diff-add-base">+{NUMBER.format(props.space.changes.additions)}</span>
          <span class="font-mono text-text-diff-delete-base">−{NUMBER.format(props.space.changes.deletions)}</span>
        </Show>
      </div>
    </section>
  )
}

function Row(props: { label: string; detail?: string; muted?: boolean }) {
  return (
    <div class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5">
      <span class={`min-w-0 flex-1 truncate ${props.muted ? "text-text-weak" : "text-text-base"}`}>{props.label}</span>
      <Show when={props.detail}>
        <span class="shrink-0 text-text-weak">{props.detail}</span>
      </Show>
    </div>
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
  return pr.draft ? "Draft" : "Open"
}

function prTone(pr: PullRequest) {
  if (pr.state === "OPEN" && !pr.draft) return "bg-surface-success-base text-text-on-success-base"
  return "bg-surface-base text-text-weak"
}

const checksTotal = (pr: PullRequest) => pr.checks.passed + pr.checks.failed + pr.checks.pending

function checksLabel(pr: PullRequest) {
  if (pr.checks.failed) return `${pr.checks.failed} failing`
  if (pr.checks.pending) return `${pr.checks.pending} running`
  return `${pr.checks.passed} passed`
}
