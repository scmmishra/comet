import type { SetupInfo, UiOp, UiValue } from "@desk/protocol"
import { createStore, produce } from "solid-js/store"
import { core } from "./core"

/** One node of a plugin's UI, as the app keeps it. */
export interface UiNode {
  readonly type: string
  props: Record<string, UiValue>
  children: number[]
  text?: string
  parent?: number
}

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

export const setupOf = (id: string | undefined) => (id ? plugins.setups.find((setup) => setup.id === id) : undefined)

/** Asks the core to draw a panel for a tab. A panel drawn before is named again, not drawn twice. */
export function openPanel(tabId: string, project: string, panel: string) {
  if (!plugins.panels[tabId]?.[panel]) core.send({ type: "panel.open", tabId, project, panel })
}

/** Runs a handler a plugin's node holds, such as a button's onClick. */
export function fire(plugin: string, value: UiValue, ...args: UiValue[]) {
  if (typeof value === "object" && value !== null && "handler" in value) core.send({ type: "plugin.event", plugin, handler: value.handler as number, args })
}

/** Applies a batch of changes to a plugin's nodes. A node moved to another parent leaves its old one first. */
function apply(plugin: string, ops: readonly UiOp[], reset: boolean) {
  setPlugins(
    "nodes",
    produce((all) => {
      if (reset || !all[plugin]) all[plugin] = {}
      const nodes = all[plugin]!
      const detach = (id: number) => {
        const node = nodes[id]
        const parent = node?.parent === undefined ? undefined : nodes[node.parent]
        if (parent) parent.children = parent.children.filter((child) => child !== id)
        if (node) node.parent = undefined
      }
      const drop = (id: number) => {
        for (const child of nodes[id]?.children ?? []) drop(child)
        delete nodes[id]
      }
      for (const op of ops) {
        if (op.op === "create") nodes[op.id] = { type: op.type, props: {}, children: [] }
        else if (op.op === "text") {
          const node = nodes[op.id]
          if (node) node.text = op.text
          else nodes[op.id] = { type: "#text", props: {}, children: [], text: op.text }
        } else if (op.op === "set") {
          const node = nodes[op.id]
          if (node) node.props[op.key] = op.value
        } else if (op.op === "insert") {
          const parent = nodes[op.parent]
          if (!parent || !nodes[op.id]) continue
          detach(op.id)
          const at = op.before === undefined ? -1 : parent.children.indexOf(op.before)
          if (at < 0) parent.children.push(op.id)
          else parent.children.splice(at, 0, op.id)
          nodes[op.id]!.parent = op.parent
        } else if (op.op === "remove") {
          detach(op.id)
          drop(op.id)
        }
      }
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
