import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { ProjectAvatar } from "./avatar"
import { Composer } from "./composer"
import { Icon } from "./icons"
import { ContextRing, UsageButton } from "./meters"
import { ReviewView } from "./review"
import { SpaceCard, SpaceChip } from "./space"
import { StartScreen } from "./start-screen"
import { activeTab, closePanelTab, closeTab, newTab, newTerminal, refreshSpace, refreshUsage, selectPanelTab, selectTab, selectTabAt, state, togglePanel, type Tab } from "./store"
import { TerminalView } from "./terminal"
import { Thread } from "./thread"

const USAGE_REFRESH_MS = 5 * 60_000

export function App() {
  onMount(() => {
    const stop = window.desk.onCommand((command) => {
      if (command === "tab.new") newTab()
      else if (command === "tab.close" && state.active) closeTab(state.active)
      else if (command === "panel.toggle") togglePanelInstantly()
      else if (command === "terminal.new") newTerminal()
      else if (command.startsWith("tab.select:")) selectTabAt(Number(command.slice("tab.select:".length)))
    })
    // Coming back to the window is when files and usage most likely changed outside Desk.
    const refresh = () => {
      refreshSpace()
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
      <Show when={activeTab()} keyed>
        {(tab) => (
          <main class="flex min-h-0 flex-1 px-2 pb-2">
            {/* The session and the panel share one box. The session's width and the panel's slide run on the same curve, so the gap between them stays put while the panel opens. */}
            <div class="desk-split relative min-h-0 flex-1 overflow-hidden" data-panel={state.panelOpen ? "open" : "closed"}>
              <section class="desk-session flex h-full min-w-0 flex-col rounded-3xl border border-outline bg-panel">
                {/* The right padding leaves room for the panel toggle, which sits over this corner. */}
                <header class="flex h-[46px] shrink-0 items-center gap-2 pl-4 pr-12">
                  <span class="flex min-w-0 items-center gap-[7px] whitespace-nowrap text-fg-2">
                    <ProjectAvatar name={state.space?.name} />
                    {state.space?.name ?? "No repo"}
                    <span class="text-fg-3">/</span>
                    <b class="truncate font-medium text-fg">{tab.title}</b>
                  </span>
                  <span class="ml-auto flex items-center gap-1">
                    <Show when={state.panelOpen && state.space}>{(space) => <SpaceChip space={space()} />}</Show>
                    <Show when={tab.context}>{(context) => <ContextRing {...context()} />}</Show>
                  </span>
                </header>
                {/* The Space card floats over the session's corner, so the thread stays centred. With the panel open, it folds into the header chip. */}
                <div class="relative flex min-h-0 flex-1">
                  <div class="flex min-w-0 flex-1 flex-col">
                    <Show when={tab.items.length > 0} fallback={<StartScreen tab={tab} />}>
                      <ThreadScroll tab={tab} />
                      <div class="shrink-0 px-4 pb-4 pt-1.5">
                        <Composer tab={tab} />
                      </div>
                    </Show>
                  </div>
                  <Show when={!state.panelOpen && state.space}>
                    {(space) => (
                      <aside class="desk-rail desk-no-scrollbar absolute right-2 top-0 flex max-h-full w-[264px] flex-col gap-2 overflow-y-auto pb-2">
                        <SpaceCard space={space()} />
                      </aside>
                    )}
                  </Show>
                </div>
              </section>
              <section class="desk-panel flex flex-col rounded-3xl border border-outline bg-panel" inert={!state.panelOpen}>
                <div class="desk-no-scrollbar flex h-[46px] shrink-0 items-center gap-1 overflow-x-auto pl-2 pr-12">
                  <For each={tab.panelTabs}>
                    {(panelTab) => (
                      <button
                        class="group flex h-[30px] shrink-0 items-center gap-[7px] rounded-lg pl-2.5 text-left"
                        classList={{ "bg-raised text-fg": panelTab.id === tab.panelActive, "text-fg-3 hover:bg-hover hover:text-fg-2": panelTab.id !== tab.panelActive, "pr-2.5": panelTab.kind === "review", "pr-1.5": panelTab.kind === "terminal" }}
                        onClick={() => selectPanelTab(panelTab.id)}
                      >
                        <Icon name={panelTab.kind === "review" ? "diff" : "terminal"} />
                        {panelTab.kind === "review" ? "Review" : panelTab.title}
                        <Show when={panelTab.kind === "terminal"}>
                          <span
                            role="button"
                            aria-label="Close terminal"
                            class="grid size-[18px] place-items-center rounded-[5px] opacity-0 hover:bg-hover hover:opacity-100! group-hover:opacity-60"
                            onClick={(event) => {
                              event.stopPropagation()
                              closePanelTab(panelTab.id)
                            }}
                          >
                            <Icon name="x" />
                          </span>
                        </Show>
                      </button>
                    )}
                  </For>
                  <button class="grid size-[30px] shrink-0 place-items-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg" aria-label="New terminal" title="New terminal" onClick={newTerminal}>
                    <Icon name="plus" />
                  </button>
                </div>
                <div class="flex min-h-0 flex-1 flex-col">
                  <Show when={tab.panelActive === "review"}>
                    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
                      <ReviewView tab={tab} />
                    </div>
                  </Show>
                  {/* Terminals stay mounted while another panel tab shows, so their screens keep their state. */}
                  <For each={tab.panelTabs.filter((panelTab) => panelTab.kind === "terminal")}>
                    {(panelTab) => (
                      <div class="min-h-0 flex-1 overflow-hidden px-3 pb-3" classList={{ hidden: panelTab.id !== tab.panelActive }}>
                        <TerminalView id={panelTab.id} />
                      </div>
                    )}
                  </For>
                </div>
              </section>
              <PanelToggle />
            </div>
          </main>
        )}
      </Show>
    </div>
  )
}

/**
 * Toggles the panel with no motion, for ⌘\ and the menu. The new state is applied while transitions
 * are off, and reading layout forces that before they come back. Otherwise the next frame would see
 * the change with transitions on again, and slide anyway.
 */
function togglePanelInstantly() {
  const root = document.documentElement
  root.dataset.motion = "instant"
  togglePanel()
  void root.offsetHeight
  delete root.dataset.motion
}

/**
 * Opens and closes the panel. It sits over the top-right corner of whichever card is there, so the
 * spot that opened the panel also closes it. Its right pane fills as the panel opens, as OpenCode's does.
 */
function PanelToggle() {
  return (
    <button
      class="desk-panel-toggle absolute right-2.5 top-[9px] z-10 grid size-7 place-items-center rounded-lg text-fg-2 hover:bg-hover hover:text-fg"
      aria-label="Toggle panel"
      aria-expanded={state.panelOpen}
      title="Panel (⌘\)"
      onClick={togglePanel}
    >
      <svg viewBox="0 0 16 16" class="size-[15px]" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="2" />
        <path d="M10 2.5v11" />
        <rect class="desk-panel-glyph" x="10" y="2.5" width="4" height="11" fill="currentColor" stroke="none" />
      </svg>
    </button>
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
  createEffect(() => strip.querySelector(`[data-tab="${state.active}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }))

  return (
    <nav class="desk-titlebar flex h-11 shrink-0 items-center gap-1 pr-2.5" classList={{ "pl-[84px]": !fullScreen(), "pl-1": fullScreen() }}>
      <div ref={strip} class="desk-no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
        <For each={state.tabs}>
          {(tab) => (
            <button
              data-tab={tab.id}
              class="desk-no-drag group flex h-8 w-[210px] shrink-0 items-center gap-2 rounded-xl pl-2 pr-1.5 text-left"
              classList={{ "desk-tab-enter": tab.id === entering(), "bg-raised text-fg": tab.id === state.active, "text-fg-3 hover:bg-panel hover:text-fg-2": tab.id !== state.active }}
              onClick={() => selectTab(tab.id)}
            >
              <ProjectAvatar name={state.space?.name} small />
              <span class="desk-fade-end min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[12px]">{tab.title}</span>
              <Show when={tab.busy}>
                <span class="desk-pulse size-1.5 shrink-0 rounded-full bg-accent" />
              </Show>
              <span
                role="button"
                aria-label="Close tab"
                class="grid size-[18px] shrink-0 place-items-center rounded-[5px] opacity-0 hover:bg-hover hover:opacity-100! group-hover:opacity-60"
                classList={{ "opacity-60": tab.id === state.active }}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <Icon name="x" />
              </span>
            </button>
          )}
        </For>
        <button
          class="desk-no-drag grid size-[30px] shrink-0 place-items-center rounded-lg text-fg-2 hover:bg-hover hover:text-fg"
          aria-label="New tab"
          title="New tab (⌘-click to open next to this one)"
          onClick={(event) => setEntering(newTab(event.metaKey ? "next" : "end"))}
        >
          <Icon name="plus" />
        </button>
      </div>
      <Show when={state.usage}>{(usage) => <UsageButton usage={usage()} />}</Show>
    </nav>
  )
}

/** Keeps the newest message in view while Claude writes, unless the user scrolled up to read. */
function ThreadScroll(props: { tab: Tab }) {
  let box!: HTMLDivElement
  let pinned = true
  createEffect(
    on(
      () => props.tab.items.map((item) => (item.type === "text" ? item.text.length : 0)).join(),
      () => {
        if (pinned) box.scrollTop = box.scrollHeight
      },
    ),
  )
  return (
    <div ref={box} class="min-h-0 flex-1 overflow-y-auto" onScroll={() => (pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 48)}>
      <Thread tab={props.tab} />
    </div>
  )
}
