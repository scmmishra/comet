import { panelInstanceId, type CoreMessage, type PanelParams, type DrawnView, type TabLayout } from "@desk/protocol"
import type { PluginLayout, ViewKind } from "@desk/plugin/host"
import type { Plugins } from "./plugins"

/** Where a tab's project and saved layout live. The window keeps them with the tab. */
export interface LayoutStore {
  projectOf(tabId: string): string
  /** Undefined for a tab no plugin has laid out. */
  layout(tabId: string): PluginLayout | undefined
  setLayout(tabId: string, layout: PluginLayout): void
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

  constructor(
    private readonly plugins: Plugins,
    private readonly store: LayoutStore,
    private readonly broadcast: (message: CoreMessage) => void,
  ) {}

  async send(tabId: string) {
    const project = this.store.projectOf(tabId)
    const send = (this.sends.get(tabId) ?? 0) + 1
    this.sends.set(tabId, send)
    const saved = this.saved(tabId)
    const offered = await this.plugins.offers(project)
    const on = (list: readonly { id: string }[], id: string) => list.some((found) => found.id === id)
    // A view that cannot be drawn is left out, and the user is told. The saved layout keeps it.
    const draw = (kind: ViewKind, id: string, params?: PanelParams) =>
      this.plugins.draw(tabId, project, kind, id, params).catch((error: Error) => {
        this.broadcast({ type: "error", message: error.message })
        return undefined
      })
    const [sidebar, panels, cards] = await Promise.all([
      saved.sidebar && on(offered.sidebars, saved.sidebar) ? draw("sidebar", saved.sidebar) : undefined,
      Promise.all(saved.panels.filter((open) => on(offered.panels, open.panel)).map((open) => draw("panel", open.panel, open.params))),
      Promise.all(offered.cards.filter((card) => !saved.hiddenCards.includes(card.id)).map((card) => draw("card", card.id))),
    ])
    if (this.sends.get(tabId) !== send) return
    const drawn = (views: (DrawnView | undefined)[]) => views.filter((view) => view !== undefined)
    const layout: TabLayout = { ...(sidebar ? { sidebar } : {}), panels: drawn(panels), cards: drawn(cards) }
    this.plugins.layout(tabId, layout.panels.map((panel) => panel.id))
    this.broadcast({ type: "layout", tabId, layout })
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
      if (replaced < 0) panels.push({ panel, params })
      else {
        this.plugins.undraw(tabId, panelInstanceId(panel, panels[replaced]!.params))
        panels[replaced] = { panel, params }
      }
      this.store.setLayout(tabId, { ...saved, panels })
      await this.send(tabId)
    }
    this.broadcast({ type: "panel.show", tabId, id })
  }

  async closePanel(tabId: string, id: string) {
    const saved = this.saved(tabId)
    this.store.setLayout(tabId, { ...saved, panels: saved.panels.filter((open) => panelInstanceId(open.panel, open.params) !== id) })
    this.plugins.undraw(tabId, id)
    await this.send(tabId)
  }

  /** Lays a new tab out as a setup says. */
  async openSetup(tabId: string, setup: string) {
    const { sidebar, panels, hiddenCards } = await this.plugins.find(this.store.projectOf(tabId), "setups", setup)
    this.store.setLayout(tabId, { ...(sidebar ? { sidebar } : {}), panels, hiddenCards })
    await this.send(tabId)
  }

  dropTab(tabId: string) {
    this.sends.delete(tabId)
  }

  private saved(tabId: string): PluginLayout {
    return this.store.layout(tabId) ?? EMPTY
  }
}
