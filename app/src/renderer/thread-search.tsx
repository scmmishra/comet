import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { formatAgo } from "./format"
import { Icon } from "./icons"
import { openThread, refreshThreads, state } from "./store"

const [open, setOpen] = createSignal(false)

/** Opens thread search, or closes it when it is open. ⌘⇧0 and the View menu call this. */
export function toggleThreadSearch() {
  if (!open()) refreshThreads()
  setOpen(!open())
}

/**
 * Finds a thread in the space by its title or branch, after OpenCode's session search. It opens
 * from the keyboard, so it shows at once, with no motion.
 */
export function ThreadSearch() {
  const [query, setQuery] = createSignal("")
  const [index, setIndex] = createSignal(0)
  let list: HTMLDivElement | undefined

  // Every word must appear somewhere in the title or the branch.
  const matches = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return state.threads.filter((thread) => {
      const text = `${thread.title} ${thread.branch ?? ""}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
  })
  createEffect(on(query, () => setIndex(0)))
  createEffect(on(index, (at) => list?.children[at]?.scrollIntoView({ block: "nearest" })))

  const close = () => {
    setOpen(false)
    setQuery("")
  }
  const pick = (at: number) => {
    const thread = matches()[at]
    if (!thread) return
    close()
    openThread(thread)
  }
  const onKey = (event: KeyboardEvent) => {
    const count = matches().length
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (count) setIndex((at) => (at + (event.key === "ArrowDown" ? 1 : count - 1)) % count)
    } else if (event.key === "Enter") {
      event.preventDefault()
      pick(index())
    } else if (event.key === "Escape") {
      event.preventDefault()
      close()
    }
  }

  return (
    <Show when={open()}>
      <Portal>
        <div class="fixed inset-0 z-50 flex justify-center bg-[rgb(0_0_0/35%)] px-4 pt-[12vh]" onPointerDown={(event) => event.target === event.currentTarget && close()}>
          <div class="flex max-h-[60vh] w-full max-w-[600px] flex-col self-start overflow-hidden rounded-2xl border border-outline bg-raised text-[13px] shadow-[0_18px_40px_rgb(0_0_0/50%)]" role="dialog" aria-label="Search threads">
            <label class="flex h-11 shrink-0 items-center gap-2.5 border-b border-outline px-4 text-fg-3">
              <Icon name="search" class="size-[15px]" />
              <input
                ref={(input) => queueMicrotask(() => input.focus())}
                class="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3"
                placeholder="Search threads"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={onKey}
              />
            </label>
            <div ref={list} class="desk-no-scrollbar grid min-h-0 content-start gap-px overflow-y-auto p-1.5" role="listbox">
              <For each={matches()} fallback={<div class="px-2.5 py-3 text-fg-3">{query() ? "No thread matches." : "No threads yet."}</div>}>
                {(thread, at) => (
                  <button
                    type="button"
                    class="flex h-9 min-w-0 shrink-0 items-center gap-3 rounded-lg px-2.5 text-left"
                    classList={{ "bg-hover text-fg": at() === index(), "text-fg-2": at() !== index() }}
                    role="option"
                    aria-selected={at() === index()}
                    onPointerMove={() => setIndex(at())}
                    onClick={() => pick(at())}
                  >
                    <span class="min-w-0 flex-1 truncate">{thread.title}</span>
                    <Show when={thread.branch && thread.branch !== state.space?.branch}>
                      <span class="flex shrink-0 items-center gap-1 text-[12px] text-fg-3">
                        <Icon name="branch" class="size-[13px]" />
                        {thread.branch}
                      </span>
                    </Show>
                    <Show when={thread.tabId}>
                      <span class="shrink-0 text-[12px] text-fg-3">Open</span>
                    </Show>
                    <span class="w-12 shrink-0 whitespace-nowrap text-right text-[12px] tabular-nums text-fg-3">{formatAgo(thread.updatedAt)}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
