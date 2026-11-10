import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { PLUGIN_NAME } from "@desk/protocol"
import { deskHome } from "../data-files"

/**
 * The plugins on in a project, from `~/.desk/plugins.json`:
 * `{ "everywhere": ["newrelic"], "projects": { "~/Chatwoot/chatwoot": ["support"] } }`.
 * A project is named by its folder. The file is read on each ask, so an edit applies the next time a
 * project's plugins are read. A missing file turns every plugin off. A broken one turns every plugin
 * off and is reported, so a typo never quietly turns one plugin off.
 */
export function pluginsOn(project: string): string[] {
  const file = join(deskHome(), "plugins.json")
  if (!existsSync(file)) return []
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
  const here = Object.entries(saved.projects ?? {}).flatMap(([folder, list]) => {
    const valid = names(list, folder)
    return expandHome(folder) === project ? valid : []
  })
  return [...new Set([...names(saved.everywhere, "everywhere"), ...here])]
}

/** The project folders `plugins.json` turns plugins on for, beyond those on everywhere. A broken file names none. */
export function pluginProjects(): string[] {
  const file = join(deskHome(), "plugins.json")
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { projects?: Record<string, unknown> }
    return Object.keys(saved.projects ?? {}).map(expandHome)
  } catch {
    return []
  }
}

const expandHome = (folder: string) => (folder === "~" || folder.startsWith("~/") ? join(homedir(), folder.slice(1)) : folder).replace(/(.)\/+$/, "$1")
