import type { TabInfo } from "@desk/protocol"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, Show, type JSX } from "solid-js"
import { now } from "./clock"
import { formatDuration } from "./format"
import { Icon, type IconName } from "./icons"
import { projectData } from "./projects"
import { forceStop, restoreBranch, threadOf } from "./threads"

/** Branch notices the user dismissed, by tab and the two branches, so a later move shows a new one. */
const [dismissed, setDismissed] = createSignal(new Set<string>())

/**
 * Notices about the tab's thread, above the composer, after T3 Code: a turn that is stopping, and a
 * checkout that moved off the branch the thread last ran on.
 */
export function ThreadNotices(props: { tab: TabInfo }) {
  return (
    <>
      <StoppingNotice tab={props.tab} />
      <BranchNotice tab={props.tab} />
    </>
  )
}

/** "Stopping" with how long it has taken. Once Claude Code has not stopped in time, Force stop ends the turn. */
function StoppingNotice(props: { tab: TabInfo }) {
  const stopping = () => threadOf(props.tab.id).stopping
  return (
    <Show when={stopping()}>
      {(stop) => (
        <Notice icon={stop().unresponsive ? "circle-exclamation" : "stop"} warning={stop().unresponsive} label="Stopping">
          <span class="min-w-0 flex-1 truncate">
            <Show when={stop().unresponsive} fallback="Stopping">
              Claude Code is not responding to Stop. <span class="text-fg-3">Force stop ends its process.</span>
            </Show>
          </span>
          <span class="shrink-0 tabular-nums">{formatDuration(Math.max(1000, now() - stop().since))}</span>
          <Show when={stop().unresponsive}>
            <Button size="small" variant="ghost" class="shrink-0" onClick={() => forceStop(props.tab.id)}>
              Force stop
            </Button>
          </Show>
        </Notice>
      )}
    </Show>
  )
}

/** The project's checkout is on another branch than the thread last ran on. Restore switches back. */
function BranchNotice(props: { tab: TabInfo }) {
  const threadBranch = () => threadOf(props.tab.id).branch
  const current = () => projectData(props.tab.project).space?.branch
  const key = () => `${props.tab.id}\n${threadBranch()}\n${current()}`
  const moved = () => !!threadBranch() && !!current() && threadBranch() !== current() && !dismissed().has(key())
  return (
    <Show when={moved()}>
      <Notice icon="branch" label="Branch changed">
        <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span class="shrink-0">Branch changed from</span>
          <Tooltip value={`This thread last ran on ${threadBranch()}. Sending continues on ${current()}.`} placement="top" class="min-w-0">
            <code class="block min-w-0 truncate font-mono text-[12px] text-fg">{threadBranch()}</code>
          </Tooltip>
        </span>
        <Button size="small" variant="ghost" class="shrink-0" disabled={threadOf(props.tab.id).busy} onClick={() => restoreBranch(props.tab.id)}>
          Restore branch
        </Button>
        <IconButton variant="ghost-muted" size="small" aria-label="Dismiss branch change notice" icon={<Icon name="xmark-small" />} onClick={() => setDismissed((set) => new Set(set).add(key()))} />
      </Notice>
    </Show>
  )
}

/** One notice row, laid out as the background commands row above it. */
function Notice(props: { icon: IconName; label: string; warning?: boolean; children: JSX.Element }) {
  return (
    <div role="status" aria-label={props.label} class="mb-2 flex min-w-0 items-center gap-2 px-1 text-[13px]" classList={{ "text-warning": props.warning, "text-fg-3": !props.warning }}>
      <Icon name={props.icon} class="size-[14px] shrink-0" />
      {props.children}
    </div>
  )
}
