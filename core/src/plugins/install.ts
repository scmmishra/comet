import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { PLUGIN_NAME } from "@comet/protocol"
import { cometHome, writeJsonFile } from "../data-files"
import { spawn } from "../environment"
import { forgetPlugin } from "./config"
import { forgetPluginSettings } from "./settings"
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
  /** The package Comet installed it as, such as `@scmmishra/chatwoot-support`. */
  readonly package?: string
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
  // npm answers an unknown package with a bare 404.
  const missing = stderr.match(/GET https:\/\/registry\.npmjs\.org\/(\S+) - 404/)?.[1]
  if (missing) throw new Error(`${decodeURIComponent(missing)} is not on npm. Check its name, or install it from github:owner/repo, a git URL or a folder.`)
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
  // A package from a registry is saved under its version range, such as ^0.2.0, so its name says where it came from.
  const spec = pkg ? dependencies()[pkg] : undefined
  const source = pkg ? (spec && isRange(spec) ? pkg : spec) : linked ? resolve(pluginsFolder(), readlinkSync(folder)) : undefined
  const found = { name, kind, ...(pkg ? { package: pkg } : {}), ...(source ? { source } : {}) }
  if (!existsSync(folder)) return { ...found, error: `${name} links to ${source}, which is gone.` }
  try {
    const manifest = checkPlugin(folder, name)
    return { ...found, ...(manifest ? { manifest } : {}) }
  } catch (error) {
    return { ...found, error: (error as Error).message }
  }
}

/**
 * The plugin a command names: by its name, such as `chatwoot`, or by the package it was installed as, such as
 * `@scmmishra/chatwoot-support`. A name that matches none says which plugins there are.
 */
export function findPlugin(named: string): PluginInfo {
  const plugins = listPlugins()
  const found = plugins.find((plugin) => plugin.name === named) ?? plugins.find((plugin) => plugin.package === named)
  if (found) return found
  const known = plugins.map((plugin) => (plugin.package ? `${plugin.name} (${plugin.package})` : plugin.name))
  throw new Error(`No plugin named ${named} is installed. ${known.length ? `There are: ${known.join(", ")}.` : "There are none."}`)
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
    if (!pkg) {
      // Installing a source again changes nothing. Its package, or the source it was saved under, names the plugin.
      const npmName = source.replace(/(.)@[^/]*$/, "$1")
      const installed = listPlugins().find((plugin) => plugin.package === npmName || (plugin.source !== undefined && [source, resolved].includes(plugin.source)))
      throw new Error(installed ? `${installed.name} is installed from ${source} already. Run \`comet plugin update ${installed.name}\` for a newer version.` : `Installing ${source} changed nothing.`)
    }
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
export async function removePlugin(name: string, { purge = false } = {}) {
  const link = join(pluginsFolder(), name)
  const stat = lstatSync(link, { throwIfNoEntry: false })
  if (!stat) throw new Error(`No plugin named ${name} is in ${pluginsFolder()}.`)
  if (!stat.isSymbolicLink()) throw new Error(`Comet did not install ${name}, so it leaves ${link} alone. Delete the folder yourself to remove it.`)
  const pkg = packageOf(name)
  unlinkSync(link)
  if (pkg) await bun(["remove", pkg])
  forgetPlugin(name)
  if (purge) forgetPluginSettings(name)
}

/** Whether a saved source is a version range for a package on a registry, rather than a git URL, tarball or folder. */
const isRange = (spec: string) => /^(?:[\^~]|[<>]=?|=)?\s*\d|^\*$|^latest$/.test(spec.trim())

/**
 * What Update would take for an installed plugin that is newer than what it has: a version for a package on a
 * registry, the newest within its saved range, or a commit for a git source. A folder offers its version when it
 * differs. Undefined when there is nothing newer, or when it cannot tell, such as offline.
 */
export async function availableUpdate(plugin: PluginInfo): Promise<string | undefined> {
  const pkg = plugin.package
  const spec = pkg && dependencies()[pkg]
  const installed = plugin.manifest?.version
  if (!pkg || !spec) return undefined
  if (isRange(spec)) {
    const run = spawn([process.execPath, "info", pkg, "versions", "--json"], { cwd: realpathSync(packagesFolder()), stdout: "pipe", stderr: "ignore" })
    const [output, code] = await Promise.all([new Response(run.stdout).text(), run.exited])
    if (code !== 0) return undefined
    const fitting = (JSON.parse(output) as string[]).filter((version) => Bun.semver.satisfies(version, spec)).sort(Bun.semver.order)
    const newest = fitting.at(-1)
    return newest && installed && Bun.semver.order(newest, installed) > 0 ? newest : undefined
  }
  if (spec.startsWith("github:") || spec.startsWith("git+")) {
    // The lockfile pins a git source to a commit, which `<package>@<source>#<commit>` names.
    const lock = existsSync(join(packagesFolder(), "bun.lock")) ? readFileSync(join(packagesFolder(), "bun.lock"), "utf8") : ""
    const pinned = lock.match(new RegExp(`"${pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}@[^"#]*#([0-9a-f]+)"`))?.[1]
    const [where, ref] = spec.split("#")
    const url = where!.startsWith("github:") ? `https://github.com/${where!.slice("github:".length)}.git` : where!.slice("git+".length)
    const run = spawn(["git", "ls-remote", url, ref ?? "HEAD"], { stdout: "pipe", stderr: "ignore" })
    const [output, code] = await Promise.all([new Response(run.stdout).text(), run.exited])
    const newest = code === 0 ? output.split(/\s/)[0] : undefined
    return pinned && newest && !newest.startsWith(pinned) ? newest.slice(0, 7) : undefined
  }
  if (spec.startsWith("/")) {
    const now = readManifest(spec)?.version
    return now && now !== installed ? now : undefined
  }
  return undefined
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
  // A name may be a plugin's or its package's. One Comet did not install, such as a linked plugin, has no newer version to take.
  const named = names?.map(findPlugin) ?? []
  const local = named.filter((plugin) => plugin.kind !== "installed").map((plugin) => plugin.name)
  if (local.length) throw new Error(`Comet did not install ${local.join(", ")}, so it cannot update ${local.length === 1 ? "it" : "them"}.`)
  const chosen = names ? installed.filter((plugin) => named.some((found) => found.name === plugin.name)) : installed
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
