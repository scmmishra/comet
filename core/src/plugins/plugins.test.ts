import { expect, test } from "bun:test"
import type { CoreMessage, UiOp } from "@desk/protocol"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, until, useTempHome } from "../test-support"
import { Plugins } from "./plugins"

useTempHome()

/** A plugin with a counter, a button that bumps it and opens a thread, and a list driven by state. */
const COUNTER = `
import { definePlugin, Button, Item, List, Stack, Text } from "@desk/plugin"
import { createSignal, For } from "solid-js"

export default definePlugin((desk) => {
  const [count, setCount] = createSignal(0)
  return {
    panels: {
      main: () => (
        <Stack>
          <Text>Count {count()}</Text>
          <Button label="Bump" onClick={() => { setCount(count() + 1); desk.openThread({ key: "k" + count(), title: "Thread " + count() }) }} />
          <List><For each={Array.from({ length: count() }, (_, i) => String(i))}>{(id) => <Item title={id} />}</For></List>
        </Stack>
      ),
    },
  }
})
`

test("draws a plugin's panel as operations, runs its handlers, and passes on thread requests", async () => {
  mkdirSync(join(process.env.DESK_HOME!, "plugins", "counter"), { recursive: true })
  writeFileSync(join(process.env.DESK_HOME!, "plugins", "counter", "index.tsx"), COUNTER)
  const ops: UiOp[] = []
  const threads: unknown[] = []
  const plugins = new Plugins({
    broadcast: (message: CoreMessage) => message.type === "plugin.ops" && ops.push(...message.ops),
    openThread: (tabId, thread) => threads.push({ tabId, ...thread }),
  })
  const { plugin, root } = await plugins.open("tab-1", tempFolder("project"), "counter.main")
  expect(plugin).toBe("counter")
  await until(() => ops.some((op) => op.op === "insert" && op.parent === root))

  const button = ops.find((op): op is Extract<UiOp, { op: "set" }> => op.op === "set" && op.key === "onClick")!
  const handler = (button.value as { handler: number }).handler
  await plugins.event("counter", handler, [])
  await until(() => threads.length > 0)
  await until(() => ops.some((op) => op.op === "text" && op.text === "1"))
  expect(threads).toEqual([{ tabId: "tab-1", key: "k1", title: "Thread 1" }])
  expect(ops.filter((op) => op.op === "create" && op.type === "item")).toHaveLength(1)

  // Opening the same panel again names the same tree, so an app that reloads finds it.
  expect((await plugins.open("tab-1", tempFolder("project"), "counter.main")).root).toBe(root)
  plugins.stop()
}, 20_000)

test("refuses a panel of a plugin that is not installed", async () => {
  const plugins = new Plugins({ broadcast: () => {}, openThread: () => {} })
  await expect(plugins.open("tab-1", tempFolder("project"), "missing.main")).rejects.toThrow("found no plugin")
  plugins.stop()
})
