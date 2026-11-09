import type { JSX } from "solid-js"
import { createElement, spread } from "./renderer"

/**
 * Desk's plugin API. A plugin is a TSX module in `~/.desk/plugins/<name>/index.tsx` whose default
 * export is `definePlugin(setup)`. Desk runs it in the core, in a worker of its own, and draws its
 * panels with Desk's own components. A plugin returns data and handlers, never markup.
 */

/** What a plugin can ask of Desk. One instance per tab, so a tab's panels share it. */
export interface Desk {
  /** The folder the tab works in. */
  readonly project: string
  /** Bun's shell, run in the tab's folder. */
  readonly $: typeof Bun.$
  /** Opens or resumes the tab's Claude thread for `key`. A new thread starts with `prompt`, when given. */
  openThread(thread: { readonly key: string; readonly title?: string; readonly prompt?: string }): void
  /** Shows a short message. */
  toast(message: string): void
}

/** A panel: a component Desk places in a setup's layout. */
export type Panel = () => JSX.Element

export interface PluginDefinition {
  readonly setup: (desk: Desk) => { readonly panels: Readonly<Record<string, Panel>> }
}

/** Declares a plugin. `setup` runs once per tab that shows one of its panels. */
export function definePlugin(setup: PluginDefinition["setup"]): PluginDefinition {
  return { setup }
}

/** A colour a badge takes. */
export type Tint = "neutral" | "blue" | "green" | "orange" | "red" | "purple"

/** One message in a conversation. `note` sets it apart as private, `activity` draws it as one quiet line. */
export interface MessageData {
  readonly id: string
  readonly text: string
  readonly author?: string
  /** Milliseconds since the epoch. */
  readonly at?: number
  readonly kind?: "message" | "note" | "activity"
  /** Whether it came from the other side, such as a customer. */
  readonly incoming?: boolean
}

/** A primitive: a node of `type` with these props. Desk draws it with its component of that name. */
function primitive<P>(type: string) {
  return (props: P): JSX.Element => {
    const node = createElement(type)
    spread(node, props as Record<string, unknown>)
    return node as unknown as JSX.Element
  }
}

/** Children in a row or a column. */
export const Stack = primitive<{ direction?: "row" | "column"; gap?: number; grow?: boolean; children?: JSX.Element }>("stack")
/** Text. `muted` sets it quieter, `strong` heavier. */
export const Text = primitive<{ tone?: "normal" | "muted" | "strong"; children?: JSX.Element }>("text")
/** A scrolling list of items. */
export const List = primitive<{ children?: JSX.Element }>("list")
/** One row of a list. It is selectable when it has `onSelect`. */
export const Item = primitive<{
  title: string
  subtitle?: string
  detail?: string
  badge?: { text: string; tint?: Tint }
  selected?: boolean
  onSelect?: () => void
}>("item")
export const Button = primitive<{ label: string; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; onClick: () => void }>("button")
/** A text field. Desk keeps what is typed and reports it through `onInput`. Setting `value` replaces it, such as "" to clear it. */
export const TextInput = primitive<{
  value: string
  placeholder?: string
  multiline?: boolean
  onInput: (value: string) => void
  /** Enter, or ⌘Enter in a multiline field. */
  onSubmit?: () => void
}>("textinput")
/** A conversation, oldest first. */
export const Messages = primitive<{ items: readonly MessageData[] }>("messages")
export const Markdown = primitive<{ text: string }>("markdown")
