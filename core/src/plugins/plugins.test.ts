import { expect, test } from "bun:test"
import { panelInstanceId } from "@desk/protocol"
import { tempFolder, until, useTempHome } from "../test-support"
import { harness, installPlugin, turnOn } from "./test-plugins"

useTempHome()

/** A panel with a counter and a button that bumps it and opens a thread. */
const COUNTER = `
import { definePlugin, Button, Stack, Text } from "@desk/plugin"
import { createSignal } from "solid-js"

export default definePlugin((desk) => {
  const [count, setCount] = createSignal(0)
  desk.panel("main", {
    title: "Counter",
    view: (ctx) => (
      <Stack>
        <Text>Count {count()}</Text>
        <Button label="Bump" onClick={() => { setCount(count() + 1); ctx.openThread({ key: "k" + count(), title: "Thread " + count() }) }} />
      </Stack>
    ),
  })
})
`

/** A sidebar that marks the open item and opens it, a panel per item, a card, a setup and a command. */
const INBOX = `
import { definePlugin, Item, List, Text } from "@desk/plugin"

export default definePlugin((desk) => {
  desk.sidebar("list", {
    title: "Inbox",
    view: (ctx) => (
      <List>
        <Item title="One" selected={ctx.isOpen("inbox.item", { id: 1 })} onSelect={() => ctx.open("inbox.item", { id: 1 })} />
      </List>
    ),
  })
  desk.panel("item", { title: (params) => "Item " + params.id, params: ["id"], view: (ctx) => <Text>Item {String(ctx.params.id)}</Text> })
  desk.card("count", { title: "Count", view: () => <Text>1 open</Text> })
  desk.setup("triage", { title: "Triage", sidebar: "inbox.list", hideCards: ["other.card"] })
  desk.command("refresh", { title: "Refresh", input: "Query", run: (ctx, input) => ctx.toast("refreshed " + input) })
})
`

test("offers only the plugins on in a project, and lets the palette start what needs no parameters", async () => {
  installPlugin("counter", COUNTER)
  installPlugin("inbox", INBOX)
  const here = tempFolder("here")
  turnOn({ everywhere: ["counter"], projects: { [here]: ["inbox"] } })
  const { plugins } = harness()

  const there = await plugins.offers(tempFolder("there"))
  expect(there.panels.map((panel) => panel.id)).toEqual(["counter.main"])
  expect(there.sidebars).toEqual([])

  const offered = await plugins.offers(here)
  expect(offered.panels.map((panel) => panel.id)).toEqual(["counter.main", "inbox.item"])
  expect(offered.sidebars).toEqual([{ id: "inbox.list", title: "Inbox" }])
  expect(offered.cards).toEqual([{ id: "inbox.count", title: "Count" }])
  expect(offered.setups).toEqual([{ id: "inbox.triage", title: "Triage", sidebar: "inbox.list", panels: [], hiddenCards: ["other.card"] }])
  await expect(plugins.find(tempFolder("there"), "setups", "inbox.triage")).rejects.toThrow("No plugin on in this project")

  expect(await plugins.contributions(here)).toEqual({
    panels: [{ id: "counter.main", title: "Counter" }],
    setups: [{ id: "inbox.triage", title: "Triage" }],
    commands: [{ id: "inbox.refresh", title: "Refresh", input: "Query" }],
  })
  plugins.stop()
}, 20_000)

test("draws a panel as operations, runs its handlers, and opens threads under keys the plugin owns", async () => {
  installPlugin("counter", COUNTER)
  turnOn({ everywhere: ["counter"] })
  const { plugins, layouts, layout, textOf, handler, threads } = harness()
  await layouts.openPanel("tab-1", "counter.main")
  const view = layout("tab-1")!.panels[0]!
  expect(view).toMatchObject({ id: "counter.main", title: "Counter", plugin: "counter" })
  await until(() => textOf("counter", view.root).startsWith("Count 0"))

  await plugins.event("counter", handler("counter", "button", "onClick")!, [])
  await until(() => threads.length > 0)
  expect(threads).toEqual([{ tabId: "tab-1", key: "counter.k1", title: "Thread 1" }])
  await until(() => textOf("counter", view.root).startsWith("Count 1"))

  // Laying the tab out again keeps the same tree, so the app's copy stays valid.
  await layouts.send("tab-1")
  expect(layout("tab-1")!.panels[0]!.root).toBe(view.root)
  plugins.stop()
}, 20_000)

test("opens a panel instance per set of parameters, and tells views which ones are open", async () => {
  installPlugin("inbox", INBOX)
  turnOn({ everywhere: ["inbox"] })
  const { plugins, layouts, layout, nodes, handler, textOf } = harness()
  await layouts.openSetup("tab-1", "inbox.triage")
  const item = () => Object.values(nodes.inbox!).find((node) => node.type === "item")!
  await until(() => !!nodes.inbox && Object.values(nodes.inbox).some((node) => node.type === "item"))
  expect(item().props.selected).toBe(false)

  await plugins.event("inbox", handler("inbox", "item", "onSelect")!, [])
  const id = panelInstanceId("inbox.item", { id: 1 })
  await until(() => layout("tab-1")?.panels.some((panel) => panel.id === id) ?? false)
  await until(() => item().props.selected === true)
  const panel = layout("tab-1")!.panels.find((found) => found.id === id)!
  expect(panel.title).toBe("Item 1")
  expect(textOf("inbox", panel.root)).toBe("Item 1")
  plugins.stop()
}, 20_000)

/** A plugin that shows the open item's id and status in one text, switched by a button, as the support sample does. */
const LABEL = `
import { definePlugin, Button, Text } from "@desk/plugin"
import { createSignal, Show } from "solid-js"

const ITEMS = [{ id: 1001, status: "open" }, { id: 1002, status: "pending" }]

export default definePlugin((desk) => {
  const [open, setOpen] = createSignal(ITEMS[0])
  desk.panel("main", {
    title: "Label",
    view: () => (
      <Show when={open()}>
        {(item) => <Text>#{item().id} · {item().status} · sample<Button label="Next" onClick={() => setOpen(ITEMS[1])} /></Text>}
      </Show>
    ),
  })
})
`

test("keeps text in order when the values inside it change, in the app's copy and in a later resend", async () => {
  installPlugin("label", LABEL)
  turnOn({ everywhere: ["label"] })
  const { plugins, layouts, layout, nodes, textOf, handler } = harness()
  await layouts.openPanel("tab-1", "label.main")
  const { root } = layout("tab-1")!.panels[0]!
  await until(() => textOf("label", root).startsWith("#1001"))
  await plugins.event("label", handler("label", "button", "onClick")!, [])
  await until(() => textOf("label", root).startsWith("#1002"))
  expect(textOf("label", root)).toBe("#1002 · pending · sample")
  delete nodes.label
  plugins.resend()
  await until(() => textOf("label", root) !== "")
  expect(textOf("label", root)).toBe("#1002 · pending · sample")
  plugins.stop()
}, 20_000)

test("a plugin that is on but not installed is left out, reported once, and named as the cause", async () => {
  turnOn({ everywhere: ["missing"] })
  const { plugins, project, errors } = harness()
  expect((await plugins.offers(project)).panels).toEqual([])
  await plugins.offers(project)
  expect(errors().filter((error) => error.includes("found no plugin"))).toHaveLength(1)
  await expect(plugins.find(project, "panels", "missing.main")).rejects.toThrow("found no plugin")
  plugins.stop()
})

test("refuses a plugin that registers late, or registers one name twice", async () => {
  installPlugin("late", `
import { definePlugin } from "@desk/plugin"
export default definePlugin((desk) => { setTimeout(() => desk.panel("main", { title: "Late", view: () => null })) })
`)
  installPlugin("twice", `
import { definePlugin, Text } from "@desk/plugin"
export default definePlugin((desk) => {
  desk.sidebar("inbox", { title: "Inbox", view: () => <Text>a</Text> })
  desk.card("inbox", { title: "Inbox", view: () => <Text>b</Text> })
})
`)
  turnOn({ everywhere: ["late", "twice"] })
  const { plugins, project, errors } = harness()
  await plugins.offers(project)
  await until(() => errors().length >= 2)
  expect(errors().some((error) => error.includes("while setup runs"))).toBe(true)
  expect(errors().some((error) => error.includes("two things named inbox"))).toBe(true)
  plugins.stop()
}, 20_000)

test("a plugin that stops loses its views in every tab, is reported once, and stays off", async () => {
  installPlugin("crash", `
import { definePlugin, Button } from "@desk/plugin"
export default definePlugin((desk) => {
  desk.card("status", { title: "Status", view: () => <Button label="Break" onClick={() => setTimeout(() => { throw new Error("boom") })} /> })
})
`)
  turnOn({ everywhere: ["crash"] })
  const { plugins, layouts, layout, nodes, handler, errors } = harness()
  await layouts.send("tab-1")
  await layouts.send("tab-2")
  expect(layout("tab-1")!.cards.map((card) => card.id)).toEqual(["crash.status"])
  await until(() => handler("crash", "button", "onClick") !== undefined)

  await plugins.event("crash", handler("crash", "button", "onClick")!, [])
  await until(() => layout("tab-1")!.cards.length === 0 && layout("tab-2")!.cards.length === 0)
  expect(Object.keys(nodes.crash ?? {})).toEqual([])
  expect(errors().filter((error) => error.includes("crash plugin stopped"))).toHaveLength(1)
  await layouts.send("tab-1")
  expect(layout("tab-1")!.cards).toEqual([])
  plugins.stop()
}, 20_000)
