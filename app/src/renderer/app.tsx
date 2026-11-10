import type { TabInfo } from "@desk/protocol"
import { IconButton } from "@opencode/ui/icon-button"
import { Spinner } from "@opencode/ui/spinner"
import { Tabs } from "@opencode/ui/tabs"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEffect, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js"
import { COMMANDS, keyLabels } from "../shared/commands"
import { account, refreshUsage } from "./account"
import { useCommands } from "./actions"
import { Composer } from "./composer"
import { Icon } from "./icons"
import { ContextRing, UsageButton } from "./meters"
import { ThreadMinimap } from "./minimap"
import { PluginView } from "./plugin-view"
import { closePanel, isEmptyView, loadLayout, plugins } from "./plugins"
import { ProjectMark } from "./project-mark"
import { projectData, projectLabel, readProject } from "./projects"
import { ReviewView } from "./review"
import { SettingsScreen } from "./settings/screen"
import { ProjectCards, SpaceChip } from "./space"
import { SubagentsCard } from "./subagents"
import { dropIndex } from "./tab-drag"
import { StartScreen } from "./start-screen"
import { TerminalView } from "./terminal"
import { Thread } from "./thread"
import { threadOf } from "./threads"
import { closeTab, closeTerminal, moveTab, newTab, newTerminal, showPanelTab, shownPanelTab, setPanelOpen, showTab, shownTab, workspace } from "./workspace"

const USAGE_REFRESH_MS = 5 * 60_000
/** The panel's Tabs value for Review, which has no id of its own. */
/** How close to the end the thread must be to count as at the end, and follow new content. */
const PINNED_WITHIN_PX = 48
/** How far a pressed tab moves before it drags. Less is a click. */
const DRAG_THRESHOLD_PX = 4
const REVIEW = "review"

export function App() {
  const run = useCommands()
  onMount(() => {
    const stop = window.desk.onCommand(run)
    // Menu shortcuts reach the page through the main process, which agent-browser cannot press. In development,
    // the page takes the same commands from window.__deskCommand, so an agent can test them.
    if (import.meta.env.DEV) Object.assign(window, { __deskCommand: run })
    // Coming back to the window is when files and usage most likely changed outside Desk.
    const refresh = () => {
      const project = shownTab()?.project
      if (project) readProject(project, "space")
      refreshUsage()
    }
    window.addEventListener("focus", refresh)
    const usageTimer = setInterval(refreshUsage, USAGE_REFRESH_MS)
    onCleanup(() => {
      stop()
      window.removeEventListener("focus", refresh)
      clearInterval(usageTimer)
    })
  })

  return (
    <div class="flex h-full flex-col bg-ground text-fg">
      <TabBar />
      <Show when={workspace.settingsPage !== undefined}>
        <main class="flex min-h-0 flex-1 px-2 pb-2">
          <section class="flex min-w-0 flex-1 rounded-3xl border border-outline bg-panel">
            <SettingsScreen />
          </section>
        </main>
      </Show>
      <Show when={shownTab()} keyed>
        {(tab) => <TabView tab={tab} />}
      </Show>
    </div>
  )
}

/** A tab: its session beside the panel. The session and the panel share one box. */
function TabView(props: { tab: TabInfo }) {
  const thread = () => threadOf(props.tab.id)
  const space = () => projectData(props.tab.project).space
  onMount(() => loadLayout(props.tab.id))
  const layout = () => plugins.layouts[props.tab.id]
  const panels = () => layout()?.panels ?? []
  const cards = () => (layout()?.cards ?? []).filter((card) => !isEmptyView(card.plugin, card.root))
  const shown = () => shownPanelTab(props.tab)
  // The Tabs pick their first tab when the chosen one has no trigger yet, and report it as a change. A new
  // terminal or plugin panel gets its trigger in the update that shows it, so the Tabs learn of a change one update later.
  const [tabsValue, setTabsValue] = createSignal(untrack(shown) ?? REVIEW)
  createEffect(() => setTabsValue(shown() ?? REVIEW))
  return (
    <main class="flex min-h-0 flex-1 gap-2 px-2 pb-2">
      <Show when={layout()?.sidebar}>
        {(sidebar) => (
          <aside class="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-3xl border border-outline bg-card p-2">
            <PluginView view={sidebar()} project={props.tab.project} />
          </aside>
        )}
      </Show>
      {/* The session's width and the panel's slide run on the same curve, so the gap between them stays put while the panel opens. */}
      <div class="desk-split relative min-h-0 flex-1 overflow-hidden" data-panel={props.tab.panelOpen ? "open" : "closed"}>
        <section class="desk-session flex h-full min-w-0 flex-col rounded-3xl border border-outline bg-panel">
          {/* The right padding leaves room for the panel toggle, which sits over this corner. */}
          <header class="flex h-[46px] shrink-0 items-center gap-2 pl-4 pr-12">
            <span class="flex min-w-0 items-center gap-[7px] whitespace-nowrap text-fg-2">
              <ProjectMark project={props.tab.project} class="size-[18px]" />
              {projectLabel(props.tab.project)}
              <span class="text-fg-3">/</span>
              <b class="truncate font-medium text-fg">{props.tab.title}</b>
            </span>
            <span class="ml-auto flex items-center gap-1">
              {/* Shown only while the session is too narrow for the cards beside the thread, by the lane rules in index.css. */}
              <span class="desk-chip">
                <SpaceChip project={props.tab.project} space={space()} />
              </span>
              <Show when={thread().context}>{(context) => <ContextRing {...context()} />}</Show>
            </span>
          </header>
          {/* The project's cards float over the session's corner, and the thread's lane keeps clear of them. Without room, they fold into the header chip. */}
          <div class="relative flex min-h-0 flex-1">
            <div class="flex min-w-0 flex-1 flex-col">
              <Show when={thread().items.length > 0} fallback={layout()?.sidebar ? <SidebarStart tab={props.tab} /> : <StartScreen tab={props.tab} />}>
                <ThreadScroll tab={props.tab} />
                <div class="desk-lane shrink-0 pb-4 pt-1.5">
                  <Composer tab={props.tab} />
                </div>
              </Show>
            </div>
            <aside class="desk-rail desk-no-scrollbar absolute right-2 top-0 max-h-full w-[264px] flex-col gap-2 overflow-y-auto pb-2">
              <SubagentsCard tab={props.tab} />
              <ProjectCards project={props.tab.project} />
              <For each={cards()}>
                {(card) => (
                  <section class="flex flex-col gap-1 rounded-3xl border border-outline bg-card p-3">
                    <span class="text-[12px] text-fg-3">{card.title}</span>
                    <PluginView view={card} project={props.tab.project} />
                  </section>
                )}
              </For>
            </aside>
          </div>
        </section>
        <section class="desk-panel flex flex-col rounded-3xl border border-outline bg-panel" inert={!props.tab.panelOpen}>
          <div class="desk-no-scrollbar flex h-[46px] shrink-0 items-center gap-1 overflow-x-auto pl-2 pr-12">
            <Tabs variant="surface" value={tabsValue()} onChange={(value) => showPanelTab(props.tab.id, value === REVIEW ? undefined : value)} class="min-w-0">
              <Tabs.List>
                {/* Plugin panels sit at the front, in the order they opened. */}
                <For each={panels()}>
                  {(panel) => (
                    <Tabs.Trigger value={panel.id} class="shrink-0" closeButton={<Tabs.CloseButton aria-label="Close panel" onClick={() => closePanel(props.tab.id, panel.id)} />}>
                      {panel.title}
                    </Tabs.Trigger>
                  )}
                </For>
                <Tabs.Trigger value={REVIEW} class="shrink-0">
                  <span class="flex items-center gap-[7px]">
                    <Icon name="review" />
                    Review
                  </span>
                </Tabs.Trigger>
                <For each={props.tab.terminals}>
                  {(terminal) => (
                    <Tabs.Trigger value={terminal.id} class="shrink-0" closeButton={<Tabs.CloseButton aria-label="Close terminal" onClick={() => closeTerminal(props.tab.id, terminal.id)} />}>
                      <span class="flex items-center gap-[7px]">
                        <Icon name="terminal" />
                        {terminal.title}
                      </span>
                    </Tabs.Trigger>
                  )}
                </For>
              </Tabs.List>
            </Tabs>
            <Tooltip value="New terminal" placement="bottom">
              <IconButton variant="ghost-muted" size="large" class="shrink-0" aria-label="New terminal" icon={<Icon name="plus" />} onClick={newTerminal} />
            </Tooltip>
          </div>
          <div class="flex min-h-0 flex-1 flex-col">
            {/* Plugin panels, like terminals, stay mounted while another panel tab shows. */}
            <For each={panels()}>
              {(panel) => (
                <div class="flex min-h-0 flex-1 flex-col px-3 pb-3" classList={{ hidden: panel.id !== shown() }}>
                  <PluginView view={panel} project={props.tab.project} />
                </div>
              )}
            </For>
            <Show when={shown() === undefined}>
              <div class="flex min-h-0 flex-1 flex-col">
                <ReviewView tab={props.tab} review={thread().review} />
              </div>
            </Show>
            {/* Terminals stay mounted while another panel tab shows, so their screens keep their state. */}
            <For each={props.tab.terminals}>
              {(terminal) => (
                <div class="min-h-0 flex-1 overflow-hidden px-3 pb-3" classList={{ hidden: terminal.id !== shown() }}>
                  <TerminalView id={terminal.id} />
                </div>
              )}
            </For>
          </div>
        </section>
        <PanelToggle tab={props.tab} />
      </div>
    </main>
  )
}

/** A tab with a plugin sidebar, before the sidebar opens a thread: the composer, under a line on how to start. */
function SidebarStart(props: { tab: TabInfo }) {
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <p class="m-auto px-6 text-center text-fg-3">Pick something in the sidebar to open its thread.</p>
      <div class="desk-lane shrink-0 pb-4 pt-1.5">
        <Composer tab={props.tab} />
      </div>
    </div>
  )
}

/**
 * Opens and closes the panel. It sits over the top-right corner of whichever card is there, so the
 * spot that opened the panel also closes it. Its right pane fills as the panel opens, as OpenCode's does.
 */
function PanelToggle(props: { tab: TabInfo }) {
  return (
    <Tooltip value={`Panel ${keyLabels(COMMANDS["panel.toggle"].accelerator).join("")}`} placement="bottom" class="absolute right-2.5 top-[9px] z-10">
      <IconButton
        variant="ghost-muted"
        size="large"
        aria-label="Toggle panel"
        aria-expanded={!!props.tab.panelOpen}
        onClick={() => setPanelOpen(props.tab.id, !props.tab.panelOpen)}
        icon={
          <svg viewBox="0 0 16 16" class="size-[15px]" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="2.5" width="12" height="11" rx="2" />
            <path d="M10 2.5v11" />
            <rect class="desk-panel-glyph" x="10" y="2.5" width="4" height="11" fill="currentColor" stroke="none" />
          </svg>
        }
      />
    </Tooltip>
  )
}

function TabBar() {
  // The left padding keeps the tabs clear of the window buttons, which full screen hides. There, the
  // bar's 4px and the strip's 4px line the first tab up with the card's 8px edge below it.
  const [fullScreen, setFullScreen] = createSignal(false)
  onMount(() => {
    void window.desk.isFullScreen().then(setFullScreen)
    onCleanup(window.desk.onFullScreen(setFullScreen))
  })
  // The tab opened from the + button. Only it animates in: tabs from ⌘T or the menu appear at once.
  const [entering, setEntering] = createSignal<string>()
  let strip!: HTMLDivElement
  // A new tab opens at the end, which may be past the bar's edge. Keep the active tab in view.
  createEffect(() => strip.querySelector(`[data-tab="${workspace.active}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }))
  // Settings show in place of the active tab, so while they are open no tab is marked active.
  const shown = (id: string) => id === shownTab()?.id

  // A tab pressed and moved past a few pixels is dragged: it takes the slot under the pointer as it goes.
  // A press that does not move stays a click. Written here because @opencode/ui has no sortable list.
  const [dragging, setDragging] = createSignal<string>()
  const startDrag = (event: PointerEvent, id: string) => {
    if (event.button !== 0) return
    const startX = event.clientX
    let moved = false
    const move = (next: PointerEvent) => {
      if (!moved && Math.abs(next.clientX - startX) < DRAG_THRESHOLD_PX) return
      if (!moved) setDragging(id)
      moved = true
      const others = [...strip.querySelectorAll<HTMLElement>("[data-tab]")].filter((element) => element.dataset.tab !== id)
      moveTab(id, dropIndex(others.map((element) => element.getBoundingClientRect().left + element.offsetWidth / 2), next.clientX))
    }
    const end = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      setDragging(undefined)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
  }

  return (
    <nav class="desk-titlebar flex h-11 shrink-0 items-center gap-1 pr-2.5" classList={{ "pl-[84px]": !fullScreen(), "pl-1": fullScreen() }}>
      <div ref={strip} class="desk-no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
        <For each={workspace.tabs}>
          {(tab) => (
            // The active tab's outline is inset: the strip scrolls sideways, which clips anything outside it above and below.
            <div
              data-tab={tab.id}
              class="desk-no-drag group relative flex h-8 w-[210px] shrink-0 items-center rounded-xl"
              onPointerDown={(event) => startDrag(event, tab.id)}
              classList={{ "desk-tab-enter": tab.id === entering(), "opacity-70": tab.id === dragging(), "bg-tab text-fg shadow-[inset_0_0_0_1px_var(--color-outline)]": shown(tab.id), "text-fg-3 hover:bg-tab-hover hover:text-fg-2": !shown(tab.id) }}
            >
              {/* The tab and its close button are siblings: a button cannot hold another. */}
              <button class="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 pr-7 text-left" onClick={() => showTab(tab.id)}>
                <ProjectMark project={tab.project} />
                <span class="desk-fade-end min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[12px]">{tab.title}</span>
                <Show when={threadOf(tab.id).busy}>
                  <Spinner class="size-3.5 shrink-0 text-accent" />
                </Show>
              </button>
              <IconButton
                variant="ghost-muted"
                size="small"
                aria-label="Close tab"
                class="absolute right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                classList={{ "opacity-100": shown(tab.id) }}
                icon={<Icon name="close-small" />}
                onClick={() => closeTab(tab.id)}
              />
            </div>
          )}
        </For>
        <Tooltip value="New tab. ⌘-click opens it next to this one." placement="bottom" class="desk-no-drag shrink-0">
          <IconButton
            variant="ghost-muted"
            size="large"
            aria-label="New tab"
            icon={<Icon name="plus" />}
            onClick={(event: MouseEvent) => {
              newTab(event.metaKey ? "next" : "end")
              setEntering(workspace.active)
            }}
          />
        </Tooltip>
      </div>
      <Show when={account.usage}>{(usage) => <UsageButton usage={usage()} />}</Show>
    </nav>
  )
}

/**
 * Keeps the newest message in view while Claude writes, unless the user scrolled up to read. It follows
 * any change in size, of the thread or of the box: a reply growing, a step appearing, or the queue
 * above the composer taking room.
 */
function ThreadScroll(props: { tab: TabInfo }) {
  let box!: HTMLDivElement
  let content!: HTMLDivElement
  // Pinned means scrolled to the end. Scrolling up unpins it, and Scroll to end shows.
  const [pinned, setPinned] = createSignal(true)
  const [mounted, setMounted] = createSignal<HTMLDivElement>()
  onMount(() => {
    const follow = new ResizeObserver(() => pinned() && (box.scrollTop = box.scrollHeight))
    follow.observe(box)
    follow.observe(content)
    onCleanup(() => follow.disconnect())
    setMounted(box)
  })
  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div ref={box} class="min-h-0 flex-1 overflow-y-auto" onScroll={() => setPinned(box.scrollHeight - box.scrollTop - box.clientHeight < PINNED_WITHIN_PX)}>
        <div ref={content}>
          <Thread tab={props.tab} />
        </div>
      </div>
      <Show when={mounted()}>{(scrollBox) => <ThreadMinimap tab={props.tab} box={scrollBox()} />}</Show>
      {/* After T3 Code: a pill above the composer once the end of the thread is out of view. */}
      <Show when={!pinned()}>
        <div class="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <button
            class="pointer-events-auto flex h-7 items-center gap-1.5 rounded-full bg-card/90 px-3 text-[12px] text-fg-2 shadow-[0_0_0_1px_var(--color-line),0_4px_12px_rgb(0_0_0/15%)] backdrop-blur hover:text-fg"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => box.scrollTo({ top: box.scrollHeight })}
          >
            <Icon name="chevron-down" class="size-3.5" />
            Scroll to end
          </button>
        </div>
      </Show>
    </div>
  )
}
