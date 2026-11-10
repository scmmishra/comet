import { IMAGE_TYPES, type ImageAttachment, type TabInfo } from "@desk/protocol"
import { IconButton } from "@opencode/ui/icon-button"
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { imageUrl, readImages } from "./attachments"
import { fileIcon } from "./file-icons"
import { Icon } from "./icons"
import { insertMention, mentionAt } from "./mentions"
import { ModelPicker } from "./model-picker"
import { findFiles } from "./projects"
import { interrupt, send, threadOf } from "./threads"

const MAX_HEIGHT_PX = 240

/**
 * The message box, laid out as T3 Code's: images, a tall text area, then a row with the attach
 * button on the left and the model and send button on the right. Typing @ lists the project's
 * files. Images come from the attach button, a paste or a drop.
 */
export function Composer(props: { tab: TabInfo }) {
  const [text, setText] = createSignal("")
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [mention, setMention] = createSignal<{ start: number; query: string }>()
  const [matches, setMatches] = createSignal<readonly string[]>([])
  const [active, setActive] = createSignal(0)
  const busy = () => threadOf(props.tab.id).busy
  const canSend = () => !!text().trim() || images().length > 0
  let input!: HTMLTextAreaElement
  let row!: HTMLDivElement
  let picker!: HTMLInputElement

  // A new tab, and the first message moving the composer to the bottom, both start typing here.
  onMount(() => input.focus())

  const resize = () => {
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT_PX)}px`
  }

  // Each change to the typed mention asks the core again. An answer to an older query is dropped.
  createEffect(
    on(
      () => mention()?.query,
      (query) => {
        if (query === undefined) return setMatches([])
        onCleanup(findFiles(props.tab.project, query, (paths) => {
          setMatches(paths)
          setActive(0)
        }))
      },
    ),
  )
  const listing = () => mention() !== undefined && matches().length > 0
  const readMention = () => setMention(mentionAt(input.value, input.selectionStart))

  const pick = (path: string) => {
    const typed = mention()
    if (!typed) return
    const next = insertMention(input.value, typed.start, input.selectionStart, path)
    setText(next.text)
    input.value = next.text
    input.setSelectionRange(next.caret, next.caret)
    setMention(undefined)
    resize()
  }

  const addImages = async (files: Iterable<File>) => {
    const added = await readImages(files)
    if (added.length) setImages((current) => [...current, ...added])
  }

  const submit = () => {
    if (!canSend()) return
    send(props.tab.id, text().trim(), images())
    setText("")
    setImages([])
    setMention(undefined)
    resize()
  }

  return (
    <form
      class="relative flex w-full flex-col rounded-3xl bg-card shadow-[0_0_0_1px_var(--color-line)] transition-shadow focus-within:shadow-[0_0_0_1px_var(--color-hover)]"
      // A click on the box's own blank space types in it. Clicks on its controls, and in their popovers, stay theirs.
      onClick={(event) => (event.target === event.currentTarget || event.target === row) && input.focus()}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onDragOver={(event) => event.dataTransfer?.types.includes("Files") && event.preventDefault()}
      onDrop={(event) => {
        if (!event.dataTransfer?.files.length) return
        event.preventDefault()
        void addImages(event.dataTransfer.files)
      }}
    >
      <Show when={listing()}>
        <div role="listbox" aria-label="Files" class="absolute inset-x-0 bottom-full mb-2 max-h-[280px] overflow-y-auto rounded-2xl bg-card p-1.5 shadow-[0_0_0_1px_var(--color-line),0_8px_24px_rgb(0_0_0/25%)]">
          <For each={matches()}>
            {(path, index) => {
              const slash = path.lastIndexOf("/")
              return (
                <div
                  role="option"
                  aria-selected={index() === active()}
                  class="flex h-8 cursor-default items-center gap-2 rounded-lg px-2.5 text-[13px] aria-selected:bg-hover"
                  onMouseEnter={() => setActive(index())}
                  // Keeps focus in the text area, so the caret the mention replaces is still there.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(path)}
                >
                  <svg class="size-[14px] shrink-0" aria-hidden="true">
                    <use href={`#${fileIcon(path)}`} />
                  </svg>
                  <span class="shrink-0 text-fg">{path.slice(slash + 1)}</span>
                  <span class="min-w-0 truncate text-fg-3">{path.slice(0, slash + 1)}</span>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
      <Show when={images().length}>
        <div class="flex flex-wrap gap-2 px-3.5 pt-3">
          <For each={images()}>
            {(image, index) => (
              <div class="group/image relative">
                <img src={imageUrl(image)} alt="" class="size-14 rounded-xl object-cover shadow-[0_0_0_1px_var(--color-line)]" />
                <IconButton
                  variant="contrast"
                  size="small"
                  class="absolute -right-1.5 -top-1.5 size-5 rounded-full opacity-0 group-hover/image:opacity-100 focus-visible:opacity-100"
                  aria-label="Remove image"
                  icon={<Icon name="xmark-small" />}
                  onClick={() => setImages((current) => current.filter((_, at) => at !== index()))}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
      <textarea
        ref={input}
        rows={2}
        aria-label="Message"
        class="min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 text-[length:var(--desk-text-size)] leading-relaxed text-fg outline-none placeholder:text-fg-3"
        placeholder="Ask anything, @ to add files"
        value={text()}
        onInput={(event) => {
          setText(event.currentTarget.value)
          readMention()
          resize()
        }}
        // Moving the caret out of a mention closes its list.
        onKeyUp={(event) => (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") && readMention()}
        onClick={readMention}
        onBlur={() => setMention(undefined)}
        onPaste={(event) => {
          const files = [...(event.clipboardData?.files ?? [])]
          if (!files.length) return
          event.preventDefault()
          void addImages(files)
        }}
        onKeyDown={(event) => {
          if (listing()) {
            const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
            if (step) {
              event.preventDefault()
              return setActive((index) => (index + step + matches().length) % matches().length)
            }
            if ((event.key === "Enter" || event.key === "Tab") && !event.isComposing) {
              event.preventDefault()
              return pick(matches()[active()]!)
            }
            if (event.key === "Escape") {
              event.preventDefault()
              return setMention(undefined)
            }
          }
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            submit()
          }
          if (event.key === "Escape") interrupt(props.tab.id)
        }}
      />
      <div ref={row} class="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
        <IconButton variant="ghost" size="large" class="size-8 rounded-full" aria-label="Add images" icon={<Icon name="plus" />} onClick={() => picker.click()} />
        <input
          ref={picker}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={(event) => {
            void addImages([...(event.currentTarget.files ?? [])])
            event.currentTarget.value = ""
          }}
        />
        <ModelPicker tab={props.tab} />
        <Show
          when={busy()}
          fallback={<IconButton type="submit" variant="submit" size="large" class="size-8 rounded-full" aria-label="Send" disabled={!canSend()} icon={<Icon name="arrow-up" />} />}
        >
          <IconButton variant="contrast" size="large" class="size-8 rounded-full" aria-label="Stop" icon={<Icon name="stop" />} onClick={() => interrupt(props.tab.id)} />
        </Show>
      </div>
    </form>
  )
}
