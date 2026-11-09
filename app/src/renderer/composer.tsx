import { createSignal, Show } from "solid-js"
import { interrupt, send, type Tab } from "./store"

const MAX_HEIGHT_PX = 200

export function Composer(props: { tab: Tab }) {
  const [text, setText] = createSignal("")
  let input!: HTMLTextAreaElement

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
        <span>Claude Code{props.tab.model ? ` · ${props.tab.model}` : ""}</span>
        <Show
          when={props.tab.busy}
          fallback={
            <button type="submit" class="ml-auto rounded-md bg-text-strong px-2.5 py-1 text-background-base disabled:opacity-40" disabled={!text().trim()}>
              Send
            </button>
          }
        >
          <button type="button" class="ml-auto rounded-md bg-surface-strong px-2.5 py-1 text-text-strong" onClick={interrupt}>
            Stop
          </button>
        </Show>
      </div>
    </form>
  )
}
