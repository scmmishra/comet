import type { ThreadSummary } from "@desk/protocol"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody } from "@opencode/ui/dialog"
import { SearchHighlight, SearchList } from "@opencode/ui/search-list"
import { createMemo, createSignal, Show } from "solid-js"
import { formatAgo } from "./format"
import { Icon } from "./icons"
import { activeData, openThread, refreshThreads } from "./store"

const DIALOG_ID = "thread-search"

/** Opens thread search, or closes it when it is open. ⌘⇧O and the View menu call it. Call it inside the DialogProvider. */
export function useThreadSearch() {
  const dialog = useDialog()
  return () => {
    if (dialog.active?.id === DIALOG_ID) return dialog.close(DIALOG_ID)
    refreshThreads()
    dialog.show(() => <ThreadSearch onPick={() => dialog.close(DIALOG_ID)} />, undefined, DIALOG_ID)
  }
}

/** Finds a thread in the active tab's project by its title or branch, after OpenCode's session search. */
function ThreadSearch(props: { onPick: () => void }) {
  const [query, setQuery] = createSignal("")

  // Every word must appear somewhere in the title or the branch.
  const matches = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return activeData().threads.filter((thread) => {
      const text = `${thread.title} ${thread.branch ?? ""}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
  })

  const pick = (thread: ThreadSummary) => {
    props.onPick()
    openThread(thread)
  }

  return (
    <Dialog size="large" fit>
      <DialogBody>
        <SearchList
          query={query()}
          onQuery={setQuery}
          placeholder="Search threads"
          items={matches()}
          key={(thread) => thread.id}
          empty={query() ? "No thread matches." : "No threads yet."}
          onSelect={pick}
          onClose={props.onPick}
        >
          {(thread, row) => (
            <button type="button" {...row}>
              <span class="min-w-0 flex-1 truncate">
                <SearchHighlight text={thread().title} />
              </span>
              <Show when={thread().branch && thread().branch !== activeData().space?.branch}>
                <span class="flex shrink-0 items-center gap-1 text-[12px] text-fg-3">
                  <Icon name="branch" class="size-[13px]" />
                  {thread().branch}
                </span>
              </Show>
              <Show when={thread().tabId}>
                <span class="shrink-0 text-[12px] text-fg-3">Open</span>
              </Show>
              <span class="w-12 shrink-0 whitespace-nowrap text-right text-[12px] tabular-nums text-fg-3">{formatAgo(thread().updatedAt)}</span>
            </button>
          )}
        </SearchList>
      </DialogBody>
    </Dialog>
  )
}
