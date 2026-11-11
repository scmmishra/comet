import type { ViewRequest } from "@desk/plugin/host"
import { panelInstanceId, splitContributionId, type CoreMessage, type DrawnView, type PanelParams, type PluginLayout, type TabInfo, type TabLayout } from "@desk/protocol"
import type { Plugins } from "./plugins"

/** Where a tab's project and saved layout live. The window keeps them with the tab. */
export interface LayoutStore {
  projectOf(tabId: string): string
  /** Undefined for a tab no plugin has laid out. */
  layout(tabId: string): PluginLayout | undefined
  setLayout(tabId: string, layout: PluginLayout): void
  /** The tab the window shows, if any. */
  activeTab(): TabInfo | undefined
}

/** A tab no plugin has laid out shows only cards. */
const EMPTY: PluginLayout = { panels: [], hiddenCards: [] }

/**
 * What plugins show in each tab: a sidebar, open panel instances and cards. The core owns it, so a
 * plugin and the app change it the same way, and the app draws what the core sends. Only views of
 * plugins on in the tab's project open.
 */
export class Layouts {
  private sends = new Map<string, number>()
  /** Cards that failed to draw in a tab. They stay out of it, so the user hears of each once. */
  private brokenCards = new Map<string, Set<string>>()
  /** The layout last sent for each tab, which says what the tab draws. */
  private shown = new Map<string, TabLayout>()
  /**
   * Whether Desk's window has focus, as the app last said. It starts true, since Desk opens in front.
   * After the core restarts behind an unfocused window, it stays true until the window's focus next changes.
   */
  private focused = true

  constructor(
    private readonly plugins: Plugins,
    private readonly store: LayoutStore,
    private readonly broadcast: (message: CoreMessage) => void,
  ) {}

  /**
   * Has the plugins draw what a tab shows, and sends it. A sidebar or panel that cannot be drawn is
   * closed, and a card is left out of the tab. The user is told why.
   */
  async send(tabId: string) {
    const project = this.store.projectOf(tabId)
    const send = (this.sends.get(tabId) ?? 0) + 1
    this.sends.set(tabId, send)
    const saved = this.saved(tabId)
    const offered = await this.plugins.offers(project)
    const on = (list: readonly { id: string }[], id: string) => list.some((found) => found.id === id)
    const view = (kind: ViewRequest["kind"], id: string, params?: PanelParams): ViewRequest => ({
      key: kind === "panel" ? panelInstanceId(id, params) : id,
      kind,
      name: splitContributionId(id).name,
      ...(kind === "panel" ? { params: params ?? {} } : {}),
    })
    const broken = this.brokenCards.get(tabId) ?? new Set<string>()
    const sidebar = saved.sidebar && on(offered.sidebars, saved.sidebar) ? view("sidebar", saved.sidebar) : undefined
    const panels = saved.panels.filter((open) => on(offered.panels, open.panel)).map((open) => view("panel", open.panel, open.params))
    const cards = offered.cards.filter((card) => !saved.hiddenCards.includes(card.id) && !broken.has(card.id)).map((card) => view("card", card.id))
    const views = [...(sidebar ? [sidebar] : []), ...panels, ...cards]
    const results = await this.plugins.show(tabId, project, views, panels.map((panel) => panel.key))
    if (this.sends.get(tabId) !== send) return

    const drawn = (request: ViewRequest): DrawnView | undefined => {
      const result = results.get(request.key)
      if (!result) return undefined
      if ("root" in result) return { id: request.key, title: result.title, plugin: splitContributionId(request.key).plugin, root: result.root }
      this.broadcast({ type: "error", message: `${request.key} could not be drawn, so it was ${request.kind === "card" ? "left out" : "closed"}: ${result.error}` })
      return undefined
    }
    const shownSidebar = sidebar && drawn(sidebar)
    const layout: TabLayout = {
      ...(shownSidebar ? { sidebar: shownSidebar } : {}),
      panels: panels.flatMap((panel) => drawn(panel) ?? []),
      cards: cards.flatMap((card) => {
        const found = drawn(card)
        if (!found && results.has(card.key)) this.brokenCards.set(tabId, broken.add(card.key))
        return found ?? []
      }),
    }
    const failed = (request: ViewRequest) => {
      const result = results.get(request.key)
      return !!result && "error" in result
    }
    if ((sidebar && failed(sidebar)) || panels.some(failed)) {
      this.store.setLayout(tabId, {
        ...(saved.sidebar && !(sidebar && failed(sidebar)) ? { sidebar: saved.sidebar } : {}),
        panels: saved.panels.filter((open) => !panels.some((panel) => failed(panel) && panel.key === panelInstanceId(open.panel, open.params))),
        hiddenCards: saved.hiddenCards,
      })
    }
    this.shown.set(tabId, layout)
    this.broadcast({ type: "layout", tabId, layout })
    this.sendVisible()
  }

  /** The window gained or lost focus. */
  windowFocus(focused: boolean) {
    this.focused = focused
    this.sendVisible()
  }

  /**
   * Tells plugins which of their views are on screen. Those are the active tab's sidebar and cards, and
   * its panel in front when the view pane is open. Nothing is on screen while the window lacks focus.
   * The core calls it when the tabs, a layout or the window's focus change.
   */
  sendVisible() {
    const tab = this.focused ? this.store.activeTab() : undefined
    const layout = tab && this.shown.get(tab.id)
    if (!tab || !layout) return this.plugins.visible(undefined, [])
    const panel = tab.panelOpen === true ? layout.panels.find((found) => found.id === tab.panelActive) : undefined
    const views = [layout.sidebar, panel, ...layout.cards].filter((view) => view !== undefined)
    this.plugins.visible(tab.id, views.map((view) => view.id))
  }

  /** Opens a panel instance in a tab, or brings the open one to the front. */
  async openPanel(tabId: string, panel: string, params: PanelParams = {}) {
    const offered = await this.plugins.find(this.store.projectOf(tabId), "panels", panel)
    const missing = offered.params.filter((name) => params[name] === undefined)
    if (missing.length) throw new Error(`The panel ${panel} needs ${missing.join(", ")}.`)
    const id = panelInstanceId(panel, params)
    const saved = this.saved(tabId)
    if (!saved.panels.some((open) => panelInstanceId(open.panel, open.params) === id)) {
      const replaced = offered.single ? saved.panels.findIndex((open) => open.panel === panel) : -1
      const panels = [...saved.panels]
      panels.splice(replaced < 0 ? panels.length : replaced, replaced < 0 ? 0 : 1, { panel, params })
      this.store.setLayout(tabId, { ...saved, panels })
      await this.send(tabId)
    }
    this.broadcast({ type: "panel.show", tabId, id })
  }

  async closePanel(tabId: string, id: string) {
    const saved = this.saved(tabId)
    this.store.setLayout(tabId, { ...saved, panels: saved.panels.filter((open) => panelInstanceId(open.panel, open.params) !== id) })
    await this.send(tabId)
  }

  /** Lays a new tab out as a setup says. */
  async openSetup(tabId: string, setup: string) {
    const { sidebar, panels, hiddenCards } = await this.plugins.find(this.store.projectOf(tabId), "setups", setup)
    this.store.setLayout(tabId, { ...(sidebar ? { sidebar } : {}), panels, hiddenCards })
    await this.send(tabId)
  }

  /** Lays out again every tab sent before, such as after a plugin stopped. */
  async resendAll() {
    await Promise.all([...this.sends.keys()].map((tabId) => this.send(tabId)))
  }

  dropTab(tabId: string) {
    this.sends.delete(tabId)
    this.brokenCards.delete(tabId)
    this.shown.delete(tabId)
  }

  private saved(tabId: string): PluginLayout {
    return this.store.layout(tabId) ?? EMPTY
  }
}
