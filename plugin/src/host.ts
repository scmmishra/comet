import { panelInstanceId, splitContributionId, type PanelParams, type PluginLayout, type UiOp, type UiValue } from "@desk/protocol"
import { basename } from "node:path"
import { createRoot as solidRoot, createSignal, type Accessor, type JSX, type Setter } from "solid-js"
import type { Desk, PanelContext, PanelOptions, PluginDefinition, SetupOptions, TabContext, TurnEnd, TurnOutcome, ViewContext } from "./index"
import { callHandler, createRoot, createComponent, dispose, onOps, render, snapshot, type PluginNode } from "./renderer"

export type ViewKind = "sidebar" | "panel" | "card"

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

/** One view a tab shows. `key` is a panel's instance id, else the view's full name. */
export interface ViewRequest {
  readonly key: string
  readonly kind: ViewKind
  readonly name: string
  readonly params?: PanelParams
}

/** A view as drawn, or why it could not be. */
export type ViewResult = { readonly key: string; readonly root: number; readonly title: string } | { readonly key: string; readonly error: string }

/** Messages from the core to a plugin's worker. */
export type ToPlugin =
  /**
   * Every view of this plugin a tab shows, the panel instances open there for `isOpen`, and the key of
   * the plugin's thread the tab shows for `thread`. The worker draws what it lacks and disposes the rest.
   * `seq` pairs the answer with the ask.
   */
  | { readonly type: "show"; readonly seq: number; readonly tabId: string; readonly project: string; readonly views: readonly ViewRequest[]; readonly open: readonly string[]; readonly thread?: string }
  | { readonly type: "command"; readonly tabId: string; readonly project: string; readonly name: string; readonly input?: string }
  /** A tab closed. Its views and state go. */
  | { readonly type: "drop"; readonly tabId: string }
  | { readonly type: "event"; readonly handler: number; readonly args: readonly UiValue[] }
  | { readonly type: "snapshot" }
  /** The views of this plugin on screen, all in the one tab named. No tab means none is on screen. */
  | { readonly type: "visible"; readonly tabId?: string; readonly keys: readonly string[] }
  /** A tab moved to another thread. `key` is the plugin's own, or absent for a thread the plugin did not open. */
  | { readonly type: "threadShown"; readonly tabId: string; readonly key?: string }
  /** A turn ended in a thread the plugin opened. `key` is the plugin's own, without its prefix. */
  | { readonly type: "turnEnd"; readonly tabId: string; readonly key: string; readonly outcome: TurnOutcome }

/** Messages from a plugin's worker to the core. */
export type FromPlugin =
  /** Setup ran. Nothing else reaches the plugin before it. */
  | { readonly type: "ready"; readonly offers: Offers }
  /** Setup threw, so the plugin cannot run. */
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "ops"; readonly ops: readonly UiOp[] }
  | { readonly type: "snapshot"; readonly ops: readonly UiOp[] }
  | { readonly type: "shown"; readonly seq: number; readonly views: readonly ViewResult[] }
  | { readonly type: "thread"; readonly tabId: string; readonly key: string; readonly title?: string; readonly prompt?: string }
  | { readonly type: "open"; readonly tabId: string; readonly panel: string; readonly params?: PanelParams }
  | { readonly type: "close"; readonly tabId: string; readonly id: string }
  | { readonly type: "toast"; readonly message: string }
  /** Something the plugin did failed. The core shows it, named after the plugin. */
  | { readonly type: "error"; readonly message: string }

declare const self: Worker

type View = (ctx: ViewContext) => JSX.Element

/** One tab as the plugin sees it: the panel instances open there, its thread, and the views drawn for it. */
interface Tab {
  readonly open: Accessor<ReadonlySet<string>>
  readonly setOpen: Setter<ReadonlySet<string>>
  /** The key of the plugin's thread the tab shows. */
  readonly thread: Accessor<string | undefined>
  readonly setThread: Setter<string | undefined>
  readonly drawn: Map<string, { readonly root: PluginNode; readonly title: string; readonly dispose: () => void }>
}

/**
 * Runs a plugin inside its worker. Setup runs once and registers the plugin's views. Each view is drawn
 * once per tab, and a panel once per tab and set of parameters. It is kept while the tab shows it, so
 * the app can draw it again at any time.
 */
export function startHost(plugin: PluginDefinition) {
  const post = (message: FromPlugin) => self.postMessage(message)
  onOps((ops) => post({ type: "ops", ops }))

  const sidebars = new Map<string, { title: string; view: View }>()
  const panels = new Map<string, PanelOptions<PanelParams>>()
  const cards = new Map<string, { title: string; view: View }>()
  const setups = new Map<string, SetupOptions>()
  const commands = new Map<string, { title: string; input?: string; run: (ctx: TabContext, input?: string) => void }>()
  const turnEnds: ((turn: TurnEnd) => void | Promise<void>)[] = []
  let registering = true
  // Names are unique across kinds, because a sidebar, a card and a panel without parameters are drawn under their name.
  const names = new Set<string>()
  const register =
    <T>(kind: string, into: Map<string, T>) =>
    (name: string, options: T) => {
      if (!registering) throw new Error(`A plugin registers its ${kind}s while setup runs, not later.`)
      if (names.has(name)) throw new Error(`The plugin registers two things named ${name}.`)
      names.add(name)
      into.set(name, options)
    }
  const desk: Desk = {
    env: process.env,
    sidebar: register("sidebar", sidebars),
    panel: register("panel", panels) as Desk["panel"],
    card: register("card", cards),
    // A setup may name the views of a plugin that is off in a project, and those are left out. A name
    // with no plugin can never match, so it is refused here, where the plugin's author sees why.
    setup: (name, options) => {
      const named = [options.sidebar, ...(options.panels ?? []).map((open) => (typeof open === "string" ? open : open.panel)), ...(options.hideCards ?? [])]
      for (const id of named) if (id !== undefined) splitContributionId(id)
      register("setup", setups)(name, options)
    },
    command: register("command", commands),
    onTurnEnd: (handler) => {
      if (!registering) throw new Error("A plugin registers onTurnEnd while setup runs, not later.")
      turnEnds.push(handler)
    },
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
  // One signal for the whole plugin, since only one tab is on screen at a time.
  const [onScreen, setOnScreen] = solidRoot(() => createSignal<{ readonly tabId?: string; readonly keys: ReadonlySet<string> }>({ keys: new Set() }))
  const tabOf = (tabId: string): Tab => {
    let found = tabs.get(tabId)
    if (!found) {
      const [open, setOpen] = solidRoot(() => createSignal<ReadonlySet<string>>(new Set()))
      const [thread, setThread] = solidRoot(() => createSignal<string | undefined>())
      found = { open, setOpen, thread, setThread, drawn: new Map() }
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

  /** Draws one view for a tab, or names the one drawn before. */
  const draw = (tabId: string, project: string, request: ViewRequest): ViewResult => {
    const tab = tabOf(tabId)
    const found = tab.drawn.get(request.key)
    if (found) return { key: request.key, root: found.root.id, title: found.title }
    const ctx: ViewContext = {
      ...contextFor(tabId, project),
      visible: () => {
        const shown = onScreen()
        return shown.tabId === tabId && shown.keys.has(request.key)
      },
      thread: tab.thread,
    }
    let view: () => JSX.Element
    let title: string
    if (request.kind === "panel") {
      const panel = panels.get(request.name)
      if (!panel) return { key: request.key, error: `The plugin has no panel named ${request.name}.` }
      const params = request.params ?? {}
      const panelCtx: PanelContext = { ...ctx, params, close: () => post({ type: "close", tabId, id: request.key }) }
      view = () => panel.view(panelCtx)
      title = typeof panel.title === "string" ? panel.title : panel.title(params)
    } else {
      const registered = (request.kind === "sidebar" ? sidebars : cards).get(request.name)
      if (!registered) return { key: request.key, error: `The plugin has no ${request.kind} named ${request.name}.` }
      view = () => registered.view(ctx)
      title = registered.title
    }
    const root = createRoot()
    try {
      tab.drawn.set(request.key, { root, title, dispose: render(() => createComponent(view as unknown as () => PluginNode, {}), root) })
    } catch (error) {
      dispose(root)
      return { key: request.key, error: messageOf(error) }
    }
    return { key: request.key, root: root.id, title }
  }

  const show = (message: Extract<ToPlugin, { type: "show" }>) => {
    const tab = tabOf(message.tabId)
    const wanted = new Set(message.views.map((view) => view.key))
    for (const key of [...tab.drawn.keys()]) if (!wanted.has(key)) undraw(tab, key)
    tab.setOpen(new Set(message.open))
    tab.setThread(message.thread)
    post({ type: "shown", seq: message.seq, views: message.views.map((view) => draw(message.tabId, message.project, view)) })
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
      if (message.type === "show") show(message)
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
      // A tab the plugin has drawn nothing for hears its thread with its first `show`.
      else if (message.type === "threadShown") tabs.get(message.tabId)?.setThread(message.key)
      else if (message.type === "visible") setOnScreen({ ...(message.tabId ? { tabId: message.tabId } : {}), keys: new Set(message.keys) })
      else if (message.type === "turnEnd") {
        const turn: TurnEnd = { key: message.key, tabId: message.tabId, outcome: message.outcome }
        // One failing handler does not keep the others from running.
        const results = await Promise.allSettled(turnEnds.map(async (handler) => handler(turn)))
        for (const result of results) if (result.status === "rejected") post({ type: "error", message: messageOf(result.reason) })
      }
    } catch (error) {
      post({ type: "error", message: messageOf(error) })
    }
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
