import { ROOT_NODE, TEXT_NODE, type ButtonVariant, type DrawnView, type MessageData, type Tint, type UiPrimitive, type UiProps, type UiValue } from "@desk/protocol"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { createEffect, createSignal, For, Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { formatMessageTime } from "./format"
import { Markdown } from "./markdown"
import { fire, plugins } from "./plugins"
import { openFile } from "./file-tabs"

/** Badge tints a plugin may ask for, as Desk's colours. */
const TINTS: Record<Tint, string> = {
  neutral: "",
  blue: "bg-accent-soft text-accent",
  green: "bg-add-soft text-add",
  red: "bg-del-soft text-del",
  orange: "bg-claude/15 text-claude",
  purple: "bg-accent-soft text-fg",
}

const BUTTON_VARIANTS: Record<ButtonVariant, "contrast" | "neutral" | "ghost"> = { primary: "contrast", secondary: "neutral", ghost: "ghost" }

interface DrawProps<T extends UiPrimitive> {
  readonly props: UiProps<T>
  readonly children: JSX.Element
  readonly run: (handler: { readonly handler: number } | undefined, ...args: UiValue[]) => void
  readonly project: string
}

/** Desk's component for each primitive. It names every type in UiPrimitives, so a new primitive must be drawn here. */
const DRAW: { [T in UiPrimitive]: (draw: DrawProps<T>) => JSX.Element } = {
  stack: (draw) => (
    <div
      class="flex min-h-0 min-w-0"
      classList={{ "flex-row items-center": draw.props.direction === "row", "flex-col": draw.props.direction !== "row", "flex-1": !!draw.props.grow }}
      style={{ gap: `${(draw.props.gap ?? 2) * 4}px` }}
    >
      {draw.children}
    </div>
  ),
  text: (draw) => <span classList={{ "text-fg-3": draw.props.tone === "muted", "font-medium text-fg": draw.props.tone === "strong" }}>{draw.children}</span>,
  list: (draw) => <div class="desk-no-scrollbar flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">{draw.children}</div>,
  item: (draw) => (
    <button
      type="button"
      class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-lg px-2.5 py-2 text-left"
      classList={{ "bg-raised": !!draw.props.selected, "hover:bg-hover": !draw.props.selected, "cursor-default": !draw.props.onSelect }}
      onClick={() => draw.run(draw.props.onSelect)}
    >
      <span class="truncate text-fg">{draw.props.title}</span>
      <Show when={draw.props.badge}>{(badge) => <Badge class={`border-0 ${TINTS[badge().tint ?? "neutral"]}`}>{badge().text}</Badge>}</Show>
      <Show when={draw.props.subtitle}>{(subtitle) => <span class="col-span-2 truncate text-[12px] text-fg-3">{subtitle()}</span>}</Show>
      <Show when={draw.props.detail}>{(detail) => <span class="col-span-2 truncate text-[12px] text-fg-3">{detail()}</span>}</Show>
    </button>
  ),
  button: (draw) => (
    <Button variant={BUTTON_VARIANTS[draw.props.variant ?? "secondary"]} disabled={!!draw.props.disabled} onClick={() => draw.run(draw.props.onClick)}>
      {draw.props.label}
    </Button>
  ),
  textinput: (draw) => (
    <PluginInput
      value={draw.props.value}
      placeholder={draw.props.placeholder}
      multiline={!!draw.props.multiline}
      onInput={(value) => draw.run(draw.props.onInput, value)}
      onSubmit={draw.props.onSubmit ? () => draw.run(draw.props.onSubmit) : undefined}
    />
  ),
  messages: (draw) => <MessagesView items={draw.props.items ?? []} />,
  markdown: (draw) => (
    <div class="min-h-0 overflow-y-auto">
      <Markdown text={draw.props.text} done onOpenFile={(path, line) => openFile(draw.project, path, line)} />
    </div>
  ),
}

const isPrimitive = (type: string): type is UiPrimitive => Object.hasOwn(DRAW, type)

/** A view a plugin drew for a tab, such as a sidebar, a panel or a card. Where it sits gives it its frame. */
export function PluginView(props: { view: DrawnView; project: string }) {
  return <NodeView plugin={props.view.plugin} id={props.view.root} project={props.project} />
}

function NodeView(props: { plugin: string; id: number; project: string }): JSX.Element {
  const node = () => plugins.nodes[props.plugin]?.[props.id]
  const children = () => <For each={node()?.children ?? []}>{(child) => <NodeView plugin={props.plugin} id={child} project={props.project} />}</For>
  const run = (handler: { readonly handler: number } | undefined, ...args: UiValue[]) => fire(props.plugin, handler, ...args)
  return (
    <Show when={node()}>
      {(found) => {
        const type = found().type
        if (type === TEXT_NODE) return <>{found().text}</>
        if (type === ROOT_NODE) return children()
        if (!isPrimitive(type)) return <span class="text-fg-3">{type} is not a Desk element.</span>
        return <Dynamic component={DRAW[type] as (draw: DrawProps<UiPrimitive>) => JSX.Element} props={found().props as never} run={run} project={props.project}>{children()}</Dynamic>
      }}
    </Show>
  )
}

/** A conversation, oldest first, kept scrolled to its end. */
function MessagesView(props: { items: readonly MessageData[] }) {
  let box!: HTMLDivElement
  createEffect(() => {
    void props.items.length
    box.scrollTop = box.scrollHeight
  })
  return (
    <div ref={box} class="desk-no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <For each={props.items}>
        {(message) => (
          <Show
            when={message.kind !== "activity"}
            fallback={
              <div class="text-center text-[12px] text-fg-3">
                {message.text}
                <Show when={message.at}>{(at) => ` · ${formatMessageTime(at())}`}</Show>
              </div>
            }
          >
            <div class="flex flex-col gap-1" classList={{ "items-start": !!message.incoming, "items-end": !message.incoming }}>
              <span class="text-[12px] text-fg-3">
                {message.kind === "note" ? "Private note · " : ""}
                {message.author ?? ""}
                <Show when={message.at}>{(at) => ` · ${formatMessageTime(at())}`}</Show>
              </span>
              <div
                class="max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2"
                classList={{ "bg-raised": !!message.incoming, "bg-accent-soft": !message.incoming && message.kind !== "note", "bg-claude/15": message.kind === "note" }}
              >
                {message.text}
              </div>
            </div>
          </Show>
        )}
      </For>
    </div>
  )
}

/**
 * A plugin's text field. What is typed stays here, so typing never waits on the plugin. The plugin
 * hears each change, and a value it sets that differs from what it last heard replaces the text, such
 * as "" after a send.
 */
function PluginInput(props: { value: string; placeholder?: string; multiline: boolean; onInput: (value: string) => void; onSubmit?: () => void }) {
  const [text, setText] = createSignal(props.value)
  let heard = props.value
  createEffect(() => {
    if (props.value !== heard) setText((heard = props.value))
  })
  const input = (value: string) => {
    setText((heard = value))
    props.onInput(value)
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (props.multiline ? event.metaKey : !event.shiftKey) && props.onSubmit) {
      event.preventDefault()
      props.onSubmit()
    }
  }
  return (
    <Show
      when={props.multiline}
      fallback={<TextInput class="w-full" value={text()} placeholder={props.placeholder} onInput={(event) => input(event.currentTarget.value)} onKeyDown={keydown} />}
    >
      <Textarea class="w-full" rows={3} value={text()} placeholder={props.placeholder} onInput={(event) => input(event.currentTarget.value)} onKeyDown={keydown} />
    </Show>
  )
}
