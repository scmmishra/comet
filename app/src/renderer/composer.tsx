import { IconButton } from "@opencode/ui/icon-button"
import { createSignal, onMount, Show } from "solid-js"
import { Icon } from "./icons"
import { ModelPicker } from "./model-picker"
import { interrupt, send, type Tab } from "./store"

const MAX_HEIGHT_PX = 240

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
        class="min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 text-[length:var(--desk-text-size)] leading-relaxed text-fg outline-none placeholder:text-fg-3"
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
        <ModelPicker tab={props.tab} />
        <Show
          when={props.tab.busy}
          fallback={<IconButton type="submit" variant="submit" size="large" class="size-8 rounded-full" aria-label="Send" disabled={!text().trim()} icon={<Icon name="arrow-up" />} />}
        >
          <IconButton variant="contrast" size="large" class="size-8 rounded-full" aria-label="Stop" icon={<Icon name="stop" />} onClick={interrupt} />
        </Show>
      </div>
    </form>
  )
}
