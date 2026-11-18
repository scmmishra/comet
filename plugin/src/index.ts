import type { IconName, MessageData, PanelParams, Tint, UiPrimitive, UiPrimitives } from "@comet/protocol"
import type { JSX } from "solid-js"
import { createElement, spread } from "./renderer"

export type { IconName, MessageData, PanelParams, Tint }

/**
 * Comet's plugin API. A plugin is a TSX module in `~/.comet/plugins/<name>/index.tsx` whose default
 * export is `definePlugin(setup)`. Comet runs it in the core, in a worker of its own, and draws its views
 * with Comet's own components. A plugin returns data and handlers, never markup.
 *
 * `setup` runs once, for every tab. It registers what the plugin offers. Each view Comet draws gets a
 * context for its own tab, so state made in `setup` is shared by every tab and state made in a view is not.
 */

/** What a view or a command can ask of Comet, for the tab it runs in. */
export interface TabContext {
  /** The folder the tab works in, and its name. */
  readonly project: { readonly path: string; readonly name: string }
  /** Bun's shell, run in the tab's folder. */
  readonly $: typeof Bun.$
  /** Opens a panel instance, named `<plugin>.<panel>`, in the tab, or brings the open one to the front. */
  open(panel: string, params?: PanelParams): void
  /** Whether that panel instance is open in the tab. It updates as panels open and close. */
  isOpen(panel: string, params?: PanelParams): boolean
  /** Opens or resumes the tab's thread for `key`, on the tab's agent. A new thread starts with `prompt`, when given. */
  openThread(thread: { readonly key: string; readonly title?: string; readonly prompt?: string }): void
  /** Shows a short message. */
  toast(message: string): void
}

/** What a view gets: its tab's context, and whether the view is on screen. */
export interface ViewContext extends TabContext {
  /**
   * Whether the view is on screen: its tab is the active tab and Comet has focus. A panel must also be the
   * panel in front, with the view pane open. It updates as that changes, so an effect can start and stop work.
   */
  visible(): boolean
  /**
   * The key of this plugin's thread the tab shows, as the plugin passed it to `openThread`. Undefined
   * while the tab shows another thread. It updates as the tab moves between threads.
   */
  thread(): string | undefined
}

/** What a panel's view gets: its view context, its parameters, and a way to close itself. */
export interface PanelContext<P extends PanelParams = PanelParams> extends ViewContext {
  readonly params: P
  close(): void
}

/** A panel, opened once per set of parameters. `params` names what it needs, such as a conversation's id. */
export interface PanelOptions<P extends PanelParams> {
  readonly title: string | ((params: P) => string)
  readonly params?: readonly (keyof P & string)[]
  /** A tab shows one instance of this panel. Opening another replaces it in place, such as the next conversation. */
  readonly single?: boolean
  readonly view: (ctx: PanelContext<P>) => JSX.Element
}

/** How a turn ended: it finished, it failed, or the user stopped it. */
export type TurnOutcome = "done" | "error" | "interrupted"

/** A turn that ended in a thread the plugin opened. `key` is the key the plugin passed to `openThread`. */
export interface TurnEnd {
  readonly key: string
  readonly tabId: string
  readonly outcome: TurnOutcome
}

/** A layout for a new tab: a sidebar and panels, each named `<plugin>.<name>`. A name that is not on is skipped. */
/** A setup names each view by its full id, such as `support.inbox`, so it can name another plugin's views too. */
export interface SetupOptions {
  readonly title: string
  readonly sidebar?: string
  readonly panels?: readonly (string | { readonly panel: string; readonly params?: PanelParams })[]
  /** Plugin cards the setup leaves out of the card stack. The Space card always shows. */
  readonly hideCards?: readonly string[]
}

/** What `setup` gets: the calls that register what the plugin offers, each under a name unique in the plugin. */
export interface Comet {
  /** The core's environment, such as an API key. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** A view for the column beside the thread, such as an inbox. */
  sidebar(name: string, options: { readonly title: string; readonly view: (ctx: ViewContext) => JSX.Element }): void
  panel<P extends PanelParams = PanelParams>(name: string, options: PanelOptions<P>): void
  /** A view for the card stack. A card that draws nothing is left out. */
  card(name: string, options: { readonly title: string; readonly view: (ctx: ViewContext) => JSX.Element }): void
  setup(name: string, options: SetupOptions): void
  /** A palette command. With `input`, the palette asks for text, using it as the placeholder. */
  command(name: string, options: { readonly title: string; readonly input?: string; readonly run: (ctx: TabContext, input?: string) => void }): void
  /**
   * Runs `handler` each time a turn ends in a thread the plugin opened, in any tab. A turn the user
   * stopped and a turn that failed count too. Turns in other threads never reach the plugin.
   */
  onTurnEnd(handler: (turn: TurnEnd) => void | Promise<void>): void
  /** Shows a short message. */
  toast(message: string): void
}

export interface PluginDefinition {
  readonly setup: (comet: Comet) => void
}

export function definePlugin(setup: PluginDefinition["setup"]): PluginDefinition {
  return { setup }
}

/** A primitive: a node of `type` with these props. Comet draws it with its component of that name. */
function primitive<T extends UiPrimitive, C = {}>(type: T) {
  return (props: UiPrimitives[T] & C): JSX.Element => {
    const node = createElement(type)
    spread(node, props as Record<string, unknown>)
    return node as unknown as JSX.Element
  }
}

type Children = { children?: JSX.Element }

/** One component per primitive in UiPrimitives, so a new primitive must be added here. */
const PRIMITIVES = {
  stack: primitive<"stack", Children>("stack"),
  text: primitive<"text", Children>("text"),
  list: primitive<"list", Children>("list"),
  item: primitive("item"),
  button: primitive("button"),
  textinput: primitive("textinput"),
  messages: primitive("messages"),
  markdown: primitive("markdown"),
} satisfies { [T in UiPrimitive]: (props: UiPrimitives[T]) => JSX.Element }

export const { stack: Stack, text: Text, list: List, item: Item, button: Button, textinput: TextInput, messages: Messages, markdown: Markdown } = PRIMITIVES
