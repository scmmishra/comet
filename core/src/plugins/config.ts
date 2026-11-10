import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { deskHome } from "../data-files"

/**
 * The plugins on in a project, from `~/.desk/plugins.json`:
 * `{ "everywhere": ["newrelic"], "projects": { "~/Chatwoot/chatwoot": ["support"] } }`.
 * A project is named by its folder. The file is read on each ask, so an edit applies the next time a
 * project's plugins are read. A missing file turns every plugin off, and a broken one is reported.
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
  if (typeof saved !== "object" || saved === null) throw new Error(`${file} must hold an object, so no plugin is on.`)
  const names = (value: unknown) => (Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [])
  const here = Object.entries(saved.projects ?? {}).flatMap(([folder, list]) => (expandHome(folder) === project ? names(list) : []))
  return [...new Set([...names(saved.everywhere), ...here])]
}

const expandHome = (folder: string) => (folder === "~" || folder.startsWith("~/") ? join(homedir(), folder.slice(1)) : folder).replace(/(.)\/+$/, "$1")
