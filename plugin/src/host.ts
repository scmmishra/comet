import type { UiOp, UiValue } from "@desk/protocol"
import { createRoot as solidRoot } from "solid-js"
import type { Desk, PluginDefinition } from "./index"
import { callHandler, createRoot, createComponent, dispose, onOps, render, snapshot, type UiNode } from "./renderer"

/** Messages from the core to a plugin's worker. */
export type ToPlugin =
  | { readonly type: "open"; readonly tabId: string; readonly project: string; readonly panel: string }
  | { readonly type: "drop"; readonly tabId: string }
  | { readonly type: "event"; readonly handler: number; readonly args: readonly UiValue[] }
  | { readonly type: "snapshot" }

/** Messages from a plugin's worker to the core. */
export type FromPlugin =
  | { readonly type: "ops"; readonly ops: readonly UiOp[] }
  | { readonly type: "snapshot"; readonly ops: readonly UiOp[] }
  | { readonly type: "opened"; readonly tabId: string; readonly panel: string; readonly root: number }
  | { readonly type: "thread"; readonly tabId: string; readonly key: string; readonly title?: string; readonly prompt?: string }
  | { readonly type: "toast"; readonly message: string }
  /** Something the plugin did failed. The core shows it, named after the plugin. */
  | { readonly type: "error"; readonly message: string }

declare const self: Worker

/** One tab's instance of the plugin: what setup returned, and the panels drawn from it. */
interface Instance {
  readonly panels: Readonly<Record<string, () => unknown>>
  /** Each drawn panel's root, and how to stop drawing it. */
  readonly roots: Map<string, { readonly root: UiNode; readonly dispose: () => void }>
  readonly dispose: () => void
}

/**
 * Runs a plugin inside its worker. Each tab gets one instance of the plugin, and each panel one tree,
 * drawn once and kept until the tab closes, so the app can show it again at any time.
 */
export function startHost(plugin: PluginDefinition) {
  const post = (message: FromPlugin) => self.postMessage(message)
  const instances = new Map<string, Instance>()
  onOps((ops) => post({ type: "ops", ops }))

  const instance = (tabId: string, project: string): Instance => {
    let found = instances.get(tabId)
    if (found) return found
    found = solidRoot((disposeRoot) => {
      const desk: Desk = {
        project,
        $: Bun.$.cwd(project),
        openThread: (thread) => post({ type: "thread", tabId, ...thread }),
        toast: (message) => post({ type: "toast", message }),
      }
      return { panels: plugin.setup(desk).panels, roots: new Map(), dispose: disposeRoot }
    })
    instances.set(tabId, found)
    return found
  }

  self.onmessage = async (event: MessageEvent<ToPlugin>) => {
    const message = event.data
    try {
      if (message.type === "open") {
        const tab = instance(message.tabId, message.project)
        let drawn = tab.roots.get(message.panel)
        if (!drawn) {
          const panel = tab.panels[message.panel]
          if (!panel) throw new Error(`The plugin has no panel named ${message.panel}.`)
          const root = createRoot()
          drawn = { root, dispose: render(() => createComponent(panel as () => UiNode, {}), root) }
          tab.roots.set(message.panel, drawn)
        }
        post({ type: "opened", tabId: message.tabId, panel: message.panel, root: drawn.root.id })
      } else if (message.type === "drop") {
        const tab = instances.get(message.tabId)
        if (!tab) return
        instances.delete(message.tabId)
        for (const drawn of tab.roots.values()) {
          drawn.dispose()
          dispose(drawn.root)
        }
        tab.dispose()
      } else if (message.type === "event") await callHandler(message.handler, message.args)
      else if (message.type === "snapshot") post({ type: "snapshot", ops: snapshot() })
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }
}
