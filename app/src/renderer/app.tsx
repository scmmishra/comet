import { createEffect, For, on, onCleanup, onMount, Show } from "solid-js"
import { Composer } from "./composer"
import { Icon } from "./icons"
import { SpaceCard } from "./space"
import { activeTab, closeTab, newTab, refreshSpace, selectTab, selectTabAt, state, type Tab } from "./store"
import { Thread } from "./thread"

export function App() {
  onMount(() => {
    if (state.tabs.length === 0) newTab()
    const stop = window.desk.onCommand((command) => {
      if (command === "tab.new") newTab()
      else if (command === "tab.close" && state.active) closeTab(state.active)
      else if (command.startsWith("tab.select:")) selectTabAt(Number(command.slice("tab.select:".length)))
    })
    // Coming back to the window is when files most likely changed outside Desk.
    window.addEventListener("focus", refreshSpace)
    onCleanup(() => {
      stop()
      window.removeEventListener("focus", refreshSpace)
    })
  })

  return (
    <div class="flex h-full flex-col bg-ground text-fg">
      <TabBar />
      <Show when={activeTab()} keyed>
        {(tab) => (
          <main class="flex min-h-0 flex-1 gap-2 px-2 pb-2">
            <section class="flex min-w-0 flex-1 flex-col rounded-3xl border border-outline bg-panel">
              <header class="flex h-[46px] shrink-0 items-center gap-2 px-4">
                <span class="flex min-w-0 items-center gap-[7px] whitespace-nowrap text-fg-2">
                  <SpaceAvatar />
                  {state.space?.name ?? "No repo"}
                  <span class="text-fg-3">/</span>
                  <b class="truncate font-medium text-fg">{tab.title}</b>
                </span>
              </header>
              <div class="flex min-h-0 flex-1">
                <div class="flex min-w-0 flex-1 flex-col">
                  <Show when={tab.items.length > 0} fallback={<StartScreen tab={tab} />}>
                    <ThreadScroll tab={tab} />
                    <div class="shrink-0 px-4 pb-4 pt-1.5">
                      <Composer tab={tab} />
                    </div>
                  </Show>
                </div>
                <Show when={state.space}>
                  {(space) => (
                    <aside class="desk-rail desk-no-scrollbar flex w-[272px] shrink-0 flex-col gap-2 overflow-y-auto pb-2 pr-2">
                      <SpaceCard space={space()} />
                    </aside>
                  )}
                </Show>
              </div>
            </section>
          </main>
        )}
      </Show>
    </div>
  )
}

/** The space's first letter. Tabs use the small size. */
function SpaceAvatar(props: { small?: boolean }) {
  return (
    <span
      class="grid shrink-0 place-items-center bg-[#3a3a40] font-semibold text-fg"
      classList={{ "size-[18px] rounded-[5px] text-[11px]": !props.small, "size-4 rounded-[4px] text-[10px]": props.small }}
    >
      {(state.space?.name ?? "?").charAt(0).toUpperCase()}
    </span>
  )
}

function StartScreen(props: { tab: Tab }) {
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center gap-[18px] overflow-y-auto px-4 pb-6 pt-[14vh]">
      <div class="select-none text-center font-mono text-[clamp(44px,8vw,88px)] font-medium leading-none tracking-[-0.04em] text-mark">desk</div>
      <div class="flex w-full max-w-[720px] flex-col gap-[18px]">
        <Composer tab={props.tab} />
        <Show when={state.space}>
          {(space) => (
            <div class="flex flex-wrap items-center gap-2 px-1.5 text-fg-2">
              <SpaceAvatar />
              {space().name}
              <span class="text-fg-3">/</span>
              <Icon name="branch" />
              {space().branch}
              <span class="ml-auto font-mono text-[12px] text-fg-3">{space().root.replace(/^\/Users\/[^/]+/, "~")}</span>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

function TabBar() {
  return (
    <nav class="desk-titlebar flex h-11 shrink-0 items-center gap-1 pl-[84px] pr-2.5">
      <div class="desk-no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
        <For each={state.tabs}>
          {(tab) => (
            <button
              class="desk-no-drag group flex h-8 w-[210px] shrink-0 items-center gap-2 rounded-xl pl-2 pr-1.5 text-left"
              classList={{ "bg-raised text-fg": tab.id === state.active, "text-fg-3 hover:bg-panel hover:text-fg-2": tab.id !== state.active }}
              onClick={() => selectTab(tab.id)}
            >
              <SpaceAvatar small />
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
        <button class="desk-no-drag grid size-[30px] shrink-0 place-items-center rounded-lg text-fg-2 hover:bg-hover hover:text-fg" aria-label="New tab" onClick={newTab}>
          <Icon name="plus" />
        </button>
      </div>
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
