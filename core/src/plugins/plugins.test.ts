import { expect, test } from "bun:test"
import { applyOps, panelInstanceId, type CoreMessage, type UiNode } from "@desk/protocol"
import { tempFolder, until, useTempHome } from "../test-support"
import { Plugins } from "./plugins"
import { installPlugin, turnOn } from "./test-plugins"

useTempHome()

/** Plugins whose UI ops land in `nodes`, by plugin, as the app keeps them. */
function plugins(hooks: Partial<ConstructorParameters<typeof Plugins>[0]> = {}) {
  const nodes: Record<string, Record<number, UiNode>> = {}
  const errors: string[] = []
  const found = new Plugins({
    broadcast: (message: CoreMessage) => {
      if (message.type === "error") errors.push(message.message)
      if (message.type !== "plugin.ops") return
      if (message.reset || !nodes[message.plugin]) nodes[message.plugin] = {}
      applyOps(nodes[message.plugin]!, message.ops)
    },
    openThread: () => {},
    openPanel: () => {},
    closePanel: () => {},
    ...hooks,
  })
  return { plugins: found, nodes, errors }
}

/** The text under a node, as the app would draw it. */
function textOf(nodes: Record<number, UiNode> | undefined, id: number): string {
  const node = nodes?.[id]
  return node?.text ?? (node?.children ?? []).map((child) => textOf(nodes, child)).join("")
}

const handlerOf = (nodes: Record<number, UiNode> | undefined, type: string, prop: string) =>
  (Object.values(nodes ?? {}).find((node) => node.type === type)?.props[prop] as { handler: number } | undefined)?.handler

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

/** A sidebar that marks the open item and opens it, and a panel per item. */
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
  const { plugins: found } = plugins()

  const there = await found.offers(tempFolder("there"))
  expect(there.panels.map((panel) => panel.id)).toEqual(["counter.main"])
  expect(there.sidebars).toEqual([])

  const offered = await found.offers(here)
  expect(offered.panels.map((panel) => panel.id)).toEqual(["counter.main", "inbox.item"])
  expect(offered.sidebars).toEqual([{ id: "inbox.list", title: "Inbox" }])
  expect(offered.cards).toEqual([{ id: "inbox.count", title: "Count" }])
  expect(offered.setups).toEqual([{ id: "inbox.triage", title: "Triage", sidebar: "inbox.list", panels: [], hiddenCards: ["other.card"] }])
  await expect(found.find(tempFolder("there"), "setups", "inbox.triage")).rejects.toThrow("No plugin on in this project")

  expect(await found.contributions(here)).toEqual({
    panels: [{ id: "counter.main", title: "Counter" }],
    setups: [{ id: "inbox.triage", title: "Triage" }],
    commands: [{ id: "inbox.refresh", title: "Refresh", input: "Query" }],
  })
  found.stop()
}, 20_000)

test("draws a panel as operations, runs its handlers, and passes on thread requests", async () => {
  installPlugin("counter", COUNTER)
  const threads: unknown[] = []
  const { plugins: found, nodes } = plugins({ openThread: (tabId, thread) => threads.push({ tabId, ...thread }) })
  const project = tempFolder("project")
  const view = await found.draw("tab-1", project, "panel", "counter.main")
  expect(view).toMatchObject({ id: "counter.main", title: "Counter", plugin: "counter" })
  await until(() => textOf(nodes.counter, view.root).startsWith("Count 0"))

  await found.event("counter", handlerOf(nodes.counter, "button", "onClick")!, [])
  await until(() => threads.length > 0)
  expect(threads).toEqual([{ tabId: "tab-1", key: "k1", title: "Thread 1" }])
  await until(() => textOf(nodes.counter, view.root).startsWith("Count 1"))

  // Drawing the same view again names the same tree, so an app that reloads finds it.
  expect((await found.draw("tab-1", project, "panel", "counter.main")).root).toBe(view.root)
  // Two asks at once, as two overlapping layout sends make, both get the view.
  const both = Promise.all([found.draw("tab-2", project, "panel", "counter.main"), found.draw("tab-2", project, "panel", "counter.main")])
  expect(await Promise.race([both.then(() => "drawn"), Bun.sleep(2000).then(() => "stuck")])).toBe("drawn")
  found.stop()
}, 20_000)

test("opens a panel instance per set of parameters, and tells views which ones are open", async () => {
  installPlugin("inbox", INBOX)
  const opened: unknown[] = []
  const { plugins: found, nodes } = plugins({ openPanel: (tabId, panel, params) => opened.push({ tabId, panel, params }) })
  const project = tempFolder("project")
  await found.draw("tab-1", project, "sidebar", "inbox.list")
  await until(() => Object.values(nodes.inbox ?? {}).some((node) => node.type === "item"))
  const item = () => Object.values(nodes.inbox!).find((node) => node.type === "item")!
  expect(item().props.selected).toBe(false)

  await found.event("inbox", handlerOf(nodes.inbox, "item", "onSelect")!, [])
  await until(() => opened.length > 0)
  expect(opened).toEqual([{ tabId: "tab-1", panel: "inbox.item", params: { id: 1 } }])

  const id = panelInstanceId("inbox.item", { id: 1 })
  const panel = await found.draw("tab-1", project, "panel", "inbox.item", { id: 1 })
  expect(panel).toMatchObject({ id, title: "Item 1" })
  found.layout("tab-1", [id])
  await until(() => item().props.selected === true)
  expect(textOf(nodes.inbox, panel.root)).toBe("Item 1")
  found.stop()
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
  const { plugins: found, nodes } = plugins()
  const { root } = await found.draw("tab-1", tempFolder("project"), "panel", "label.main")
  await until(() => textOf(nodes.label, root).startsWith("#1001"))
  await found.event("label", handlerOf(nodes.label, "button", "onClick")!, [])
  await until(() => textOf(nodes.label, root).startsWith("#1002"))
  expect(textOf(nodes.label, root)).toBe("#1002 · pending · sample")
  delete nodes.label
  found.resend()
  await until(() => textOf(nodes.label, root) !== "")
  expect(textOf(nodes.label, root)).toBe("#1002 · pending · sample")
  found.stop()
}, 20_000)

test("leaves out a plugin that is on but not installed, and tells the user", async () => {
  const project = tempFolder("project")
  turnOn({ projects: { [project]: ["missing"] } })
  const { plugins: found, errors } = plugins()
  expect((await found.offers(project)).panels).toEqual([])
  expect(errors[0]).toContain("found no plugin")
  await expect(found.draw("tab-1", project, "panel", "missing.main")).rejects.toThrow("found no plugin")
  found.stop()
})

test("refuses a plugin whose setup registers late", async () => {
  installPlugin("late", `
import { definePlugin } from "@desk/plugin"
export default definePlugin((desk) => { setTimeout(() => desk.panel("main", { title: "Late", view: () => null })) })
`)
  turnOn({ everywhere: ["late"] })
  const { plugins: found, errors } = plugins()
  await found.offers(tempFolder("project"))
  await until(() => errors.length > 0)
  expect(errors[0]).toContain("while setup runs")
  found.stop()
})
