import type { Space } from "@desk/protocol"
import { Show, type JSX } from "solid-js"
import { Icon, type IconName } from "./icons"

const NUMBER = new Intl.NumberFormat("en")

/** The Space card: where the session runs and what has changed there. It sits inside the session. */
export function SpaceCard(props: { space: Space }) {
  const pr = () => props.space.pr
  return (
    <section class="flex flex-col rounded-xl bg-surface-raised-base p-1.5 text-sm">
      <Row icon="folder" muted>
        {props.space.root.replace(/^\/Users\/[^/]+/, "~")}
      </Row>
      <div class="mx-2 my-1 h-px bg-border-weak-base" />
      <Row icon="branch" detail={upstream(props.space)}>
        {props.space.branch}
      </Row>
      <Show when={pr()}>
        {(found) => (
          <a class="flex gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-raised-base-hover" href={found().url} target="_blank">
            <Icon name="pr" class="mt-0.5 text-text-weak" />
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="leading-snug text-text-strong">{found().title}</span>
              <span class="flex items-center justify-between text-text-weak">
                <span class="font-mono">#{found().number}</span>
                <span class={`rounded-full px-2 text-xs leading-5 ${prTone(found())}`}>{prLabel(found())}</span>
              </span>
            </span>
          </a>
        )}
      </Show>
      <Show when={pr() && checksTotal(pr()!) > 0}>
        <Row icon="check" detail={checksLabel(pr()!)}>
          Checks
        </Row>
      </Show>
      <Row icon="diff" detail={<Changes changes={props.space.changes} />}>
        Changes
      </Row>
    </section>
  )
}

function Row(props: { icon: IconName; detail?: JSX.Element; muted?: boolean; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5">
      <Icon name={props.icon} class="text-text-weak" />
      <span class={`min-w-0 flex-1 truncate ${props.muted ? "text-text-weak" : "text-text-base"}`}>{props.children}</span>
      <Show when={props.detail}>
        <span class="shrink-0 text-text-weak">{props.detail}</span>
      </Show>
    </div>
  )
}

function Changes(props: { changes: Space["changes"] }) {
  return (
    <Show when={props.changes.files > 0} fallback={<span class="text-text-weaker">None</span>}>
      <span class="flex gap-1.5 font-mono">
        <Show when={props.changes.additions}>
          <span class="text-text-diff-add-base">+{NUMBER.format(props.changes.additions)}</span>
        </Show>
        <Show when={props.changes.deletions}>
          <span class="text-text-diff-delete-base">−{NUMBER.format(props.changes.deletions)}</span>
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
