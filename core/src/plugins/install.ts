import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { PLUGIN_NAME } from "@comet/protocol"
import { cometHome, writeJsonFile } from "../data-files"
import { spawn } from "../environment"
import { forgetPlugin } from "./config"
import { checkPlugin, readManifest, type Manifest } from "./manifest"

/**
 * Installs, updates and removes plugins. Each plugin Comet runs is `~/.comet/plugins/<name>`:
 *
 * - An installed plugin is a package in `~/.comet/packages`, installed with Bun, so a source can be an npm
 *   name, `github:owner/repo`, a git URL, a tarball or a folder. Its folder in `plugins` links to it.
 * - A linked plugin is a folder elsewhere, such as one its author works in. Its folder in `plugins` links to it.
 * - Any other folder in `plugins` was made by hand. Comet never changes or removes it.
 *
 * Installing runs no package scripts, and does not turn the plugin on anywhere.
 */

export type PluginKind = "installed" | "linked" | "local"

/** A plugin in `~/.comet/plugins`, with what its manifest says. `source` is what it was installed from, or the folder it links to. */
export interface PluginInfo {
  readonly name: string
  readonly kind: PluginKind
  readonly source?: string
  readonly manifest?: Manifest
  /** Why the plugin cannot run, such as a broken manifest. */
  readonly error?: string
}

const pluginsFolder = () => join(cometHome(), "plugins")
export const packagesFolder = () => join(cometHome(), "packages")
const modulesFolder = () => join(packagesFolder(), "node_modules")
const packageFile = () => join(packagesFolder(), "package.json")

/** The packages installed, by package name, with the source each was installed from. */
const dependencies = (): Record<string, string> => (existsSync(packageFile()) ? (JSON.parse(readFileSync(packageFile(), "utf8")).dependencies ?? {}) : {})

/** Runs Bun in the packages folder. A failure carries Bun's own error, such as a package that is not on npm. */
async function bun(args: readonly string[]) {
  makePackagesFolder()
  // The core runs on Bun, so its own binary installs packages.
  // Bun saves a folder source as a path relative to the folder it runs in, and reads it back on every later
  // install. Through a link, such as a home under /var or a source in /tmp, it reads it back wrong, so Bun
  // runs from the real path and gets folder sources by theirs.
  const run = spawn([process.execPath, ...args], { cwd: realpathSync(packagesFolder()), stdout: "pipe", stderr: "pipe" })
  const [stderr, code] = await Promise.all([new Response(run.stderr).text(), run.exited])
  if (code === 0) return
  // Every install installs each package again, so a folder a plugin was installed from, and that is gone
  // since, fails them all. Bun names the package, so the user is told which plugin and what to do.
  const gone = stderr.match(/Could not find folder "[^"]*" for dependency "([^"]+)"/)?.[1]
  const plugin = gone && listPlugins().find((found) => packageOf(found.name) === gone)
  if (plugin) throw new Error(`The folder ${plugin.name} was installed from is gone, so Bun cannot install anything. Remove ${plugin.name} with \`comet plugin remove ${plugin.name}\`, then install it again from where it is now.`)
  throw new Error(stderr.trim().split("\n").filter((line) => line.startsWith("error:")).join("\n") || stderr.trim() || `bun ${args[0]} failed.`)
}

function makePackagesFolder() {
  mkdirSync(packagesFolder(), { recursive: true })
  if (!existsSync(packageFile())) writeJsonFile(packageFile(), { private: true, dependencies: {} })
}

/** The package a plugin's folder links to, when Comet installed it. */
function packageOf(name: string): string | undefined {
  const link = join(pluginsFolder(), name)
  if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) return undefined
  const target = resolve(pluginsFolder(), readlinkSync(link))
  const path = relative(modulesFolder(), target)
  return path.startsWith("..") ? undefined : path
}

function info(name: string): PluginInfo {
  const folder = join(pluginsFolder(), name)
  const linked = lstatSync(folder).isSymbolicLink()
  const pkg = packageOf(name)
  const kind: PluginKind = pkg ? "installed" : linked ? "linked" : "local"
  const source = pkg ? dependencies()[pkg] : linked ? resolve(pluginsFolder(), readlinkSync(folder)) : undefined
  if (!existsSync(folder)) return { name, kind, ...(source ? { source } : {}), error: `${name} links to ${source}, which is gone.` }
  try {
    const manifest = checkPlugin(folder, name)
    return { name, kind, ...(source ? { source } : {}), ...(manifest ? { manifest } : {}) }
  } catch (error) {
    return { name, kind, ...(source ? { source } : {}), error: (error as Error).message }
  }
}

/** Every plugin in `~/.comet/plugins`, by name. */
export function listPlugins(): PluginInfo[] {
  if (!existsSync(pluginsFolder())) return []
  return readdirSync(pluginsFolder())
    .filter((name) => PLUGIN_NAME.test(name))
    .sort()
    .map(info)
}

/** Refuses a name that is not a plugin name, or that a plugin in `plugins` already has. */
function checkFree(name: string) {
  if (!PLUGIN_NAME.test(name)) throw new Error(`${name} is not a plugin name. A name is lowercase letters, digits, - and _.`)
  if (lstatSync(join(pluginsFolder(), name), { throwIfNoEntry: false })) throw new Error(`A plugin named ${name} is already in ${pluginsFolder()}.`)
}

/**
 * Runs `change` on the packages, and puts `package.json`, the lockfile and the installed packages back as
 * they were if it throws.
 */
async function withRollback<T>(change: () => Promise<T>): Promise<T> {
  makePackagesFolder()
  const files = ["package.json", "bun.lock"].filter((file) => existsSync(join(packagesFolder(), file)))
  const kept = new Map(files.map((file) => [file, readFileSync(join(packagesFolder(), file))]))
  try {
    return await change()
  } catch (error) {
    rmSync(join(packagesFolder(), "bun.lock"), { force: true })
    for (const [file, contents] of kept) writeFileSync(join(packagesFolder(), file), contents)
    // Bun leaves a package that package.json no longer lists in node_modules, so the packages install
    // again from Bun's cache.
    rmSync(modulesFolder(), { recursive: true, force: true })
    await bun(["install", "--ignore-scripts"])
    throw error
  }
}

/**
 * Installs the plugin `source` names and links it into `plugins` under its manifest's name. A package with
 * no manifest, no API range, an API this Comet lacks or a name already taken is not kept.
 */
export async function addPlugin(source: string): Promise<PluginInfo> {
  // The source reaches Bun as an argument, so one that starts with - would read as a flag.
  if (!source.trim() || source.trim().startsWith("-")) throw new Error(`${JSON.stringify(source)} is not a plugin source.`)
  // A folder goes by its real path, as Bun's own folder does (see `bun`).
  const resolved = existsSync(source) ? realpathSync(source) : source
  return withRollback(async () => {
    const before = dependencies()
    await bun(["add", "--ignore-scripts", resolved])
    const after = dependencies()
    const pkg = Object.keys(after).find((name) => before[name] !== after[name])
    if (!pkg) throw new Error(`Installing ${source} changed nothing. If it is installed already, run update for a newer version.`)
    const folder = join(modulesFolder(), pkg)
    const manifest = readManifest(folder)
    if (!manifest) throw new Error(`${pkg} is not a Comet plugin: its package.json has no comet field.`)
    if (!manifest.api) throw new Error(`${pkg} does not say which plugin API it needs: its comet field has no api range.`)
    checkFree(manifest.name)
    checkPlugin(folder, manifest.name)
    mkdirSync(pluginsFolder(), { recursive: true })
    symlinkSync(folder, join(pluginsFolder(), manifest.name))
    return info(manifest.name)
  })
}

/** Links the plugin in `folder` into `plugins`, under its manifest's name or else the folder's. */
export function linkPlugin(folder: string): PluginInfo {
  const target = resolve(folder)
  if (!["index.tsx", "index.ts"].some((entry) => existsSync(join(target, entry)))) throw new Error(`${target} has no index.tsx or index.ts.`)
  const name = readManifest(target)?.name ?? basename(target)
  checkFree(name)
  checkPlugin(target, name)
  mkdirSync(pluginsFolder(), { recursive: true })
  symlinkSync(target, join(pluginsFolder(), name))
  return info(name)
}

/**
 * Removes a plugin Comet installed or linked, and turns it off everywhere. A linked folder stays where it
 * is. A folder made by hand is refused, since Comet did not make it.
 */
export async function removePlugin(name: string) {
  const link = join(pluginsFolder(), name)
  const stat = lstatSync(link, { throwIfNoEntry: false })
  if (!stat) throw new Error(`No plugin named ${name} is in ${pluginsFolder()}.`)
  if (!stat.isSymbolicLink()) throw new Error(`Comet did not install ${name}, so it leaves ${link} alone. Delete the folder yourself to remove it.`)
  const pkg = packageOf(name)
  unlinkSync(link)
  if (pkg) await bun(["remove", pkg])
  forgetPlugin(name)
}

/** One plugin's version before and after an update. */
export interface Updated {
  readonly name: string
  readonly from?: string
  readonly to?: string
}

/**
 * Updates installed plugins, all or those named, to the newest version their source allows: within the
 * range for an npm package, the newest commit for a git source, the folder as it is now for a folder.
 * If an updated plugin changed its name or needs an API this Comet lacks, every package goes back to
 * what it was, and the update fails. A folder has no earlier version to go back to, so a plugin installed
 * from one stays as the folder is now.
 */
export async function updatePlugins(names?: readonly string[]): Promise<Updated[]> {
  const installed = listPlugins().filter((plugin) => plugin.kind === "installed")
  const unknown = names?.filter((name) => !installed.some((plugin) => plugin.name === name)) ?? []
  if (unknown.length) throw new Error(`Comet did not install ${unknown.join(", ")}, so it cannot update ${unknown.length === 1 ? "it" : "them"}.`)
  const chosen = names ? installed.filter((plugin) => names.includes(plugin.name)) : installed
  if (chosen.length === 0) return []
  await withRollback(async () => {
    await bun(["update", "--ignore-scripts", ...chosen.map((plugin) => packageOf(plugin.name)!)])
    for (const plugin of chosen) checkPlugin(join(modulesFolder(), packageOf(plugin.name)!), plugin.name)
  })
  return chosen.map((plugin) => {
    const now = info(plugin.name).manifest?.version
    return { name: plugin.name, ...(plugin.manifest?.version ? { from: plugin.manifest.version } : {}), ...(now ? { to: now } : {}) }
  })
}
