import { applyOps, type SetupInfo, type UiNode, type UiOp, type UiValue } from "@desk/protocol"
import { createStore, produce } from "solid-js/store"
import { core } from "./core"

/** A panel drawn for a tab: which plugin drew it, and the node it starts at. */
export interface DrawnPanel {
  readonly plugin: string
  readonly root: number
}

/** What the core sends about plugins: each plugin's nodes, each tab's drawn panels, and the setups. */
const [plugins, setPlugins] = createStore({
  /** By plugin, then by node id. */
  nodes: {} as Record<string, Record<number, UiNode>>,
  /** By tab, then by panel name, such as `chatwoot.inbox`. */
  panels: {} as Record<string, Record<string, DrawnPanel>>,
  setups: [] as readonly SetupInfo[],
})
export { plugins }
// In development, the page's copy of plugin nodes is readable from the console, to compare with what the plugin drew.
if (import.meta.env.DEV) Object.assign(window, { __deskPlugins: plugins })

export const setupOf = (id: string | undefined) => (id ? plugins.setups.find((setup) => setup.id === id) : undefined)

/** Asks the core to draw a panel for a tab. A panel drawn before is named again, not drawn twice. */
export function openPanel(tabId: string, project: string, panel: string) {
  if (!plugins.panels[tabId]?.[panel]) core.send({ type: "panel.open", tabId, project, panel })
}

/** Runs a handler a plugin's node holds, such as a button's onClick. */
export function fire(plugin: string, value: UiValue, ...args: UiValue[]) {
  if (typeof value === "object" && value !== null && "handler" in value) core.send({ type: "plugin.event", plugin, handler: value.handler as number, args })
}

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
  else if (message.type === "panel") setPlugins("panels", message.tabId, (panels) => ({ ...panels, [message.panel]: { plugin: message.plugin, root: message.root } }))
  else if (message.type === "setups") setPlugins("setups", message.setups)
})

// A hot-swapped copy of this module would start empty, and the core does not send its state again. In development, a change here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
