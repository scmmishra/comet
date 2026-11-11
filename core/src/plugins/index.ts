import type { CoreMessage } from "@desk/protocol"
import { Layouts, type LayoutStore } from "./layouts"
import { Plugins } from "./plugins"

interface PluginHost {
  /** Sends to every client. */
  readonly broadcast: (message: CoreMessage) => void
  /** Shows the thread for a key in a tab, as a plugin asked. */
  readonly openThread: (tabId: string, thread: { key: string; title?: string; prompt?: string }) => void
  /** Where each tab's layout is kept. */
  readonly store: LayoutStore
  /** Tells the user about a failure in something a plugin asked for. */
  readonly report: (error: unknown) => void
}

/**
 * The plugins and the layouts that draw them. A plugin opens and closes panels through the layouts, and
 * the layouts draw what the plugins offer, so the two are made together.
 */
export function startPlugins({ broadcast, openThread, store, report }: PluginHost) {
  const plugins: Plugins = new Plugins({
    broadcast,
    openThread,
    openPanel: (tabId, panel, params) => void layouts.openPanel(tabId, panel, params).catch(report),
    closePanel: (tabId, id) => void layouts.closePanel(tabId, id).catch(report),
    stopped: () => void layouts.resendAll().catch(report),
  })
  const layouts = new Layouts(plugins, store, broadcast)
  return {
    plugins,
    layouts,
    /** Loads every plugin again, then lays out every tab again. */
    reload() {
      plugins.reload()
      return layouts.redrawAll()
    },
    /** Forgets a closed tab. */
    dropTab(tabId: string) {
      plugins.dropTab(tabId)
      layouts.dropTab(tabId)
    },
  }
}
