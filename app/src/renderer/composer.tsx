import { IMAGE_TYPES, type FollowUp, type ImageAttachment, type QueuedMessage, type TabInfo } from "@desk/protocol"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { account } from "./account"
import { imageUrl, readImages } from "./attachments"
import { fileIcon } from "./file-icons"
import { Icon } from "./icons"
import { ModelPicker, openModelPicker } from "./model-picker"
import { findFiles, projectData, readProject } from "./projects"
import { QueuedMessages } from "./queue"
import { clearThread, interrupt, removeQueued, send, threadOf } from "./threads"
import { complete, matchCommands, triggerAt, type Trigger } from "./triggers"

const MAX_HEIGHT_PX = 240

/** One row of the list the composer offers above itself, for @ files or / commands. */
interface Suggestion {
  readonly key: string
  readonly icon: JSX.Element
  readonly label: string
  /** Quieter text after the label, such as a file's folder or a command's description. */
  readonly detail?: string
  readonly pick: () => void
}

/** Desk's own commands, after T3 Code's. They act at once, rather than going to Claude. */
const DESK_COMMANDS = [
  { name: "model", description: "Switch the model for this tab" },
  { name: "clear", description: "Start a fresh session; the thread starts empty" },
] as const

const FOLLOW_UP: Record<FollowUp, { label: string; icon: "arrow-up-right" | "outline-list-changelog"; other: FollowUp }> = {
  steer: { label: "Steer message", icon: "arrow-up-right", other: "queue" },
  queue: { label: "Queue message", icon: "outline-list-changelog", other: "steer" },
}

/**
 * The message box, laid out as T3 Code's: images, a tall text area, then a row with the attach
 * button on the left and the model and send button on the right. Typing @ lists the project's
 * files, and / at the start lists commands. Images come from the attach button, a paste or a drop. While Claude works, a message steers
 * the turn or waits in the queue, as the Follow-ups setting says, and ⌘Enter does the other.
 */
export function Composer(props: { tab: TabInfo }) {
  const [text, setText] = createSignal("")
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [trigger, setTrigger] = createSignal<Trigger>()
  const [files, setFiles] = createSignal<readonly string[]>([])
  const [active, setActive] = createSignal(0)
  const busy = () => threadOf(props.tab.id).busy
  const canSend = () => !!text().trim() || images().length > 0
  /** What sending does while Claude works. `alternate` is ⌘Enter or a ⌘-click, which does the other. */
  const followUp = (alternate: boolean): FollowUp => {
    const chosen = account.settings.claude.followUp
    return alternate ? FOLLOW_UP[chosen].other : chosen
  }
  let input!: HTMLTextAreaElement
  let row!: HTMLDivElement
  let picker!: HTMLInputElement

  // A new tab, and the first message moving the composer to the bottom, both start typing here.
  onMount(() => input.focus())

  const resize = () => {
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT_PX)}px`
  }

  // Each change to a typed file mention asks the core again. An answer to an older query is dropped.
  createEffect(
    on(
      () => (trigger()?.kind === "file" ? trigger()!.query : undefined),
      (query) => {
        if (query === undefined) return setFiles([])
        onCleanup(findFiles(props.tab.project, query, setFiles))
      },
    ),
  )
  // Claude Code's commands are read once per project, when / first opens the list.
  createEffect(() => trigger()?.kind === "command" && projectData(props.tab.project).skills === undefined && readProject(props.tab.project, "skills"))
  const readTrigger = () => setTrigger(triggerAt(input.value, input.selectionStart))

  /** Puts `inserted` in place of the trigger and what was typed after it. */
  const completeWith = (inserted: string) => {
    const typed = trigger()
    if (!typed) return
    const next = complete(input.value, typed.start, input.selectionStart, inserted)
    setText(next.text)
    input.value = next.text
    input.setSelectionRange(next.caret, next.caret)
    setTrigger(undefined)
    resize()
  }
  /** Runs one of Desk's own commands, and clears the box of it. */
  const runDesk = (name: (typeof DESK_COMMANDS)[number]["name"]) => {
    setText("")
    setTrigger(undefined)
    resize()
    if (name === "model") openModelPicker(props.tab.id)
    else clearThread(props.tab.id)
  }

  const suggestions = createMemo((): Suggestion[] => {
    const typed = trigger()
    if (!typed) return []
    if (typed.kind === "file") {
      return files().map((path) => {
        const slash = path.lastIndexOf("/")
        return {
          key: path,
          icon: (
            <svg class="size-[14px] shrink-0" aria-hidden="true">
              <use href={`#${fileIcon(path)}`} />
            </svg>
          ),
          label: path.slice(slash + 1),
          detail: path.slice(0, slash + 1),
          pick: () => completeWith(`@${path}`),
        }
      })
    }
    const desk = new Set<string>(DESK_COMMANDS.map((command) => command.name))
    const commands = [...DESK_COMMANDS, ...(projectData(props.tab.project).skills ?? [])]
    return matchCommands(commands, typed.query).map((command) => ({
      key: command.name,
      icon: <Icon name={desk.has(command.name) ? "settings-gear" : "builtin" in command && command.builtin ? "outline-console" : "post-skill"} class="size-[14px] shrink-0 text-fg-3" />,
      label: `/${command.name}${"argumentHint" in command && command.argumentHint ? ` ${command.argumentHint}` : ""}`,
      detail: command.description,
      pick: desk.has(command.name) ? () => runDesk(command.name as (typeof DESK_COMMANDS)[number]["name"]) : () => completeWith(`/${command.name}`),
    }))
  })
  // A new list starts at its first row.
  createEffect(on(suggestions, () => setActive(0)))
  const listing = () => suggestions().length > 0

  const addImages = async (files: Iterable<File>) => {
    const added = await readImages(files)
    if (added.length) setImages((current) => [...current, ...added])
  }

  const submit = (alternate = false) => {
    if (!canSend()) return
    send(props.tab.id, text().trim(), images(), busy() ? followUp(alternate) : undefined)
    setText("")
    setImages([])
    setTrigger(undefined)
    resize()
  }

  /** Takes a queued message back into the composer to edit, after anything already typed. */
  const edit = (message: QueuedMessage) => {
    removeQueued(props.tab.id, message.id)
    setText((current) => (current.trim() ? `${current}\n\n${message.text}` : message.text))
    setImages((current) => [...current, ...(message.images ?? [])])
    input.focus()
    resize()
  }

  return (
    <>
    <QueuedMessages tab={props.tab} onEdit={edit} />
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
        <div
          role="listbox"
          aria-label={trigger()?.kind === "command" ? "Commands" : "Files"}
          class="absolute inset-x-0 bottom-full mb-2 max-h-[280px] overflow-y-auto rounded-2xl bg-card p-1.5 shadow-[0_0_0_1px_var(--color-line),0_8px_24px_rgb(0_0_0/25%)]"
        >
          <For each={suggestions()}>
            {(suggestion, index) => (
              <div
                role="option"
                aria-selected={index() === active()}
                class="flex h-8 cursor-default items-center gap-2 rounded-lg px-2.5 text-[13px] aria-selected:bg-hover"
                ref={(row) => createEffect(() => index() === active() && row.scrollIntoView({ block: "nearest" }))}
                onMouseEnter={() => setActive(index())}
                // Keeps focus in the text area, so the caret the completion replaces is still there.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => suggestion.pick()}
              >
                {suggestion.icon}
                <span class="shrink-0 text-fg">{suggestion.label}</span>
                <Show when={suggestion.detail}>
                  <span class="min-w-0 truncate text-fg-3">{suggestion.detail}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={images().length}>
        <div class="flex flex-wrap gap-2 px-3.5 pt-3">
          <For each={images()}>
            {(image, index) => (
              // An image pops in, so a paste or a drop shows it landed.
              <div class="desk-pop group/image relative">
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
        placeholder="Ask anything, @ to add files, / for commands"
        value={text()}
        onInput={(event) => {
          setText(event.currentTarget.value)
          readTrigger()
          resize()
        }}
        // Moving the caret out of a trigger closes its list.
        onKeyUp={(event) => (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") && readTrigger()}
        onClick={readTrigger}
        onBlur={() => setTrigger(undefined)}
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
              return setActive((index) => (index + step + suggestions().length) % suggestions().length)
            }
            if ((event.key === "Enter" || event.key === "Tab") && !event.isComposing) {
              event.preventDefault()
              return suggestions()[active()]!.pick()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              return setTrigger(undefined)
            }
          }
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            submit(event.metaKey || event.ctrlKey)
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
          {/* While Claude works, the button sends a follow-up once there is one to send, and stops the turn otherwise. */}
          <Show
            when={canSend()}
            fallback={<IconButton variant="contrast" size="large" class="size-8 rounded-full" aria-label="Stop" icon={<Icon name="stop" />} onClick={() => interrupt(props.tab.id)} />}
          >
            <Tooltip value={`Click to ${followUp(false)}, ⌘-click or ⌘Enter to ${followUp(true)}`} placement="top">
              <IconButton
                variant="submit"
                size="large"
                class="size-8 rounded-full"
                aria-label={FOLLOW_UP[followUp(false)].label}
                icon={<Icon name={FOLLOW_UP[followUp(false)].icon} />}
                onClick={(event: MouseEvent) => {
                  event.preventDefault()
                  submit(event.metaKey || event.ctrlKey)
                }}
              />
            </Tooltip>
          </Show>
        </Show>
      </div>
    </form>
    </>
  )
}
