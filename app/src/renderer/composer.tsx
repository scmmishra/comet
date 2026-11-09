import { createSignal, onMount, Show } from "solid-js"
import { modelLabel } from "./format"
import { Icon } from "./icons"
import { interrupt, send, type Tab } from "./store"

const MAX_HEIGHT_PX = 200

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
      class="mx-auto flex w-full max-w-[720px] flex-col gap-2 rounded-xl border border-border-weak-base bg-surface-raised-base px-3.5 pb-2 pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={input}
        data-composer
        rows={1}
        class="w-full resize-none bg-transparent text-text-strong outline-none placeholder:text-text-weaker"
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
      <div class="flex items-center gap-2 text-sm text-text-weak">
        <span class="text-text-base">{modelLabel(props.tab.model)}</span>
        <Show
          when={props.tab.busy}
          fallback={
            <button
              type="submit"
              aria-label="Send"
              class="ml-auto grid size-8 place-items-center rounded-full bg-text-strong text-background-base transition-opacity disabled:opacity-30"
              disabled={!text().trim()}
            >
              <Icon name="up" />
            </button>
          }
        >
          <button type="button" aria-label="Stop" class="ml-auto grid size-8 place-items-center rounded-full bg-surface-strong text-text-strong" onClick={interrupt}>
            <Icon name="stop" />
          </button>
        </Show>
      </div>
    </form>
  )
}
