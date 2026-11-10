import { expect, test } from "bun:test"
import { applyOps, panelInstanceId, type CoreMessage, type TabLayout, type UiNode } from "@desk/protocol"
import type { PluginLayout } from "@desk/plugin/host"
import { tempFolder, until, useTempHome } from "../test-support"
import { Layouts } from "./layouts"
import { Plugins } from "./plugins"
import { installPlugin, turnOn } from "./test-plugins"

useTempHome()

const SUPPORT = `
import { definePlugin, Item, List, Text } from "@desk/plugin"

export default definePlugin((desk) => {
  desk.sidebar("inbox", { title: "Inbox", view: (ctx) => <List><Item title="One" onSelect={() => ctx.open("support.conversation", { id: 1 })} /></List> })
  desk.panel("conversation", { title: (params) => "#" + params.id, params: ["id"], single: true, view: (ctx) => <Text>{String(ctx.params.id)}<Item title="Close" onSelect={() => ctx.close()} /></Text> })
  desk.panel("notes", { title: "Notes", view: () => <Text>notes</Text> })
  desk.card("status", { title: "Status", view: () => <Text>ok</Text> })
  desk.card("empty", { title: "Empty", view: () => null })
  desk.command("open", { title: "Open conversation…", input: "Conversation id", run: (ctx, input) => ctx.open("support.conversation", { id: Number(input) }) })
  desk.setup("support", { title: "Support", sidebar: "support.inbox", panels: ["support.notes", "elsewhere.panel"], hideCards: ["support.empty"] })
})
`

/** Layouts over one saved tab, with every message the core would send. */
function setup() {
  installPlugin("support", SUPPORT)
  const project = tempFolder("project")
  turnOn({ projects: { [project]: ["support"] } })
  const saved: Record<string, PluginLayout> = {}
  const sent: CoreMessage[] = []
  let layouts!: Layouts
  const plugins = new Plugins({
    broadcast: (message) => sent.push(message),
    openThread: () => {},
    openPanel: (tabId, panel, params) => void layouts.openPanel(tabId, panel, params),
    closePanel: (tabId, id) => void layouts.closePanel(tabId, id),
  })
  layouts = new Layouts(
    plugins,
    {
      projectOf: () => project,
      layout: (tabId) => saved[tabId],
      setLayout: (tabId, layout) => (saved[tabId] = layout),
    },
    (message) => sent.push(message),
  )
  const last = () => sent.findLast((message): message is Extract<CoreMessage, { type: "layout" }> => message.type === "layout")?.layout
  return { plugins, layouts, saved, sent, last, project }
}

const ids = (layout: TabLayout | undefined) => ({ sidebar: layout?.sidebar?.id, panels: layout?.panels.map((panel) => panel.id), cards: layout?.cards.map((card) => card.id) })

test("a setup lays out the tab with what is on, and leaves out what is not", async () => {
  const { plugins, layouts, saved, last } = setup()
  await layouts.openSetup("tab-1", "support.support")
  expect(saved["tab-1"]).toEqual({ sidebar: "support.inbox", panels: [{ panel: "support.notes", params: {} }, { panel: "elsewhere.panel", params: {} }], hiddenCards: ["support.empty"] })
  expect(ids(last())).toEqual({ sidebar: "support.inbox", panels: ["support.notes"], cards: ["support.status"] })
  plugins.stop()
}, 20_000)

test("opens a panel instance once, shows it, and closes it from the panel", async () => {
  const { plugins, layouts, saved, sent, last } = setup()
  const id = panelInstanceId("support.conversation", { id: 1 })
  await layouts.openPanel("tab-1", "support.conversation", { id: 1 })
  await layouts.openPanel("tab-1", "support.conversation", { id: 1 })
  expect(saved["tab-1"]?.panels).toEqual([{ panel: "support.conversation", params: { id: 1 } }])
  expect(last()?.panels).toEqual([expect.objectContaining({ id, title: "#1", plugin: "support" })])
  expect(sent.filter((message) => message.type === "panel.show")).toEqual([
    { type: "panel.show", tabId: "tab-1", id },
    { type: "panel.show", tabId: "tab-1", id },
  ])

  await layouts.closePanel("tab-1", id)
  expect(saved["tab-1"]?.panels).toEqual([])
  expect(last()?.panels).toEqual([])
  plugins.stop()
}, 20_000)

test("refuses a panel or command that is not on, and a panel that lacks its parameters", async () => {
  const { plugins, layouts, project } = setup()
  await expect(layouts.openPanel("tab-1", "other.panel")).rejects.toThrow("No plugin on in this project")
  await expect(layouts.openPanel("tab-1", "support.conversation")).rejects.toThrow("needs id")
  await expect(plugins.command("tab-1", project, "support.missing")).rejects.toThrow("No plugin on in this project")
  plugins.stop()
}, 20_000)

test("a view opens and closes panels through the core", async () => {
  const { plugins, layouts, saved, sent } = setup()
  await layouts.openSetup("tab-1", "support.support")
  // The app's copy of the plugin's nodes, built from every batch so far.
  const handler = (title: string) => {
    const nodes: Record<number, UiNode> = {}
    for (const message of sent) if (message.type === "plugin.ops") applyOps(nodes, message.ops)
    const item = Object.values(nodes).find((node) => node.type === "item" && node.props.title === title)
    return (item?.props.onSelect as { handler: number } | undefined)?.handler
  }
  await plugins.event("support", handler("One")!, [])
  await until(() => saved["tab-1"]!.panels.some((open) => open.panel === "support.conversation"))
  await until(() => handler("Close") !== undefined)
  await plugins.event("support", handler("Close")!, [])
  await until(() => !saved["tab-1"]!.panels.some((open) => open.panel === "support.conversation"))
  expect(saved["tab-1"]!.panels).toEqual([{ panel: "support.notes", params: {} }, { panel: "elsewhere.panel", params: {} }])
  plugins.stop()
}, 20_000)

test("a command with input opens the panel it names", async () => {
  const { plugins, saved, sent, project } = setup()
  await plugins.command("tab-1", project, "support.open", "7")
  const id = panelInstanceId("support.conversation", { id: 7 })
  await until(() => sent.some((message) => message.type === "panel.show" && message.id === id))
  expect(saved["tab-1"]?.panels).toEqual([{ panel: "support.conversation", params: { id: 7 } }])
  plugins.stop()
}, 20_000)

test("a single panel replaces its open instance in place, and other panels keep theirs", async () => {
  const { plugins, layouts, saved, last } = setup()
  await layouts.openPanel("tab-1", "support.notes")
  await layouts.openPanel("tab-1", "support.conversation", { id: 1 })
  await layouts.openPanel("tab-1", "support.conversation", { id: 2 })
  expect(saved["tab-1"]?.panels).toEqual([{ panel: "support.notes", params: {} }, { panel: "support.conversation", params: { id: 2 } }])
  expect(last()?.panels.map((panel) => panel.title)).toEqual(["Notes", "#2"])
  plugins.stop()
}, 20_000)
