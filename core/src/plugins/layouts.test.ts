import { expect, test } from "bun:test"
import { panelInstanceId, type TabInfo } from "@desk/protocol"
import { until, useTempHome } from "../test-support"
import { harness, installPlugin, turnOn } from "./test-plugins"

useTempHome()

const SUPPORT = `
import { definePlugin, Item, List, Text } from "@desk/plugin"

export default definePlugin((desk) => {
  desk.sidebar("inbox", { title: "Inbox", view: (ctx) => <List><Item title="One" onSelect={() => ctx.open("support.conversation", { id: 1 })} /></List> })
  desk.panel("conversation", { title: (params) => "#" + params.id, params: ["id"], single: true, view: (ctx) => <Text>{String(ctx.params.id)}<Item title="Close" onSelect={() => ctx.close()} /></Text> })
  desk.panel("notes", { title: "Notes", view: () => <Text>notes</Text> })
  desk.panel("broken", { title: "Broken", view: () => { throw new Error("no data") } })
  desk.card("status", { title: "Status", view: () => <Text>ok</Text> })
  desk.card("empty", { title: "Empty", view: () => null })
  desk.card("faulty", { title: "Faulty", view: () => { throw new Error("card failed") } })
  desk.command("open", { title: "Open conversation…", input: "Conversation id", run: (ctx, input) => ctx.open("support.conversation", { id: Number(input) }) })
  desk.setup("support", { title: "Support", sidebar: "support.inbox", panels: ["support.notes", "elsewhere.panel"], hideCards: ["support.empty", "support.faulty"] })
})
`

/** A harness with the support plugin on everywhere. */
function support() {
  installPlugin("support", SUPPORT)
  turnOn({ everywhere: ["support"] })
  return harness()
}

test("a setup lays out the tab with what is on, and leaves out what is not", async () => {
  const { plugins, layouts, saved, layout, ids } = support()
  await layouts.openSetup("tab-1", "support.support")
  expect(saved["tab-1"]).toEqual({ sidebar: "support.inbox", panels: [{ panel: "support.notes", params: {} }, { panel: "elsewhere.panel", params: {} }], hiddenCards: ["support.empty", "support.faulty"] })
  expect(ids(layout("tab-1"))).toEqual({ sidebar: "support.inbox", panels: ["support.notes"], cards: ["support.status"] })
  plugins.stop()
}, 20_000)

test("opens a panel instance once, shows it, and closes it", async () => {
  const { plugins, layouts, saved, sent, layout } = support()
  const id = panelInstanceId("support.conversation", { id: 1 })
  await layouts.openPanel("tab-1", "support.conversation", { id: 1 })
  await layouts.openPanel("tab-1", "support.conversation", { id: 1 })
  expect(saved["tab-1"]?.panels).toEqual([{ panel: "support.conversation", params: { id: 1 } }])
  expect(layout("tab-1")?.panels).toEqual([expect.objectContaining({ id, title: "#1", plugin: "support" })])
  expect(sent.filter((message) => message.type === "panel.show")).toHaveLength(2)

  await layouts.closePanel("tab-1", id)
  expect(saved["tab-1"]?.panels).toEqual([])
  expect(layout("tab-1")?.panels).toEqual([])
  plugins.stop()
}, 20_000)

test("refuses a panel or command that is not on, and a panel that lacks its parameters", async () => {
  const { plugins, layouts, project } = support()
  await expect(layouts.openPanel("tab-1", "other.panel")).rejects.toThrow("No plugin on in this project")
  await expect(layouts.openPanel("tab-1", "support.conversation")).rejects.toThrow("needs id")
  await expect(plugins.command("tab-1", project, "support.missing")).rejects.toThrow("No plugin on in this project")
  plugins.stop()
}, 20_000)

test("a view opens and closes panels through the core", async () => {
  const { plugins, layouts, saved, handler } = support()
  await layouts.openSetup("tab-1", "support.support")
  await until(() => handler("support", "item", "onSelect", "One") !== undefined)
  await plugins.event("support", handler("support", "item", "onSelect", "One")!, [])
  await until(() => saved["tab-1"]!.panels.some((open) => open.panel === "support.conversation"))
  await until(() => handler("support", "item", "onSelect", "Close") !== undefined)
  await plugins.event("support", handler("support", "item", "onSelect", "Close")!, [])
  await until(() => !saved["tab-1"]!.panels.some((open) => open.panel === "support.conversation"))
  expect(saved["tab-1"]!.panels).toEqual([{ panel: "support.notes", params: {} }, { panel: "elsewhere.panel", params: {} }])
  plugins.stop()
}, 20_000)

test("a command with input opens the panel it names", async () => {
  const { plugins, project, saved, sent } = support()
  await plugins.command("tab-1", project, "support.open", "7")
  const id = panelInstanceId("support.conversation", { id: 7 })
  await until(() => sent.some((message) => message.type === "panel.show" && message.id === id))
  expect(saved["tab-1"]?.panels).toEqual([{ panel: "support.conversation", params: { id: 7 } }])
  plugins.stop()
}, 20_000)

test("a single panel replaces its open instance in place, and other panels keep theirs", async () => {
  const { plugins, layouts, saved, layout } = support()
  await layouts.openPanel("tab-1", "support.notes")
  await layouts.openPanel("tab-1", "support.conversation", { id: 1 })
  await layouts.openPanel("tab-1", "support.conversation", { id: 2 })
  expect(saved["tab-1"]?.panels).toEqual([{ panel: "support.notes", params: {} }, { panel: "support.conversation", params: { id: 2 } }])
  expect(layout("tab-1")?.panels.map((panel) => panel.title)).toEqual(["Notes", "#2"])
  plugins.stop()
}, 20_000)

test("a panel that cannot be drawn is closed, and a card that cannot is left out, each reported once", async () => {
  const { plugins, layouts, saved, layout, errors, ids } = support()
  await layouts.openPanel("tab-1", "support.notes")
  await layouts.openPanel("tab-1", "support.broken")
  expect(saved["tab-1"]?.panels).toEqual([{ panel: "support.notes", params: {} }])
  expect(ids(layout("tab-1"))).toEqual({ sidebar: undefined, panels: ["support.notes"], cards: ["support.status", "support.empty"] })
  await layouts.send("tab-1")
  expect(errors().filter((error) => error.includes("support.broken"))).toHaveLength(1)
  expect(errors().filter((error) => error.includes("support.faulty"))).toHaveLength(1)
  plugins.stop()
}, 20_000)

/** A sidebar, two panels and a card that each draw whether they are on screen. */
const WATCHER = `
import { definePlugin, Text } from "@desk/plugin"

export default definePlugin((desk) => {
  const seen = (name, ctx) => <Text>{name} {ctx.visible() ? "on" : "off"}</Text>
  desk.sidebar("side", { title: "Side", view: (ctx) => seen("side", ctx) })
  desk.panel("one", { title: "One", view: (ctx) => seen("one", ctx) })
  desk.panel("two", { title: "Two", view: (ctx) => seen("two", ctx) })
  desk.card("card", { title: "Card", view: (ctx) => seen("card", ctx) })
  desk.setup("watch", { title: "Watch", sidebar: "watcher.side", panels: ["watcher.one", "watcher.two"] })
})
`

test("tells views whether they are on screen, as the active tab, its view pane and the window's focus change", async () => {
  installPlugin("watcher", WATCHER)
  turnOn({ everywhere: ["watcher"] })
  const { plugins, layouts, layout, textOf, screen } = harness()
  const tab = (id: string, panelActive?: string, panelOpen?: boolean): TabInfo => ({ id, title: id, project: "/p", terminals: [], model: "default", permissionMode: "default", ...(panelActive ? { panelActive } : {}), ...(panelOpen !== undefined ? { panelOpen } : {}) })
  await layouts.openSetup("tab-1", "watcher.watch")
  const shown = () => {
    const found = layout("tab-1")!
    return [found.sidebar!, ...found.panels, ...found.cards].map((view) => textOf("watcher", view.root)).join(", ")
  }
  const settle = (expected: string) => until(() => shown() === expected).then(() => expect(shown()).toBe(expected))

  await settle("side off, one off, two off, card off")
  screen.active = tab("tab-1", "watcher.two", true)
  layouts.sendVisible()
  await settle("side on, one off, two on, card on")

  screen.active = tab("tab-1", "watcher.two", false)
  layouts.sendVisible()
  await settle("side on, one off, two off, card on")

  screen.active = tab("tab-1", "watcher.one", true)
  layouts.sendVisible()
  layouts.windowFocus(false)
  await settle("side off, one off, two off, card off")
  layouts.windowFocus(true)
  await settle("side on, one on, two off, card on")

  screen.active = tab("tab-2")
  layouts.sendVisible()
  await settle("side off, one off, two off, card off")
  plugins.stop()
}, 20_000)

/** A card that draws the key of its plugin's thread the tab shows. */
const FOLLOWER = `
import { definePlugin, Text } from "@desk/plugin"

export default definePlugin((desk) => {
  desk.card("thread", { title: "Thread", view: (ctx) => <Text>{ctx.thread() ?? "none"}</Text> })
})
`

test("tells a card which of its plugin's threads the tab shows, from its first draw and as the tab moves", async () => {
  installPlugin("follower", FOLLOWER)
  turnOn({ everywhere: ["follower"] })
  const { plugins, layouts, layout, textOf, showThread } = harness()
  showThread("tab-1", "follower.conv-1")
  await layouts.send("tab-1")
  const shown = () => textOf("follower", layout("tab-1")!.cards[0]!.root)
  const settle = (expected: string) => until(() => shown() === expected).then(() => expect(shown()).toBe(expected))

  await settle("conv-1")
  showThread("tab-1", "follower.conv-2")
  await settle("conv-2")
  showThread("tab-1", "other.conv-3")
  await settle("none")
  showThread("tab-1", undefined)
  showThread("tab-1", "follower.conv-1")
  await settle("conv-1")
  plugins.stop()
}, 20_000)
