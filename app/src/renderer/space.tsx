import type { Space } from "@desk/protocol"
import { Badge } from "@opencode/ui/badge"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { HoverCard } from "@opencode/ui/hover-card"
import { Show, type JSX } from "solid-js"
import { CommandsCard } from "./commands"
import { Icon, type IconName } from "./icons"

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
        <Row icon="review" detail={<Changes changes={props.space.changes} />}>
          Changes
        </Row>
      </div>
      <Show when={pr()}>
        {(found) => (
          <div class="border-t border-outline p-1.5">
            <a class="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 rounded-lg px-2 py-[7px] hover:bg-panel" href={found().url} target="_blank">
              <Icon name="pull-request" class="text-fg-2" />
              <span class="leading-snug">{found().title}</span>
              <span class="col-start-2 flex items-center justify-between text-fg-3">
                <span class="font-mono">#{found().number}</span>
                <Badge variant={found().state === "OPEN" && !found().draft ? "accent" : "neutral"}>{prLabel(found())}</Badge>
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
 * The Space and Commands cards folded into the session header, for when the panel takes the room.
 * Hovering or focusing the chip opens both cards.
 */
export function SpaceChip(props: { space: Space }) {
  return (
    <HoverCard
      placement="bottom-end"
      openDelay={0}
      class="w-[264px] max-w-none border-0 bg-transparent shadow-none [&_[data-slot=hover-card-body]]:p-0"
      trigger={
        <button class="flex h-7 items-center gap-2 rounded-lg bg-raised px-2.5 text-[12px] text-fg-2 hover:text-fg">
          <Icon name="branch" />
          <span class="max-w-[160px] truncate text-fg">{props.space.branch}</span>
          <Changes changes={props.space.changes} />
        </button>
      }
    >
      <div class="flex flex-col gap-2">
        <SpaceCard space={props.space} />
        <CommandsCard />
      </div>
    </HoverCard>
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
      {/* A change with no line counts, such as a binary file, counts files instead. */}
      <Show when={props.changes.additions || props.changes.deletions} fallback={<span>{props.changes.files} files</span>}>
        <DiffChanges changes={props.changes} />
      </Show>
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

const checksTotal = (pr: PullRequest) => pr.checks.passed + pr.checks.failed + pr.checks.pending

function checksBadge(pr: PullRequest) {
  const total = checksTotal(pr)
  if (pr.checks.failed) return <Badge class="border-0 bg-del-soft text-del">{pr.checks.failed} failing</Badge>
  if (pr.checks.pending) return <Badge variant="subtle">{pr.checks.pending} running</Badge>
  return <Badge class="border-0 bg-add-soft text-add">{`${pr.checks.passed} / ${total}`}</Badge>
}
