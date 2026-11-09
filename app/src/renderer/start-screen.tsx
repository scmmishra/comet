import { createResource, For, onMount, Show } from "solid-js"
import { ProjectAvatar } from "./avatar"
import { Composer } from "./composer"
import { formatAgo } from "./format"
import { Icon } from "./icons"
import { createPopover, PopoverPanel } from "./popover"
import { refreshThreads, resumeThread, state, type Tab } from "./store"

/** A new tab: the composer, the project and branch it works in, and threads to pick up again. */
export function StartScreen(props: { tab: Tab }) {
  onMount(refreshThreads)
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center gap-[18px] overflow-y-auto px-4 pb-6 pt-[14vh]">
      <div class="select-none text-center font-mono text-[clamp(44px,8vw,88px)] font-medium leading-none tracking-[-0.04em] text-mark">desk</div>
      <div class="flex w-full max-w-[720px] flex-col gap-[18px]">
        <Composer tab={props.tab} />
        <div class="flex items-center gap-1 px-0.5 text-fg-2">
          <ProjectSwitcher />
          <Show when={state.space}>
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

/**
 * Switches the window to another project. The window shows one project at a time, so a switch
 * starts a new core for that folder and reloads the page with its tabs.
 */
function ProjectSwitcher() {
  const popover = createPopover({ width: 280, maxHeight: 360, align: "start", side: "below" })
  const [projects, { refetch }] = createResource(() => window.desk.projects())
  let button!: HTMLButtonElement
  const current = () => projects()?.find((project) => project.path === state.project)

  return (
    <>
      <button
        ref={button}
        type="button"
        class="flex h-8 items-center gap-2 rounded-lg px-1.5 hover:bg-hover hover:text-fg"
        classList={{ "bg-hover text-fg": popover.isOpen() }}
        aria-haspopup="dialog"
        aria-expanded={popover.isOpen()}
        onClick={() => {
          if (!popover.isOpen()) void refetch()
          popover.toggle(button)
        }}
      >
        <ProjectAvatar name={state.space?.name ?? current()?.name} />
        {state.space?.name ?? current()?.name ?? "No project"}
        <Icon name="down" class="size-3 text-fg-3" />
      </button>
      <PopoverPanel popover={popover} label="Projects" class="flex flex-col">
        <div class="flex h-9 shrink-0 items-center px-3.5 pt-1.5 text-[12px] text-fg-3">Projects</div>
        <div class="desk-no-scrollbar grid min-h-0 gap-px overflow-y-auto p-1.5">
          <For each={projects()}>
            {(project) => (
              <button
                type="button"
                class="flex h-9 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-hover"
                title={project.path}
                onClick={() => (project === current() ? popover.close() : void window.desk.openProject(project.path))}
              >
                <ProjectAvatar name={project.name} />
                <span class="min-w-0 flex-1 truncate text-fg">{project.name}</span>
                <Show when={project === current()}>
                  <Icon name="check" class="size-[15px] shrink-0 text-fg" />
                </Show>
              </button>
            )}
          </For>
        </div>
        <div class="shrink-0 border-t border-outline p-1.5">
          <button
            type="button"
            class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-fg-2 hover:bg-hover hover:text-fg"
            onClick={() => {
              popover.close()
              void window.desk.chooseProject()
            }}
          >
            <Icon name="folder" class="size-[15px]" />
            Open folder…
            <kbd class="ml-auto font-sans text-[11px] text-fg-3">⌘O</kbd>
          </button>
        </div>
      </PopoverPanel>
    </>
  )
}

/** Threads in this space that no tab has open. Picking one continues it in this tab. */
function RecentThreads() {
  return (
    <Show when={state.threads.length > 0}>
      <section class="grid gap-1 pt-2">
        <h2 class="px-2 pb-1 text-[12px] text-fg-3">Recent threads</h2>
        <For each={state.threads.slice(0, 8)}>
          {(thread) => (
            <button type="button" class="group flex h-9 min-w-0 items-center gap-3 rounded-lg px-2 text-left hover:bg-hover" onClick={() => resumeThread(thread)}>
              <span class="min-w-0 flex-1 truncate text-fg-2 group-hover:text-fg">{thread.title}</span>
              <Show when={thread.branch && thread.branch !== state.space?.branch}>
                <span class="flex shrink-0 items-center gap-1 text-[12px] text-fg-3">
                  <Icon name="branch" class="size-[13px]" />
                  {thread.branch}
                </span>
              </Show>
              <span class="w-8 shrink-0 text-right text-[12px] tabular-nums text-fg-3">{formatAgo(thread.updatedAt)}</span>
            </button>
          )}
        </For>
      </section>
    </Show>
  )
}
