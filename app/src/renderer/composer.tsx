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
      class="mx-auto grid w-full max-w-[720px] gap-1.5 rounded-3xl bg-raised pb-2 pl-3.5 pr-2.5 pt-[11px] shadow-[0_0_0_1px_var(--color-line)]"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={input}
        rows={1}
        aria-label="Message"
        class="min-h-[22px] w-full resize-none bg-transparent text-fg outline-none placeholder:text-fg-3"
        placeholder="Ask anything, / for commands, @ for context…"
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
      <div class="flex items-center gap-1 text-fg-2">
        <span class="inline-flex h-[26px] items-center gap-1.5 rounded-md px-[7px]">
          <span class="size-1.5 rounded-full bg-claude" />
          {/* The SDK names the model once the session starts. */}
          <Show when={props.tab.model} fallback="Claude Code">
            {(model) => (
              <>
                <span class="text-fg-3">Claude Code /</span> {modelLabel(model())}
              </>
            )}
          </Show>
        </span>
        <Show
          when={props.tab.busy}
          fallback={
            <button
              type="submit"
              aria-label="Send"
              class="ml-auto grid size-7 place-items-center rounded-lg bg-fg-3 text-ground transition-colors"
              classList={{ "bg-fg!": !!text().trim() }}
            >
              <Icon name="up" />
            </button>
          }
        >
          <button type="button" aria-label="Stop" class="ml-auto grid size-7 place-items-center rounded-lg bg-fg text-ground" onClick={interrupt}>
            <Icon name="stop" />
          </button>
        </Show>
      </div>
    </form>
  )
}
