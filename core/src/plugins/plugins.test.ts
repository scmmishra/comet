import { expect, test } from "bun:test"
import { panelInstanceId } from "@comet/protocol"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, until, useTempHome } from "../test-support"
import { harness, installPlugin, turnOn } from "./test-plugins"

useTempHome()

/** A panel with a counter and a button that bumps it and opens a thread. */
const COUNTER = `
import { definePlugin, Button, Stack, Text } from "@comet/plugin"
import { createSignal } from "solid-js"

export default definePlugin((comet) => {
  const [count, setCount] = createSignal(0)
  comet.panel("main", {
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
import { definePlugin, Item, List, Text } from "@comet/plugin"

export default definePlugin((comet) => {
  comet.sidebar("list", {
    title: "Inbox",
    view: (ctx) => (
      <List>
        <Item title="One" selected={ctx.isOpen("inbox.item", { id: 1 })} onSelect={() => ctx.open("inbox.item", { id: 1 })} />
      </List>
    ),
  })
  comet.panel("item", { title: (params) => "Item " + params.id, params: ["id"], view: (ctx) => <Text>Item {String(ctx.params.id)}</Text> })
  comet.card("count", { title: "Count", view: () => <Text>1 open</Text> })
  comet.setup("triage", { title: "Triage", sidebar: "inbox.list", hideCards: ["other.card"] })
  comet.command("refresh", { title: "Refresh", input: "Query", run: (ctx, input) => ctx.toast("refreshed " + input) })
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
import { definePlugin, Button, Text } from "@comet/plugin"
import { createSignal, Show } from "solid-js"

const ITEMS = [{ id: 1001, status: "open" }, { id: 1002, status: "pending" }]

export default definePlugin((comet) => {
  const [open, setOpen] = createSignal(ITEMS[0])
  comet.panel("main", {
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

test("refuses a plugin whose manifest names another plugin or needs another plugin API", async () => {
  const source = `import { definePlugin } from "@comet/plugin"\nexport default definePlugin((comet) => comet.panel("main", { title: "Main", view: () => null }))\n`
  installPlugin("renamed", source)
  installPlugin("future", source)
  installPlugin("fits", source)
  const manifest = (name: string, api: string) => JSON.stringify({ name: `comet-plugin-${name}`, comet: { name, api } })
  writeFileSync(join(process.env.COMET_HOME!, "plugins", "renamed", "package.json"), manifest("other", "*"))
  writeFileSync(join(process.env.COMET_HOME!, "plugins", "future", "package.json"), manifest("future", "^99.0.0"))
  writeFileSync(join(process.env.COMET_HOME!, "plugins", "fits", "package.json"), manifest("fits", "^0.1.0"))
  turnOn({ everywhere: ["renamed", "future", "fits"] })
  const { plugins, project, errors } = harness()
  expect((await plugins.offers(project)).panels.map((panel) => panel.id)).toEqual(["fits.main"])
  expect(errors().some((error) => error.includes("is named other, not renamed"))).toBe(true)
  expect(errors().some((error) => error.includes("needs Comet's plugin API ^99.0.0"))).toBe(true)
  plugins.stop()
}, 20_000)

test("refuses a plugin that registers late, or registers one name twice", async () => {
  installPlugin("late", `
import { definePlugin } from "@comet/plugin"
export default definePlugin((comet) => { setTimeout(() => comet.panel("main", { title: "Late", view: () => null })) })
`)
  installPlugin("twice", `
import { definePlugin, Text } from "@comet/plugin"
export default definePlugin((comet) => {
  comet.sidebar("inbox", { title: "Inbox", view: () => <Text>a</Text> })
  comet.card("inbox", { title: "Inbox", view: () => <Text>b</Text> })
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
import { definePlugin, Button } from "@comet/plugin"
export default definePlugin((comet) => {
  comet.card("status", { title: "Status", view: () => <Button label="Break" onClick={() => setTimeout(() => { throw new Error("boom") })} /> })
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

test("lists setups across projects, the active project's first, and a setup on everywhere once", async () => {
  installPlugin("inbox", INBOX)
  installPlugin("comet", `
import { definePlugin } from "@comet/plugin"
export default definePlugin((comet) => { comet.setup("focus", { title: "Focus" }) })
`)
  const here = tempFolder("here")
  const there = tempFolder("there")
  turnOn({ everywhere: ["comet"], projects: { [here]: ["inbox"], [join(there, "missing")]: ["inbox"] } })
  const { plugins } = harness()
  expect(await plugins.setups(there)).toEqual([
    { project: there, id: "comet.focus", title: "Focus" },
    { project: here, id: "inbox.triage", title: "Triage" },
  ])
  plugins.stop()
}, 20_000)

/** A plugin that toasts each turn end it hears of, and one whose handler throws. */
const LISTENER = `
import { definePlugin } from "@comet/plugin"

export default definePlugin((comet) => {
  comet.onTurnEnd((turn) => comet.toast(turn.tabId + " " + turn.key + " " + turn.outcome))
  comet.onTurnEnd(() => { throw new Error("handler failed") })
  comet.command("late", { title: "Late", run: () => comet.onTurnEnd(() => {}) })
})
`

test("tells a plugin when a turn ends in a thread it opened, under its own key, and no other plugin", async () => {
  installPlugin("listener", LISTENER)
  installPlugin("counter", COUNTER)
  turnOn({ everywhere: ["listener", "counter"] })
  const { plugins, project, sent, errors } = harness()
  await plugins.offers(project)
  const notices = () => sent.flatMap((message) => (message.type === "notice" ? [message.message] : []))

  plugins.turnEnded("tab-1", "listener.cw-conv-7", "interrupted")
  plugins.turnEnded("tab-1", "counter.k1", "done")
  plugins.turnEnded("tab-1", "missing.k1", "done")
  await until(() => notices().length > 0 && errors().length > 0)
  expect(notices()).toEqual(["tab-1 cw-conv-7 interrupted"])
  expect(errors()).toEqual(["Something in the listener plugin failed: handler failed"])

  await plugins.command("tab-1", project, "listener.late")
  await until(() => errors().length > 1)
  expect(errors().at(-1)).toContain("registers onTurnEnd while setup runs")
  plugins.stop()
}, 20_000)

/** A card that draws a variable from its environment. */
const ENVIRONMENT = `
import { definePlugin, Text } from "@comet/plugin"

export default definePlugin((comet) => {
  comet.card("env", { title: "Env", view: () => <Text>{process.env.COMET_TEST_TOOL ?? "missing"}</Text> })
})
`

test("starts a plugin with the environment the core set, such as the login shell's PATH", async () => {
  // The core sets the login shell's variables after it starts, as this test does.
  process.env.COMET_TEST_TOOL = "found"
  installPlugin("environment", ENVIRONMENT)
  turnOn({ everywhere: ["environment"] })
  const { plugins, layouts, layout, textOf } = harness()
  await layouts.send("tab-1")
  const shown = () => {
    const card = layout("tab-1")?.cards[0]
    return card ? textOf("environment", card.root) : ""
  }
  await until(() => shown() !== "")
  expect(shown()).toBe("found")
  delete process.env.COMET_TEST_TOOL
  plugins.stop()
}, 20_000)

test("a reload starts each plugin again from its files, and gives one that failed another try", async () => {
  const card = (words: string) => `
import { definePlugin, Text } from "@comet/plugin"
export default definePlugin((comet) => {
  comet.card("status", { title: "Status", view: () => <Text>${words}</Text> })
})
`
  installPlugin("edited", card("Before"))
  installPlugin("broken", `export default 42`)
  turnOn({ everywhere: ["edited", "broken"] })
  const { plugins, reload, layouts, layout, nodes, textOf, errors } = harness()
  await layouts.send("tab-1")
  const drawn = () => layout("tab-1")!.cards.map((found) => textOf(found.plugin, found.root))
  await until(() => drawn().join() === "Before")
  expect(errors().filter((error) => error.includes("broken plugin could not start"))).toHaveLength(1)

  installPlugin("edited", card("After"))
  installPlugin("broken", card("Fixed"))
  await reload()
  await until(() => drawn().join() === "After,Fixed")
  // The app's copy holds the new worker's nodes only: a card and its text.
  expect(Object.keys(nodes.edited!)).toHaveLength(3)
  plugins.stop()
}, 20_000)

test("a setup that names a view without its plugin stops the plugin, and says why", async () => {
  installPlugin("loose", `
import { definePlugin, Text } from "@comet/plugin"
export default definePlugin((comet) => {
  comet.sidebar("notes", { title: "Notes", view: () => <Text>Notes</Text> })
  comet.setup("comet", { title: "Comet", sidebar: "notes" })
})
`)
  turnOn({ everywhere: ["loose"] })
  const { plugins, project, errors } = harness()
  expect(await plugins.setups(project)).toEqual([])
  await until(() => errors().some((error) => error.includes("loose plugin could not start")))
  expect(errors().find((error) => error.includes("loose plugin"))).toContain("Plugin views are named <plugin>.<name>, not notes.")
  plugins.stop()
}, 20_000)
