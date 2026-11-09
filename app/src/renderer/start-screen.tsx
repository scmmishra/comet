import { Menu } from "@opencode/ui/menu"
import { createResource, For, onMount, Show } from "solid-js"
import { Composer } from "./composer"
import { formatAgo } from "./format"
import { Icon } from "./icons"
import { ProjectMark, projectLabel } from "./project-mark"
import { activeData, openThread, refreshThreads, setTabProject, type Tab } from "./store"

/** A new tab: the composer, the project and branch it works in, and threads to pick up again. */
export function StartScreen(props: { tab: Tab }) {
  onMount(refreshThreads)
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center gap-[18px] overflow-y-auto px-4 pb-6 pt-[6vh]">
      <div class="desk-wordmark" aria-hidden="true">desk</div>
      <div class="relative flex w-full max-w-[720px] flex-col gap-[18px]">
        <Composer tab={props.tab} />
        <div class="flex items-center gap-1 px-0.5 text-fg-2">
          <ProjectSwitcher tab={props.tab} />
          <Show when={activeData().space}>
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
        <RecentThreads />
      </div>
    </div>
  )
}

/** Moves this tab to another project. Its thread has not started, so nothing is lost. */
function ProjectSwitcher(props: { tab: Tab }) {
  const [projects, { refetch }] = createResource(() => window.desk.projects())
  const use = (path: string) => {
    void window.desk.useProject(path)
    setTabProject(path)
  }

  return (
    <Menu placement="bottom-start" gutter={8} onOpenChange={(open) => open && void refetch()}>
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
              <For each={projects()}>
                {(project) => (
                  <Menu.RadioItem value={project.path} title={project.path} closeOnSelect onSelect={() => use(project.path)}>
                    <span class="flex min-w-0 items-center gap-2.5">
                      <ProjectMark project={project.path} />
                      <span class="truncate">{projectLabel(project.path)}</span>
                    </span>
                  </Menu.RadioItem>
                )}
              </For>
            </Menu.RadioGroup>
          </Menu.Group>
          <Menu.Separator />
          <Menu.Item onSelect={() => void window.desk.chooseProject().then((path) => path && setTabProject(path))}>
            Open folder…
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

/** Threads in this tab's project that no tab has open. Picking one continues it in this tab. */
function RecentThreads() {
  const closed = () => activeData().threads.filter((thread) => !thread.tabId).slice(0, 8)
  return (
    <Show when={closed().length > 0}>
      <section class="grid gap-1 pt-2">
        <h2 class="px-2 pb-1 text-[12px] text-fg-3">Recent threads</h2>
        <For each={closed()}>
          {(thread) => (
            <button type="button" class="group flex h-9 min-w-0 items-center gap-3 rounded-lg px-2 text-left hover:bg-hover" onClick={() => openThread(thread)}>
              <span class="min-w-0 flex-1 truncate text-fg-2 group-hover:text-fg">{thread.title}</span>
              <Show when={thread.branch && thread.branch !== activeData().space?.branch}>
                <span class="flex shrink-0 items-center gap-1 text-[12px] text-fg-3">
                  <Icon name="branch" class="size-[13px]" />
                  {thread.branch}
                </span>
              </Show>
              <span class="w-12 shrink-0 whitespace-nowrap text-right text-[12px] tabular-nums text-fg-3">{formatAgo(thread.updatedAt)}</span>
            </button>
          )}
        </For>
      </section>
    </Show>
  )
}
