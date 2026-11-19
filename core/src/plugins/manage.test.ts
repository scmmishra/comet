import { expect, test } from "bun:test"
import type { CoreMessage } from "@comet/protocol"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "../test-support"
import { pluginManager } from "./manage"

useTempHome()

test("tells every client what changed, or why it failed, and then sends the plugins whole", async () => {
  const source = join(tempFolder("source"), "demo")
  mkdirSync(source)
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "comet-plugin-demo", version: "1.0.0", comet: { name: "demo", title: "Demo", api: "^0.1.0" } }))
  writeFileSync(join(source, "index.tsx"), "export default 1\n")
  const sent: CoreMessage[] = []
  const manager = pluginManager((message) => sent.push(message))

  await manager.add(source)
  await manager.toggle("demo", true)
  await manager.remove("nothing")
  expect(sent).toEqual([
    { type: "notice", message: "Installed demo." },
    { type: "plugins", plugins: [{ name: "demo", kind: "installed", source, title: "Demo", version: "1.0.0", everywhere: false, projects: [] }] },
    { type: "notice", message: "demo is on everywhere." },
    { type: "plugins", plugins: [{ name: "demo", kind: "installed", source, title: "Demo", version: "1.0.0", everywhere: true, projects: [] }] },
    { type: "error", message: "Comet could not remove nothing", detail: expect.stringContaining("No plugin named nothing") },
    { type: "plugins", plugins: [expect.objectContaining({ name: "demo" })] },
  ])
}, 60_000)
