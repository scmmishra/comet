import { createEffect, For, on, onCleanup, onMount, Show } from "solid-js"
import { Composer } from "./composer"
import { Icon } from "./icons"
import { SpaceCard } from "./space"
import { activeTab, closeTab, newTab, refreshSpace, selectTab, selectTabAt, state } from "./store"
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
    <div class="flex h-full flex-col bg-background-base text-text-base">
      <TabBar />
      <Show when={activeTab()} keyed>
        {(tab) => (
          <main class="flex min-h-0 flex-1 px-2 pb-2">
            <section class="flex min-w-0 flex-1 flex-col rounded-xl bg-background-weak">
              <header class="flex h-11 shrink-0 items-center gap-2 px-4 text-sm">
                <span class="text-text-weak">{state.space?.name ?? "No repo"}</span>
                <span class="text-text-weaker">/</span>
                <span class="truncate text-text-strong">{tab.title}</span>
              </header>
              <div class="flex min-h-0 flex-1">
                <Show
                  when={tab.items.length > 0}
                  fallback={
                    <div class="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 px-4 pb-16">
                      <h1 class="text-center text-[1.75rem] leading-tight font-medium text-text-strong">
                        What should we build in <span class="text-text-strong">{state.space?.name ?? "this folder"}</span>?
                      </h1>
                      <div class="flex w-full max-w-[720px] flex-col gap-3">
                        <Composer tab={tab} />
                        <Show when={state.space}>
                          {(space) => (
                            <div class="flex items-center gap-2 px-3 text-sm text-text-weak">
                              <Icon name="branch" />
                              <span class="truncate">{space().branch}</span>
                              <span class="ml-auto truncate">{space().root.replace(/^\/Users\/[^/]+/, "~")}</span>
                            </div>
                          )}
                        </Show>
                      </div>
                    </div>
                  }
                >
                  <div class="flex min-w-0 flex-1 flex-col">
                    <ThreadScroll tab={tab} />
                    <div class="shrink-0 px-4 pb-4 pt-1.5">
                      <Composer tab={tab} />
                    </div>
                  </div>
                </Show>
                <Show when={state.space}>
                  {(space) => (
                    <aside class="desk-rail w-68 shrink-0 overflow-y-auto pb-2 pr-2">
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

function TabBar() {
  return (
    <nav class="desk-titlebar flex h-12 shrink-0 items-center gap-1 pl-20 pr-2">
      <div class="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        <For each={state.tabs}>
          {(tab) => (
            <button
              class="desk-no-drag group flex h-8 w-52 shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-sm"
              classList={{ "bg-surface-raised-base text-text-strong": tab.id === state.active, "text-text-weak hover:bg-surface-base": tab.id !== state.active }}
              onClick={() => selectTab(tab.id)}
            >
              <span class="min-w-0 flex-1 truncate">{tab.title}</span>
              <Show when={tab.busy}>
                <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-text-interactive-base" />
              </Show>
              <span
                role="button"
                aria-label="Close tab"
                class="hidden size-5 shrink-0 place-items-center rounded text-text-weak hover:bg-surface-base group-hover:grid"
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                ×
              </span>
            </button>
          )}
        </For>
        <button class="desk-no-drag grid size-8 shrink-0 place-items-center rounded-lg text-text-weak hover:bg-surface-base" aria-label="New tab" onClick={newTab}>
          +
        </button>
      </div>
    </nav>
  )
}

/** Keeps the newest message in view while Claude writes, unless the user scrolled up to read. */
function ThreadScroll(props: { tab: ReturnType<typeof activeTab> & {} }) {
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
    <div
      ref={box}
      class="min-h-0 flex-1 overflow-y-auto"
      onScroll={() => (pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 48)}
    >
      <Thread tab={props.tab} />
    </div>
  )
}
