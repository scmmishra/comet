import { applyOps, type CoreMessage, type PluginLayout, type TabInfo, type TabLayout, type UiNode } from "@desk/protocol"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder } from "../test-support"
import { startPlugins } from "."

export function installPlugin(name: string, source: string) {
  mkdirSync(join(process.env.DESK_HOME!, "plugins", name), { recursive: true })
  writeFileSync(join(process.env.DESK_HOME!, "plugins", name, "index.tsx"), source)
}

export function turnOn(config: { everywhere?: string[]; projects?: Record<string, string[]> }) {
  writeFileSync(join(process.env.DESK_HOME!, "plugins.json"), JSON.stringify(config))
}

/**
 * Plugins and layouts for tabs in one project, with the app's copy of
 * every plugin's nodes. Saved layouts live in memory.
 */
export function harness() {
  const project = tempFolder("project")
  const saved: Record<string, PluginLayout> = {}
  const sent: CoreMessage[] = []
  const threads: { tabId: string; key: string; title?: string; prompt?: string }[] = []
  const nodes: Record<string, Record<number, UiNode>> = {}
  /** The tab the window shows. A test sets it, then calls `layouts.sendVisible()` as the core does on a save. */
  const screen: { active?: TabInfo } = {}
  /** The full key of the plugin thread each tab shows. `showThread` moves a tab, as the window does. */
  const shownThreads: Record<string, string | undefined> = {}
  const broadcast = (message: CoreMessage) => {
    sent.push(message)
    if (message.type !== "plugin.ops") return
    if (message.reset || !nodes[message.plugin]) nodes[message.plugin] = {}
    applyOps(nodes[message.plugin]!, message.ops)
  }
  const ui = startPlugins({
    broadcast,
    openThread: (tabId, thread) => threads.push({ tabId, ...thread }),
    store: { projectOf: () => project, layout: (tabId) => saved[tabId], setLayout: (tabId, layout) => (saved[tabId] = layout), activeTab: () => screen.active, threadKeyOf: (tabId) => shownThreads[tabId] },
    report: () => {},
  })
  const { plugins, layouts } = ui
  const showThread = (tabId: string, threadKey: string | undefined) => {
    shownThreads[tabId] = threadKey
    plugins.threadShown(tabId, threadKey)
  }

  /** The last layout sent for a tab. */
  const layout = (tabId: string) => sent.findLast((message): message is Extract<CoreMessage, { type: "layout" }> => message.type === "layout" && message.tabId === tabId)?.layout
  /** The text under a node, as the app would draw it. */
  const textOf = (plugin: string, id: number): string => {
    const node = nodes[plugin]?.[id]
    return node?.text ?? (node?.children ?? []).map((child) => textOf(plugin, child)).join("")
  }
  /** The handler a node of `plugin` holds under `prop`, found by its type and, given, its title. */
  const handler = (plugin: string, type: string, prop: string, title?: string) => {
    const node = Object.values(nodes[plugin] ?? {}).find((found) => found.type === type && (title === undefined || found.props.title === title))
    return (node?.props[prop] as { handler: number } | undefined)?.handler
  }
  /** Each error the user was shown, its message and its detail on one line. */
  const errors = () => sent.flatMap((message) => (message.type === "error" ? [[message.message, message.detail].filter(Boolean).join(": ")] : []))
  const ids = (found: TabLayout | undefined) => ({ sidebar: found?.sidebar?.id, panels: found?.panels.map((panel) => panel.id), cards: found?.cards.map((card) => card.id) })

  return { project, plugins, layouts, reload: ui.reload, saved, sent, threads, nodes, screen, showThread, layout, textOf, handler, errors, ids }
}
