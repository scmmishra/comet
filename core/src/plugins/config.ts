import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { PLUGIN_NAME } from "@comet/protocol"
import { cometHome, writeJsonFile } from "../data-files"

/**
 * The plugins on in a project, from `~/.comet/plugins.json`:
 * `{ "everywhere": ["newrelic"], "projects": { "~/Chatwoot/chatwoot": ["support"] } }`.
 * A project is named by its folder. The file is read on each ask, so an edit applies the next time a
 * project's plugins are read. A missing file turns every plugin off. A broken one turns every plugin
 * off and is reported, so a typo never quietly turns one plugin off.
 */
export function pluginsOn(project: string): string[] {
  const saved = readConfig()
  const here = Object.entries(saved.projects).flatMap(([folder, list]) => (expandHome(folder) === project ? list : []))
  return [...new Set([...saved.everywhere, ...here])]
}

interface Config {
  everywhere: string[]
  projects: Record<string, string[]>
}

/** `plugins.json`, checked. A missing file turns no plugin on. A broken one throws, naming what is wrong. */
function readConfig(): Config {
  const file = configFile()
  if (!existsSync(file)) return { everywhere: [], projects: {} }
  let saved: { everywhere?: unknown; projects?: Record<string, unknown> } | null
  try {
    saved = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error(`${file} is not valid JSON, so no plugin is on.`)
  }
  const broken = (why: string) => new Error(`${file} ${why}, so no plugin is on.`)
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) throw broken("must hold an object")
  const names = (value: unknown, where: string): string[] => {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw broken(`lists ${where} as something other than an array`)
    for (const name of value) if (typeof name !== "string" || !PLUGIN_NAME.test(name)) throw broken(`names a plugin ${JSON.stringify(name)} in ${where}. A name is lowercase letters, digits, - and _`)
    return value
  }
  if (saved.projects !== undefined && (typeof saved.projects !== "object" || saved.projects === null || Array.isArray(saved.projects))) throw broken("must map projects to lists")
  return {
    everywhere: names(saved.everywhere, "everywhere"),
    projects: Object.fromEntries(Object.entries(saved.projects ?? {}).map(([folder, list]) => [folder, names(list, folder)])),
  }
}

/**
 * Turns `plugin` on or off everywhere, or in `project` when given. A project keeps the key it is saved
 * under, and a new one is saved under `~` when it is in the home folder. A project with no plugin left is dropped.
 */
export function setPluginOn(plugin: string, on: boolean, project?: string) {
  const saved = readConfig()
  const change = (list: string[]) => (on ? [...new Set([...list, plugin])] : list.filter((name) => name !== plugin))
  if (project === undefined) saved.everywhere = change(saved.everywhere)
  else {
    const key = Object.keys(saved.projects).find((folder) => expandHome(folder) === project) ?? abbreviateHome(project)
    saved.projects[key] = change(saved.projects[key] ?? [])
    if (saved.projects[key].length === 0) delete saved.projects[key]
  }
  writeJsonFile(configFile(), saved)
}

/** Takes `plugin` out of every list, as when it is removed. */
export function forgetPlugin(plugin: string) {
  if (!existsSync(configFile())) return
  const saved = readConfig()
  saved.everywhere = saved.everywhere.filter((name) => name !== plugin)
  for (const [folder, list] of Object.entries(saved.projects)) {
    saved.projects[folder] = list.filter((name) => name !== plugin)
    if (saved.projects[folder].length === 0) delete saved.projects[folder]
  }
  writeJsonFile(configFile(), saved)
}

/** Where `plugin` is on: everywhere, and the project folders, as `plugins.json` names them. */
export function whereOn(plugin: string): { everywhere: boolean; projects: string[] } {
  const saved = readConfig()
  return { everywhere: saved.everywhere.includes(plugin), projects: Object.entries(saved.projects).flatMap(([folder, list]) => (list.includes(plugin) ? [folder] : [])) }
}

/** The project folders `plugins.json` turns plugins on for, beyond those on everywhere. A broken file names none. */
export function pluginProjects(): string[] {
  try {
    const saved = JSON.parse(readFileSync(configFile(), "utf8")) as { projects?: Record<string, unknown> }
    return Object.keys(saved.projects ?? {}).map(expandHome)
  } catch {
    return []
  }
}

const configFile = () => join(cometHome(), "plugins.json")

const abbreviateHome = (folder: string) => (folder === homedir() || folder.startsWith(`${homedir()}/`) ? `~${folder.slice(homedir().length)}` : folder)

const expandHome = (folder: string) => (folder === "~" || folder.startsWith("~/") ? join(homedir(), folder.slice(1)) : folder).replace(/(.)\/+$/, "$1")
