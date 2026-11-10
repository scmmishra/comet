import type { QueuedMessage, TabInfo } from "@desk/protocol"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, For, Show } from "solid-js"
import { imageUrl } from "./attachments"
import { Icon } from "./icons"
import { removeQueued, resumeQueue, sendQueued, threadOf } from "./threads"

/** The queue shows this many messages until the user asks for all of them. */
const SHOWN = 3

/**
 * A tab's queued messages, above the composer, after T3 Code: dashed bubbles waiting for the turn to
 * end. Each can be sent now, edited in the composer, or removed. A stop or an error pauses the queue
 * until the user resumes it.
 */
export function QueuedMessages(props: { tab: TabInfo; onEdit: (message: QueuedMessage) => void }) {
  const [all, setAll] = createSignal(false)
  const queue = () => threadOf(props.tab.id).queue ?? []
  const shown = () => (all() ? queue() : queue().slice(0, SHOWN))
  // A message queued while the tab is on screen rises out of the composer. Those already queued show at once.
  const queuedBefore = new Set(queue().map((message) => message.id))
  return (
    <Show when={queue().length}>
      <div class="mb-2 flex flex-col items-end gap-1.5" aria-label="Queued messages">
        <Show when={threadOf(props.tab.id).queueHeld}>
          <div class="flex items-center gap-2 text-[12px] text-fg-3">
            The queue paused when the turn stopped.
            <Button size="small" onClick={() => resumeQueue(props.tab.id)}>
              Resume
            </Button>
          </div>
        </Show>
        <For each={shown()}>
          {(message) => (
            // The message reads in full, as a sent one does, and its actions sit under it, after T3 Code.
            <div class="flex w-full flex-col items-end gap-1" classList={{ "desk-rise": !queuedBefore.has(message.id) }}>
              {/* Dashed and unfilled: a message not sent yet. */}
              <div class="flex min-w-0 max-w-[80%] flex-col gap-2 rounded-2xl border border-dashed border-fg-3/40 px-3 py-2 text-[length:var(--desk-text-size)] text-fg-2">
                <Show when={message.images?.length}>
                  <div class="flex flex-wrap gap-1">
                    <For each={message.images}>{(image) => <img src={imageUrl(image)} alt="" class="size-8 rounded-md object-cover shadow-[0_0_0_1px_var(--color-line)]" />}</For>
                  </div>
                </Show>
                <Show when={message.text}>
                  <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p>
                </Show>
              </div>
              <div class="flex items-center gap-0.5 pe-1 text-[12px] text-fg-3">
                <Tooltip value={threadOf(props.tab.id).busy ? "Send into the current turn" : "Start a turn with this message"} placement="top">
                  <Button size="small" variant="ghost-muted" icon="arrow-up" onClick={() => sendQueued(props.tab.id, message.id)}>
                    Send now
                  </Button>
                </Tooltip>
                <Tooltip value="Edit in the composer" placement="top">
                  <IconButton variant="ghost-muted" size="small" aria-label="Edit queued message" icon={<Icon name="edit" class="size-[13px]" />} onClick={() => props.onEdit(message)} />
                </Tooltip>
                <Tooltip value="Remove from queue" placement="top">
                  <IconButton variant="ghost-muted" size="small" aria-label="Remove queued message" icon={<Icon name="xmark-small" />} onClick={() => removeQueued(props.tab.id, message.id)} />
                </Tooltip>
              </div>
            </div>
          )}
        </For>
        <Show when={queue().length > SHOWN}>
          <button class="text-[12px] text-fg-3 hover:text-fg-2" onClick={() => setAll(!all())}>
            {all() ? "Show fewer" : `Show all ${queue().length} queued`}
          </button>
        </Show>
      </div>
    </Show>
  )
}
