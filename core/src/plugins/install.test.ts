import { beforeEach, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, until, useTempHome } from "../test-support"
import { pluginsOn, setPluginOn, whereOn } from "./config"
import { addPlugin, linkPlugin, listPlugins, packagesFolder, removePlugin, updatePlugins } from "./install"
import { harness, installPlugin, turnOn } from "./test-plugins"
import { watchInstalls } from "./watch"

// Each test gets a home of its own, so one that fails leaves nothing installed for the next.
beforeEach(() => useTempHome())

const home = () => process.env.COMET_HOME!

/** A plugin package in a folder of its own, with a panel that says hello. */
function pluginPackage(name: string, version: string, comet: Record<string, unknown> = { name, title: name.toUpperCase(), api: "^0.2.0" }) {
  const folder = join(tempFolder("source"), name)
  mkdirSync(folder)
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name: `comet-plugin-${name}`, version, comet }))
  writeFileSync(join(folder, "index.tsx"), `import { definePlugin, Text } from "@comet/plugin"\nexport default definePlugin((comet) => comet.panel("main", { title: "Main", view: () => <Text>hello</Text> }))\n`)
  return folder
}

/** Gives a plugin package a dependency of its own, in a folder beside it, whose greeting its panel shows. */
function withGreeting(folder: string) {
  const dep = join(folder, "..", "greeting")
  mkdirSync(dep)
  writeFileSync(join(dep, "package.json"), JSON.stringify({ name: "greeting", version: "1.0.0", main: "index.js" }))
  writeFileSync(join(dep, "index.js"), `export const greeting = "hello from greeting"\n`)
  const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"))
  writeFileSync(join(folder, "package.json"), JSON.stringify({ ...pkg, dependencies: { greeting: `file:${dep}` } }))
  writeFileSync(join(folder, "index.tsx"), `import { definePlugin, Text } from "@comet/plugin"\nimport { greeting } from "greeting"\nexport default definePlugin((comet) => comet.panel("main", { title: "Main", view: () => <Text>{greeting}</Text> }))\n`)
  return folder
}

/** A git repo of a plugin package, and a way to commit a new version to it. */
function gitPackage(name: string) {
  const folder = pluginPackage(name, "1.0.0")
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: folder, stdout: "ignore", stderr: "ignore" })
  git("init", "-q", "-b", "main")
  git("add", "-A")
  git("commit", "-qm", "1.0.0")
  return {
    source: `git+file://${folder}`,
    commit(version: string, comet?: Record<string, unknown>) {
      setVersion(folder, version, comet)
      git("commit", "-qam", version)
    },
  }
}

/**
 * Gives a plugin package a new version. It writes a new file in place of the old, as git and editors do:
 * Bun may install a folder's files as hard links, so a write into the old file would change the installed copy too.
 */
const setVersion = (folder: string, version: string, comet?: Record<string, unknown>) => {
  const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"))
  writeFileSync(join(folder, "package.json.new"), JSON.stringify({ ...pkg, version, ...(comet ? { comet } : {}) }))
  renameSync(join(folder, "package.json.new"), join(folder, "package.json"))
}

test("installs a plugin from a folder, runs it with its own dependency, updates it and removes it", async () => {
  const source = withGreeting(pluginPackage("hello", "1.0.0"))
  const added = await addPlugin(source)
  expect(added).toMatchObject({ name: "hello", kind: "installed", source: realpathSync(source), manifest: { title: "HELLO", version: "1.0.0" } })
  expect(lstatSync(join(home(), "plugins", "hello")).isSymbolicLink()).toBe(true)
  // Installing does not turn it on.
  expect(whereOn("hello")).toEqual({ everywhere: false, projects: [] })

  setPluginOn("hello", true)
  const { plugins, layouts, layout, textOf } = harness()
  await layouts.openPanel("tab-1", "hello.main")
  await until(() => textOf("hello", layout("tab-1")!.panels[0]!.root) === "hello from greeting")
  plugins.stop()

  // The new version says something new, and Comet runs it, not the bundle it built before.
  setVersion(source, "1.1.0")
  writeFileSync(join(source, "index.tsx.new"), readFileSync(join(source, "index.tsx"), "utf8").replace("{greeting}", "{greeting} again"))
  renameSync(join(source, "index.tsx.new"), join(source, "index.tsx"))
  expect(await updatePlugins()).toEqual([{ name: "hello", from: "1.0.0", to: "1.1.0" }])
  const after = harness()
  await after.layouts.openPanel("tab-1", "hello.main")
  await until(() => after.textOf("hello", after.layout("tab-1")!.panels[0]!.root) === "hello from greeting again")
  after.plugins.stop()

  await removePlugin("hello")
  expect(existsSync(join(home(), "plugins", "hello"))).toBe(false)
  expect(existsSync(join(packagesFolder(), "node_modules", "comet-plugin-hello"))).toBe(false)
  expect(pluginsOn("/anywhere")).toEqual([])
}, 60_000)

test("installs from a git repo and updates to its newest commit", async () => {
  const repo = gitPackage("gitty")
  expect(await addPlugin(repo.source)).toMatchObject({ name: "gitty", manifest: { version: "1.0.0" } })
  repo.commit("2.0.0")
  expect(await updatePlugins(["gitty"])).toEqual([{ name: "gitty", from: "1.0.0", to: "2.0.0" }])
}, 60_000)

test("keeps nothing of a package that is not a plugin, needs another API, or takes a name in use", async () => {
  const plain = tempFolder("plain")
  writeFileSync(join(plain, "package.json"), JSON.stringify({ name: "not-a-plugin", version: "1.0.0" }))
  await expect(addPlugin(plain)).rejects.toThrow("has no comet field")
  await expect(addPlugin(pluginPackage("unranged", "1.0.0", { name: "unranged" }))).rejects.toThrow("has no api range")
  await expect(addPlugin(pluginPackage("future", "1.0.0", { name: "future", api: "^9.0.0" }))).rejects.toThrow("needs Comet's plugin API ^9.0.0")
  installPlugin("taken", "export default 1")
  await expect(addPlugin(pluginPackage("taken", "1.0.0"))).rejects.toThrow("already in")
  expect(JSON.parse(readFileSync(join(packagesFolder(), "package.json"), "utf8")).dependencies ?? {}).toEqual({})
  expect(existsSync(join(packagesFolder(), "node_modules", "not-a-plugin"))).toBe(false)
  expect(listPlugins().map((plugin) => [plugin.name, plugin.kind])).toEqual([["taken", "local"]])
}, 60_000)

test("an update that breaks a plugin puts every package back", async () => {
  const repo = gitPackage("steady")
  await addPlugin(repo.source)
  repo.commit("2.0.0", { name: "steady", api: "^9.0.0" })
  await expect(updatePlugins()).rejects.toThrow("needs Comet's plugin API ^9.0.0")
  expect(listPlugins().find((plugin) => plugin.name === "steady")?.manifest?.version).toBe("1.0.0")
}, 60_000)

test("links a folder and removes only the link, and never removes a folder made by hand", async () => {
  const folder = pluginPackage("linked", "1.0.0")
  expect(linkPlugin(folder)).toMatchObject({ name: "linked", kind: "linked", source: folder })
  await removePlugin("linked")
  expect(existsSync(join(folder, "index.tsx"))).toBe(true)

  installPlugin("handmade", "export default 1")
  turnOn({ everywhere: ["handmade"] })
  await expect(removePlugin("handmade")).rejects.toThrow("Comet did not install handmade")
  expect(existsSync(join(home(), "plugins", "handmade", "index.tsx"))).toBe(true)
  await expect(updatePlugins(["handmade"])).rejects.toThrow("Comet did not install handmade")
})

test("turns a plugin on and off everywhere and per project, keeping a project's saved key", () => {
  turnOn({ projects: { "~/code/web": ["a"] } })
  setPluginOn("b", true, join(process.env.HOME!, "code/web"))
  setPluginOn("c", true, "/work/api")
  setPluginOn("d", true)
  expect(JSON.parse(readFileSync(join(home(), "plugins.json"), "utf8"))).toEqual({ everywhere: ["d"], projects: { "~/code/web": ["a", "b"], "/work/api": ["c"] } })
  setPluginOn("c", false, "/work/api")
  expect(whereOn("a")).toEqual({ everywhere: false, projects: [join(process.env.HOME!, "code/web")] })
  expect(JSON.parse(readFileSync(join(home(), "plugins.json"), "utf8")).projects).toEqual({ "~/code/web": ["a", "b"] })
})

test("tells a running Comet when a plugin is installed, updated, turned on, linked or removed", async () => {
  let changes = 0
  const stop = watchInstalls(() => changes++)
  const settled = async (count: number) => {
    await until(() => changes >= count)
    // Changes settle into one call, so the next step starts from a quiet watcher.
    await Bun.sleep(400)
    expect(changes).toBe(count)
  }
  const repo = gitPackage("watched")
  await addPlugin(repo.source)
  await settled(1)
  repo.commit("2.0.0")
  await updatePlugins()
  await settled(2)
  setPluginOn("watched", true)
  await settled(3)
  await removePlugin("watched")
  await settled(4)
  linkPlugin(pluginPackage("linked", "1.0.0"))
  await settled(5)
  stop()
}, 60_000)

test("names the plugin whose source folder is gone, which stops every install", async () => {
  const gone = pluginPackage("gone", "1.0.0")
  await addPlugin(gone)
  rmSync(gone, { recursive: true })
  await expect(addPlugin(pluginPackage("next", "1.0.0"))).rejects.toThrow("The folder gone was installed from is gone")
  await removePlugin("gone")
  expect(await addPlugin(pluginPackage("next", "1.0.0"))).toMatchObject({ name: "next" })
}, 60_000)
