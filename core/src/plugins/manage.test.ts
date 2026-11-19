import { beforeEach, expect, test } from "bun:test"
import type { CoreMessage } from "@comet/protocol"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, until, useTempHome } from "../test-support"
import { pluginManager } from "./manage"

// Each test gets a home of its own, so one that fails leaves nothing installed for the next.
beforeEach(() => useTempHome())

test("tells every client what changed, or why it failed, and then sends the plugins whole", async () => {
  const source = join(realpathSync(tempFolder("source")), "demo")
  mkdirSync(source)
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "comet-plugin-demo", version: "1.0.0", comet: { name: "demo", title: "Demo", api: "^0.2.0" } }))
  writeFileSync(join(source, "index.tsx"), "export default 1\n")
  const sent: CoreMessage[] = []
  const manager = pluginManager((message) => sent.push(message))

  await manager.add(source)
  await manager.toggle("demo", true)
  await manager.remove("nothing")
  await manager.toggle("demo", true, "/no/such/folder")
  await manager.add("--global")
  expect(sent).toEqual([
    { type: "notice", message: "Installed demo." },
    { type: "plugins", plugins: [{ name: "demo", kind: "installed", source, title: "Demo", version: "1.0.0", everywhere: false, projects: [], settings: [], values: {}, missing: [] }] },
    { type: "notice", message: "demo is on everywhere." },
    { type: "plugins", plugins: [{ name: "demo", kind: "installed", source, title: "Demo", version: "1.0.0", everywhere: true, projects: [], settings: [], values: {}, missing: [] }] },
    { type: "error", message: "Comet could not remove nothing", detail: expect.stringContaining("No plugin named nothing") },
    { type: "plugins", plugins: [expect.objectContaining({ name: "demo" })] },
    { type: "error", message: "Comet could not turn demo on", detail: expect.any(String) },
    { type: "plugins", plugins: [expect.objectContaining({ name: "demo", projects: [] })] },
    { type: "error", message: "Comet could not install --global", detail: '"--global" is not a plugin source.' },
    { type: "plugins", plugins: [expect.objectContaining({ name: "demo" })] },
  ])
}, 60_000)

test("saves a setting quietly, and lists it with the plugin, or says why it could not", async () => {
  const source = join(tempFolder("source"), "prs")
  mkdirSync(source)
  const settings = [{ key: "repo", title: "Repository", type: "string", required: true }]
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "comet-plugin-prs", version: "1.0.0", comet: { name: "prs", api: "^0.2.0", settings } }))
  writeFileSync(join(source, "index.tsx"), "export default 1\n")
  const sent: CoreMessage[] = []
  const manager = pluginManager((message) => sent.push(message))
  await manager.add(source)
  const listed = () => (sent.findLast((message) => message.type === "plugins") as Extract<CoreMessage, { type: "plugins" }>).plugins.find((plugin) => plugin.name === "prs")!
  expect(listed()).toMatchObject({ settings, values: {}, missing: ["repo"] })
  sent.length = 0
  await manager.setting("prs", "repo", "chatwoot/chatwoot")
  expect(sent.map((message) => message.type)).toEqual(["plugins"])
  expect(listed()).toMatchObject({ values: { repo: "chatwoot/chatwoot" }, missing: [] })
  await manager.setting("prs", "repo", "a\nb")
  expect(sent.at(-2)).toEqual({ type: "error", message: "Comet could not save repo for prs", detail: "Repository must be a value that is one line." })
}, 60_000)

test("answers a list at once, then sends it again when a check finds an update", async () => {
  const folder = join(tempFolder("source"), "gitty")
  mkdirSync(folder)
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "comet-plugin-gitty", version: "1.0.0", comet: { name: "gitty", api: "^0.2.0" } }))
  writeFileSync(join(folder, "index.tsx"), "export default 1\n")
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: folder, stdout: "ignore", stderr: "ignore" })
  git("init", "-q", "-b", "main")
  git("add", "-A")
  git("commit", "-qm", "one")
  const broadcast: CoreMessage[] = []
  const manager = pluginManager((message) => broadcast.push(message))
  await manager.add(`git+file://${folder}`)
  writeFileSync(join(folder, "index.tsx"), "export default 2\n")
  git("commit", "-qam", "two")

  const replied: CoreMessage[] = []
  broadcast.length = 0
  manager.list((message) => replied.push(message))
  expect((replied[0] as Extract<CoreMessage, { type: "plugins" }>).plugins[0]!.update).toBeUndefined()
  await until(() => broadcast.length > 0)
  expect((broadcast[0] as Extract<CoreMessage, { type: "plugins" }>).plugins[0]!.update).toMatch(/^[0-9a-f]{7}$/)
}, 60_000)
