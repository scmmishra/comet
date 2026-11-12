import { expect, test } from "bun:test"
import { rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useTempHome } from "../test-support"
import { bundlePlugin } from "./bundle"
import { installPlugin } from "./test-plugins"

useTempHome()

const plugin = (text: string) => `
import { definePlugin, Text } from "@desk/plugin"
export default definePlugin((desk) => desk.card("note", { title: "Note", view: () => <Text>${text}</Text> }))
`

test("builds a plugin once, and again only when one of its files changes or its bundle is gone", async () => {
  installPlugin("note", plugin("first"))
  const entry = join(process.env.DESK_HOME!, "plugins", "note", "index.tsx")
  const bundle = await bundlePlugin("note", entry)
  expect(await Bun.file(bundle).text()).toContain("first")
  const built = statSync(bundle).mtimeMs

  expect(await bundlePlugin("note", entry)).toBe(bundle)
  expect(statSync(bundle).mtimeMs).toBe(built)

  writeFileSync(entry, plugin("second"))
  // An edit within the same millisecond would keep the file's time, so the test moves it on.
  utimesSync(entry, new Date(), new Date(Date.now() + 1000))
  await bundlePlugin("note", entry)
  expect(await Bun.file(bundle).text()).toContain("second")

  rmSync(bundle)
  await bundlePlugin("note", entry)
  expect(await Bun.file(bundle).text()).toContain("second")
})
