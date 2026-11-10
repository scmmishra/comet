import { panelInstanceId, type PanelParams, type UiOp, type UiValue } from "@desk/protocol"
import { basename } from "node:path"
import { createRoot as solidRoot, createSignal, type Accessor, type JSX, type Setter } from "solid-js"
import type { Desk, PanelContext, PanelOptions, PluginDefinition, SetupOptions, TabContext } from "./index"
import { callHandler, createRoot, createComponent, dispose, onOps, render, snapshot, type PluginNode } from "./renderer"

export type ViewKind = "sidebar" | "panel" | "card"

/** What plugins show in a tab, by full name: its sidebar, its open panel instances in order, and the plugin cards it leaves out. */
export interface PluginLayout {
  readonly sidebar?: string
  readonly panels: readonly { readonly panel: string; readonly params: PanelParams }[]
  readonly hiddenCards: readonly string[]
}

/** A setup: a titled layout for a new tab. */
interface SetupLayout extends PluginLayout {
  readonly title: string
}

/** What a plugin registered, by kind. Names are the plugin's own, without its prefix. */
export interface Offers {
  readonly sidebars: readonly { readonly name: string; readonly title: string }[]
  /** `title` is absent for a panel whose title is made from parameters it needs. */
  readonly panels: readonly { readonly name: string; readonly params: readonly string[]; readonly single: boolean; readonly title?: string }[]
  readonly cards: readonly { readonly name: string; readonly title: string }[]
  readonly setups: readonly ({ readonly name: string } & SetupLayout)[]
  readonly commands: readonly { readonly name: string; readonly title: string; readonly input?: string }[]
}

/** Messages from the core to a plugin's worker. `key` names one drawn view in a tab: a panel's instance id, else the view's full name. */
export type ToPlugin =
  | { readonly type: "draw"; readonly tabId: string; readonly project: string; readonly key: string; readonly kind: ViewKind; readonly name: string; readonly params?: PanelParams }
  | { readonly type: "undraw"; readonly tabId: string; readonly key: string }
  /** The panel instances open in a tab, by instance id, for `isOpen`. */
  | { readonly type: "layout"; readonly tabId: string; readonly open: readonly string[] }
  | { readonly type: "command"; readonly tabId: string; readonly project: string; readonly name: string; readonly input?: string }
  | { readonly type: "drop"; readonly tabId: string }
  | { readonly type: "event"; readonly handler: number; readonly args: readonly UiValue[] }
  | { readonly type: "snapshot" }

/** Messages from a plugin's worker to the core. */
export type FromPlugin =
  /** Setup ran. Nothing else reaches the plugin before it. */
  | { readonly type: "ready"; readonly offers: Offers }
  /** Setup threw, so the plugin cannot run. */
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "ops"; readonly ops: readonly UiOp[] }
  | { readonly type: "snapshot"; readonly ops: readonly UiOp[] }
  | { readonly type: "drawn"; readonly tabId: string; readonly key: string; readonly root: number; readonly title: string }
  /** A view could not be drawn, such as one the plugin does not have. */
  | { readonly type: "undrawn"; readonly tabId: string; readonly key: string; readonly message: string }
  | { readonly type: "thread"; readonly tabId: string; readonly key: string; readonly title?: string; readonly prompt?: string }
  | { readonly type: "open"; readonly tabId: string; readonly panel: string; readonly params?: PanelParams }
  | { readonly type: "close"; readonly tabId: string; readonly id: string }
  | { readonly type: "toast"; readonly message: string }
  /** Something the plugin did failed. The core shows it, named after the plugin. */
  | { readonly type: "error"; readonly message: string }

declare const self: Worker

type View = (ctx: TabContext) => JSX.Element

/** One tab as the plugin sees it: the panel instances open there, and the views drawn for it. */
interface Tab {
  readonly open: Accessor<ReadonlySet<string>>
  readonly setOpen: Setter<ReadonlySet<string>>
  readonly drawn: Map<string, { readonly root: PluginNode; readonly title: string; readonly dispose: () => void }>
}

/**
 * Runs a plugin inside its worker. Setup runs once and registers the plugin's views. Each view is drawn
 * once per tab, and a panel once per tab and set of parameters, and kept until the core undraws it or the tab closes, so the app can show it again at any time.
 */
export function startHost(plugin: PluginDefinition) {
  const post = (message: FromPlugin) => self.postMessage(message)
  onOps((ops) => post({ type: "ops", ops }))

  const sidebars = new Map<string, { title: string; view: View }>()
  const panels = new Map<string, PanelOptions<PanelParams>>()
  const cards = new Map<string, { title: string; view: View }>()
  const setups = new Map<string, SetupOptions>()
  const commands = new Map<string, { title: string; input?: string; run: (ctx: TabContext, input?: string) => void }>()
  let registering = true
  const register =
    <T>(kind: string, into: Map<string, T>) =>
    (name: string, options: T) => {
      if (!registering) throw new Error(`A plugin registers its ${kind}s while setup runs, not later.`)
      if (into.has(name)) throw new Error(`The plugin registers two ${kind}s named ${name}.`)
      into.set(name, options)
    }
  const desk: Desk = {
    env: process.env,
    sidebar: register("sidebar", sidebars),
    panel: register("panel", panels) as Desk["panel"],
    card: register("card", cards),
    setup: register("setup", setups),
    command: register("command", commands),
    toast: (message) => post({ type: "toast", message }),
  }
  try {
    solidRoot(() => plugin.setup(desk))
  } catch (error) {
    post({ type: "failed", message: messageOf(error) })
    return
  }
  registering = false

  const tabs = new Map<string, Tab>()
  const tabOf = (tabId: string): Tab => {
    let found = tabs.get(tabId)
    if (!found) {
      const [open, setOpen] = solidRoot(() => createSignal<ReadonlySet<string>>(new Set()))
      found = { open, setOpen, drawn: new Map() }
      tabs.set(tabId, found)
    }
    return found
  }
  const contextFor = (tabId: string, project: string): TabContext => ({
    project: { path: project, name: basename(project) },
    $: Bun.$.cwd(project),
    open: (panel, params) => post({ type: "open", tabId, panel, ...(params ? { params } : {}) }),
    isOpen: (panel, params) => tabOf(tabId).open().has(panelInstanceId(panel, params)),
    openThread: (thread) => post({ type: "thread", tabId, ...thread }),
    toast: desk.toast,
  })
  const undraw = (tab: Tab, key: string) => {
    const drawn = tab.drawn.get(key)
    if (!drawn) return
    tab.drawn.delete(key)
    drawn.dispose()
    dispose(drawn.root)
  }

  const draw = (message: Extract<ToPlugin, { type: "draw" }>) => {
    const tab = tabOf(message.tabId)
    let drawn = tab.drawn.get(message.key)
    if (!drawn) {
      const ctx = contextFor(message.tabId, message.project)
      let view: () => JSX.Element
      let title: string
      if (message.kind === "panel") {
        const panel = panels.get(message.name)
        if (!panel) throw new Error(`The plugin has no panel named ${message.name}.`)
        const params = message.params ?? {}
        const panelCtx: PanelContext = { ...ctx, params, close: () => post({ type: "close", tabId: message.tabId, id: message.key }) }
        view = () => panel.view(panelCtx)
        title = typeof panel.title === "string" ? panel.title : panel.title(params)
      } else {
        const found = (message.kind === "sidebar" ? sidebars : cards).get(message.name)
        if (!found) throw new Error(`The plugin has no ${message.kind} named ${message.name}.`)
        view = () => found.view(ctx)
        title = found.title
      }
      const root = createRoot()
      drawn = { root, title, dispose: render(() => createComponent(view as unknown as () => PluginNode, {}), root) }
      tab.drawn.set(message.key, drawn)
    }
    post({ type: "drawn", tabId: message.tabId, key: message.key, root: drawn.root.id, title: drawn.title })
  }

  post({
    type: "ready",
    offers: {
      sidebars: [...sidebars].map(([name, { title }]) => ({ name, title })),
      panels: [...panels].map(([name, panel]) => {
        const params = [...(panel.params ?? [])]
        const title = typeof panel.title === "string" ? panel.title : params.length ? undefined : panel.title({})
        return { name, params, single: !!panel.single, ...(title !== undefined ? { title } : {}) }
      }),
      cards: [...cards].map(([name, { title }]) => ({ name, title })),
      setups: [...setups].map(([name, setup]) => ({
        name,
        title: setup.title,
        ...(setup.sidebar ? { sidebar: setup.sidebar } : {}),
        panels: (setup.panels ?? []).map((open) => (typeof open === "string" ? { panel: open, params: {} } : { panel: open.panel, params: open.params ?? {} })),
        hiddenCards: [...(setup.hideCards ?? [])],
      })),
      commands: [...commands].map(([name, { title, input }]) => ({ name, title, ...(input ? { input } : {}) })),
    },
  })

  self.onmessage = async (event: MessageEvent<ToPlugin>) => {
    const message = event.data
    try {
      if (message.type === "draw") {
        try {
          draw(message)
        } catch (error) {
          post({ type: "undrawn", tabId: message.tabId, key: message.key, message: messageOf(error) })
        }
      } else if (message.type === "undraw") {
        const tab = tabs.get(message.tabId)
        if (tab) undraw(tab, message.key)
      } else if (message.type === "layout") tabOf(message.tabId).setOpen(new Set(message.open))
      else if (message.type === "command") {
        const command = commands.get(message.name)
        if (!command) throw new Error(`The plugin has no command named ${message.name}.`)
        await command.run(contextFor(message.tabId, message.project), message.input)
      } else if (message.type === "drop") {
        const tab = tabs.get(message.tabId)
        if (!tab) return
        tabs.delete(message.tabId)
        for (const key of [...tab.drawn.keys()]) undraw(tab, key)
      } else if (message.type === "event") await callHandler(message.handler, message.args)
      else if (message.type === "snapshot") post({ type: "snapshot", ops: snapshot() })
    } catch (error) {
      post({ type: "error", message: messageOf(error) })
    }
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
