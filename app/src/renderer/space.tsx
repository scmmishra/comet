import type { Space } from "@desk/protocol"
import { Badge } from "@opencode/ui/badge"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { HoverCard } from "@opencode/ui/hover-card"
import { Show, type JSX } from "solid-js"
import { CommandsCard } from "./commands"
import { plural, shortPath } from "./format"
import { Icon, type IconName } from "./icons"
import { projectData } from "./projects"

type PullRequest = NonNullable<Space["pr"]>

/** How a pull request's state reads, and how its badge draws. */
function prState(pr: PullRequest): { label: string; variant: "accent" | "neutral" } {
  if (pr.state === "MERGED") return { label: "Merged", variant: "neutral" }
  if (pr.state === "CLOSED") return { label: "Closed", variant: "neutral" }
  return pr.draft ? { label: "Draft", variant: "neutral" } : { label: "Ready", variant: "accent" }
}

/** A project's cards, stacked: the Space card when the folder is a repo, then its commands. */
export function ProjectCards(props: { project: string }) {
  return (
    <>
      <Show when={projectData(props.project).space}>{(space) => <SpaceCard space={space()} />}</Show>
      <CommandsCard project={props.project} />
    </>
  )
}

/**
 * The Space card: where the session runs and what has changed there. It sits inside the session.
 * Local facts come first. GitHub's pull request and checks sit below a line, when the branch has one.
 */
function SpaceCard(props: { space: Space }) {
  return (
    <section class="flex flex-col rounded-3xl border border-outline bg-card">
      <div class="p-1.5">
        <Row icon="folder">{shortPath(props.space.root)}</Row>
        <div class="h-1.5" />
        <Row icon="branch" detail={upstream(props.space)}>
          {props.space.branch}
        </Row>
        <Row icon="review" detail={<Changes changes={props.space.changes} />}>
          Changes
        </Row>
      </div>
      <Show when={props.space.pr}>
        {(pr) => (
          <div class="border-t border-outline p-1.5">
            <a class="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 rounded-lg px-2 py-[7px] hover:bg-panel" href={pr().url} target="_blank">
              <Icon name="pull-request" class="text-fg-2" />
              <span class="leading-snug">{pr().title}</span>
              <span class="col-start-2 flex items-center justify-between text-fg-3">
                <span class="font-mono">#{pr().number}</span>
                <Badge variant={prState(pr()).variant}>{prState(pr()).label}</Badge>
              </span>
            </a>
            <Show when={checksTotal(pr()) > 0}>
              <Row icon="check" detail={checksBadge(pr())}>
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
 * A project's cards folded into the session header, for when the panel takes the room. Hovering or
 * focusing the chip opens them. A folder that is not a repo has only its commands to show.
 */
export function SpaceChip(props: { project: string; space: Space | null | undefined }) {
  return (
    <HoverCard
      placement="bottom-end"
      openDelay={0}
      class="w-[264px] max-w-none border-0 bg-transparent shadow-none [&_[data-slot=hover-card-body]]:p-0"
      trigger={
        <button class="flex h-7 items-center gap-2 rounded-lg bg-raised px-2.5 text-[12px] text-fg-2 hover:text-fg">
          <Show when={props.space} fallback={<span class="text-fg">Commands</span>}>
            {(space) => (
              <>
                <Icon name="branch" />
                <span class="max-w-[160px] truncate text-fg">{space().branch}</span>
                <Changes changes={space().changes} />
              </>
            )}
          </Show>
        </button>
      }
    >
      <div class="flex flex-col gap-2">
        <ProjectCards project={props.project} />
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
      <Show when={props.changes.additions || props.changes.deletions} fallback={<span>{plural(props.changes.files, "file")}</span>}>
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

const checksTotal = (pr: PullRequest) => pr.checks.passed + pr.checks.failed + pr.checks.pending

function checksBadge(pr: PullRequest) {
  if (pr.checks.failed) return <Badge class="border-0 bg-del-soft text-del">{pr.checks.failed} failing</Badge>
  if (pr.checks.pending) return <Badge variant="subtle">{pr.checks.pending} running</Badge>
  return <Badge class="border-0 bg-add-soft text-add">{`${pr.checks.passed} / ${checksTotal(pr)}`}</Badge>
}
