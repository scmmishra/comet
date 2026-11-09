import type { TabInfo } from "@desk/protocol"
import { Menu } from "@opencode/ui/menu"
import { For, onMount, Show } from "solid-js"
import { Composer } from "./composer"
import { formatAgo, otherBranch } from "./format"
import { Icon } from "./icons"
import { ProjectMark } from "./project-mark"
import { projectData, projectLabel, readProject } from "./projects"
import { openThread } from "./threads"
import { changeTab, workspace } from "./workspace"

/** Threads the start screen offers to pick up again. */
const RECENT_THREADS = 8

/** A new tab: the composer, the project and branch it works in, and threads to pick up again. */
export function StartScreen(props: { tab: TabInfo }) {
  onMount(() => readProject(props.tab.project, "threads"))
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center gap-[18px] overflow-y-auto px-4 pb-6 pt-[6vh]">
      <div class="desk-wordmark" aria-hidden="true">desk</div>
      <div class="relative flex w-full max-w-column flex-col gap-[18px]">
        <Composer tab={props.tab} />
        <div class="flex items-center gap-1 px-0.5 text-fg-2">
          <ProjectSwitcher tab={props.tab} />
          <Show when={projectData(props.tab.project).space}>
            {(space) => (
              <>
                <span class="text-fg-3">/</span>
                <span class="flex items-center gap-1.5 px-1.5">
                  <Icon name="branch" />
                  {space().branch}
                </span>
              </>
            )}
          </Show>
        </div>
        <RecentThreads project={props.tab.project} />
      </div>
    </div>
  )
}

/** Moves this tab to another project. Its thread has not started, so nothing is lost. */
function ProjectSwitcher(props: { tab: TabInfo }) {
  const use = (project: string) => changeTab(props.tab.id, { project })

  return (
    <Menu placement="bottom-start" gutter={8}>
      <Menu.Trigger class="flex h-8 items-center gap-2 rounded-lg px-1.5 hover:bg-hover hover:text-fg data-[expanded]:bg-hover data-[expanded]:text-fg">
        <ProjectMark project={props.tab.project} class="size-[18px]" />
        {projectLabel(props.tab.project)}
        <Icon name="chevron-down" class="size-3 text-fg-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content class="w-[280px]">
          <Menu.Group>
            <Menu.GroupLabel>Projects</Menu.GroupLabel>
            <Menu.RadioGroup value={props.tab.project}>
              <For each={workspace.recent}>
                {(project) => (
                  <Menu.RadioItem value={project} title={project} closeOnSelect onSelect={() => use(project)}>
                    <span class="flex min-w-0 items-center gap-2.5">
                      <ProjectMark project={project} />
                      <span class="truncate">{projectLabel(project)}</span>
                    </span>
                  </Menu.RadioItem>
                )}
              </For>
            </Menu.RadioGroup>
          </Menu.Group>
          <Menu.Separator />
          <Menu.Item onSelect={() => void window.desk.chooseFolder().then((path) => path && use(path))}>
            Open folder…
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

/** Threads in this tab's project that no tab has open. Picking one continues it in this tab. */
function RecentThreads(props: { project: string }) {
  const data = () => projectData(props.project)
  const closed = () => (data().threads ?? []).filter((thread) => !thread.tabId).slice(0, RECENT_THREADS)
  return (
    <Show when={closed().length > 0}>
      <section class="grid gap-1 pt-2">
        <h2 class="px-2 pb-1 text-[12px] text-fg-3">Recent threads</h2>
        <For each={closed()}>
          {(thread) => (
            <button type="button" class="group flex h-9 min-w-0 items-center gap-3 rounded-lg px-2 text-left hover:bg-hover" onClick={() => openThread(thread, props.project)}>
              <span class="min-w-0 flex-1 truncate text-fg-2 group-hover:text-fg">{thread.title}</span>
              <Show when={otherBranch(thread, data().space?.branch)}>
                {(branch) => (
                  <span class="flex shrink-0 items-center gap-1 text-[12px] text-fg-3">
                    <Icon name="branch" class="size-[13px]" />
                    {branch()}
                  </span>
                )}
              </Show>
              <span class="w-12 shrink-0 whitespace-nowrap text-right text-[12px] tabular-nums text-fg-3">{formatAgo(thread.updatedAt)}</span>
            </button>
          )}
        </For>
      </section>
    </Show>
  )
}
