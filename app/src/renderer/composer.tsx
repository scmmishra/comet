import { createSignal, onMount, Show } from "solid-js"
import { modelLabel } from "./format"
import { Icon } from "./icons"
import { interrupt, send, type Tab } from "./store"

const MAX_HEIGHT_PX = 240

/** Claude's starburst mark: eight lines through the centre make sixteen rays. */
function ClaudeMark() {
  return (
    <svg viewBox="0 0 16 16" class="size-4 shrink-0 text-claude" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true">
      <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2M5.3 1.9l5.4 12.2M10.7 1.9 5.3 14.1M1.9 5.3l12.2 5.4M14.1 5.3 1.9 10.7" />
    </svg>
  )
}

/**
 * The message box, laid out as T3 Code's: a tall text area, then a row with the model and the
 * send button on the right. The row has room for attachments, permission mode and context, which
 * join it when Desk supports them.
 */
export function Composer(props: { tab: Tab }) {
  const [text, setText] = createSignal("")
  let input!: HTMLTextAreaElement

  // A new tab, and the first message moving the composer to the bottom, both start typing here.
  onMount(() => input.focus())

  const resize = () => {
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT_PX)}px`
  }

  const submit = () => {
    const value = text().trim()
    if (!value) return
    send(value)
    setText("")
    resize()
  }

  return (
    <form
      class="mx-auto flex w-full max-w-[720px] flex-col rounded-3xl bg-card shadow-[0_0_0_1px_var(--color-line)] transition-shadow focus-within:shadow-[0_0_0_1px_var(--color-hover)]"
      onClick={() => input.focus()}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={input}
        rows={2}
        aria-label="Message"
        class="min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-3"
        placeholder="Ask anything…"
        value={text()}
        onInput={(event) => {
          setText(event.currentTarget.value)
          resize()
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            submit()
          }
          if (event.key === "Escape" && props.tab.busy) interrupt()
        }}
      />
      <div class="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
        <span class="ml-auto inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[13px]">
          <ClaudeMark />
          {/* The SDK names the model once the session starts. */}
          <Show when={props.tab.model} fallback={<span class="text-fg-2">Claude Code</span>}>
            {(model) => <span class="text-fg">{modelLabel(model())}</span>}
          </Show>
        </span>
        <Show
          when={props.tab.busy}
          fallback={
            <button
              type="submit"
              aria-label="Send"
              class="grid size-8 place-items-center rounded-full bg-raised text-fg-2 transition-colors"
              classList={{ "bg-fg! text-ground!": !!text().trim() }}
            >
              <Icon name="up" />
            </button>
          }
        >
          <button type="button" aria-label="Stop" class="grid size-8 place-items-center rounded-full bg-fg text-ground" onClick={interrupt}>
            <Icon name="stop" />
          </button>
        </Show>
      </div>
    </form>
  )
}
