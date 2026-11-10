import { applyOps, type TabLayout, type UiNode, type UiOp, type UiValue } from "@desk/protocol"
import { createStore, produce } from "solid-js/store"
import { core } from "./core"

/** What the core sends about plugins: each plugin's nodes, and what plugins show in each tab. */
const [plugins, setPlugins] = createStore({
  nodes: {} as Record<string, Record<number, UiNode>>,
  /** By tab. A tab the core has not laid out yet is absent. */
  layouts: {} as Record<string, TabLayout>,
})
export { plugins }
if (import.meta.env.DEV) Object.assign(window, { __deskPlugins: plugins })

const asked = new Set<string>()
export function loadLayout(tabId: string) {
  if (asked.has(tabId)) return
  asked.add(tabId)
  core.send({ type: "layout.get", tabId })
}

export function openPanel(tabId: string, panel: string) {
  core.send({ type: "panel.open", tabId, panel })
}

export function closePanel(tabId: string, id: string) {
  core.send({ type: "panel.close", tabId, id })
}

export function runPluginCommand(tabId: string, command: string, input?: string) {
  core.send({ type: "plugin.command", tabId, command, ...(input !== undefined ? { input } : {}) })
}

/** Lays a saved tab out as a setup says. */
export function applySetup(tabId: string, setup: string) {
  asked.add(tabId)
  core.send({ type: "setup.open", tabId, setup })
}

/** Runs a handler a plugin's node holds, such as a button's onClick. */
export function fire(plugin: string, value: { readonly handler: number } | undefined, ...args: UiValue[]) {
  if (value) core.send({ type: "plugin.event", plugin, handler: value.handler, args })
}

/** Whether a view drew nothing, such as a card that does not apply. */
export const isEmptyView = (plugin: string, root: number) => !plugins.nodes[plugin]?.[root]?.children.length

function apply(plugin: string, ops: readonly UiOp[], reset: boolean) {
  setPlugins(
    "nodes",
    produce((all) => {
      if (reset || !all[plugin]) all[plugin] = {}
      applyOps(all[plugin]!, ops)
    }),
  )
}

core.listen((message) => {
  if (message.type === "plugin.ops") apply(message.plugin, message.ops, !!message.reset)
  // Replaced whole, so a sidebar the tab no longer has goes.
  else if (message.type === "layout") setPlugins("layouts", produce((all) => void (all[message.tabId] = message.layout)))
  // The core sends the tabs on each connect. A core that restarted holds no drawn views, so each tab that asked before asks again.
  else if (message.type === "tabs") {
    const open = new Set(message.tabs.map((tab) => tab.id))
    for (const tabId of [...asked]) {
      asked.delete(tabId)
      if (open.has(tabId)) loadLayout(tabId)
    }
  }
})

// A hot-swapped copy of this module would start empty, and the core does not send its state again. In development, a change here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
