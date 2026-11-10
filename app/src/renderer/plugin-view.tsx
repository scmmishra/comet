import type { UiValue } from "@desk/protocol"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { createEffect, createSignal, For, Match, onMount, Show, Switch, type JSX } from "solid-js"
import { formatMessageTime } from "./format"
import { Markdown } from "./markdown"
import { fire, openPanel, plugins } from "./plugins"
import { openFile } from "./projects"

/** Badge tints a plugin may ask for, as Desk's colours. */
const TINTS: Record<string, string> = {
  blue: "bg-accent-soft text-accent",
  green: "bg-add-soft text-add",
  red: "bg-del-soft text-del",
  orange: "bg-claude/15 text-claude",
  purple: "bg-accent-soft text-fg",
}

const BUTTON_VARIANTS = { primary: "contrast", secondary: "neutral", ghost: "ghost" } as const

/** A plugin's panel in a tab. It asks the core to draw it, then draws the plugin's nodes. Where it sits gives it its frame. */
export function PluginPanel(props: { tabId: string; project: string; panel: string }) {
  onMount(() => openPanel(props.tabId, props.project, props.panel))
  const drawn = () => plugins.panels[props.tabId]?.[props.panel]
  return (
    <Show when={drawn()} fallback={<div class="p-2 text-fg-3">Loading {props.panel}…</div>}>
      {(found) => <NodeView plugin={found().plugin} id={found().root} project={props.project} />}
    </Show>
  )
}

/** One node, drawn with Desk's component of its type. */
function NodeView(props: { plugin: string; id: number; project: string }): JSX.Element {
  const node = () => plugins.nodes[props.plugin]?.[props.id]
  const prop = (key: string) => node()?.props[key]
  const text = (key: string) => {
    const value = prop(key)
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined
  }
  const children = () => <For each={node()?.children ?? []}>{(child) => <NodeView plugin={props.plugin} id={child} project={props.project} />}</For>
  const handle = (key: string) => (...args: UiValue[]) => fire(props.plugin, prop(key), ...args)

  return (
    <Show when={node()}>
      {(found) => (
        <Switch fallback={<span class="text-fg-3">{found().type} is not a Desk element.</span>}>
          <Match when={found().type === "#text"}>{found().text}</Match>
          <Match when={found().type === "root"}>{children()}</Match>
          <Match when={found().type === "stack"}>
            <div
              class="flex min-h-0 min-w-0"
              classList={{ "flex-row items-center": prop("direction") === "row", "flex-col": prop("direction") !== "row", "flex-1": !!prop("grow") }}
              style={{ gap: `${Number(prop("gap") ?? 2) * 4}px` }}
            >
              {children()}
            </div>
          </Match>
          <Match when={found().type === "text"}>
            <span classList={{ "text-fg-3": prop("tone") === "muted", "font-medium text-fg": prop("tone") === "strong" }}>{children()}</span>
          </Match>
          <Match when={found().type === "list"}>
            <div class="desk-no-scrollbar flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">{children()}</div>
          </Match>
          <Match when={found().type === "item"}>
            <button
              type="button"
              class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-lg px-2.5 py-2 text-left"
              classList={{ "bg-raised": !!prop("selected"), "hover:bg-hover": !prop("selected"), "cursor-default": !prop("onSelect") }}
              onClick={() => handle("onSelect")()}
            >
              <span class="truncate text-fg">{text("title")}</span>
              <Show when={prop("badge") as { text: string; tint?: string } | undefined}>
                {(badge) => <Badge class={`border-0 ${TINTS[badge().tint ?? ""] ?? ""}`}>{badge().text}</Badge>}
              </Show>
              <Show when={text("subtitle")}>{(subtitle) => <span class="col-span-2 truncate text-[12px] text-fg-3">{subtitle()}</span>}</Show>
              <Show when={text("detail")}>{(detail) => <span class="col-span-2 truncate text-[12px] text-fg-3">{detail()}</span>}</Show>
            </button>
          </Match>
          <Match when={found().type === "button"}>
            <Button variant={BUTTON_VARIANTS[(prop("variant") as keyof typeof BUTTON_VARIANTS) ?? "secondary"] ?? "neutral"} disabled={!!prop("disabled")} onClick={() => handle("onClick")()}>
              {text("label")}
            </Button>
          </Match>
          <Match when={found().type === "textinput"}>
            <PluginInput
              value={text("value") ?? ""}
              placeholder={text("placeholder")}
              multiline={!!prop("multiline")}
              onInput={handle("onInput")}
              onSubmit={prop("onSubmit") ? handle("onSubmit") : undefined}
            />
          </Match>
          <Match when={found().type === "messages"}>
            <MessagesView items={(prop("items") ?? []) as unknown as MessageData[]} />
          </Match>
          <Match when={found().type === "markdown"}>
            <div class="min-h-0 overflow-y-auto">
              <Markdown text={text("text") ?? ""} done onOpenFile={(path, line) => openFile(props.project, path, line)} />
            </div>
          </Match>
        </Switch>
      )}
    </Show>
  )
}

interface MessageData {
  readonly id: string
  readonly text: string
  readonly author?: string
  readonly at?: number
  readonly kind?: "message" | "note" | "activity"
  readonly incoming?: boolean
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
