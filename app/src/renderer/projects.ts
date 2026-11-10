import type { CommandProcess, ProjectPart, ProjectParts } from "@desk/protocol"
import { createEffect, createMemo, createRoot, on } from "solid-js"
import { createStore } from "solid-js/store"
import { account } from "./account"
import { core } from "./core"
import { projectName } from "./format"
import { shownTab } from "./workspace"

/** What the window has read about each project, by folder. A part not read yet is absent. */
const [projects, setProjects] = createStore<Record<string, Partial<ProjectParts>>>({})

export const projectData = (dir: string): Partial<ProjectParts> => projects[dir] ?? {}

/** Asks the core for a part of a project. What the window had stays until the answer comes. */
export function readProject(dir: string, part: ProjectPart) {
  core.send({ type: "project.get", project: dir, part })
}

/** Reads a part again from nothing, so a page shows that it is reading. */
export function reloadProject(dir: string, part: ProjectPart) {
  setProjects(dir, { [part]: undefined })
  readProject(dir, part)
}

/** A project's name: the one set in Settings, else its folder's. */
export const projectLabel = (dir: string) => account.settings.projects[dir]?.name ?? projectName(dir)

/** The address of an image in a project, which the core serves. */
export const projectImage = (dir: string, path: string) => core.iconUrl(dir, path)

/** Turns an MCP server on or off in the project. Claude Code keeps the choice. Its row shows pending until the core answers. */
export function toggleMcpServer(dir: string, name: string, enabled: boolean) {
  const servers = projects[dir]?.mcp
  if (servers) setProjects(dir, { mcp: servers.map((server) => (server.name === name ? { ...server, status: "pending" as const } : server)) })
  core.send({ type: "mcp.toggle", project: dir, name, enabled })
}

/**
 * Replaces the commands in `replacing` with `processes`. One process saves as a plain command called
 * `name`, several as a group called `name`. Adding replaces nothing.
 */
export function saveCommands(dir: string, name: string, processes: readonly CommandProcess[], replacing: readonly string[]) {
  core.send({ type: "commands.save", project: dir, name, processes, replacing })
}

/** Removes commands, such as every command in a group, stopping those that run. */
export function removeCommands(dir: string, ids: readonly string[]) {
  core.send({ type: "commands.remove", project: dir, ids })
}

export function runCommands(dir: string, ids: readonly string[]) {
  core.send({ type: "commands.run", project: dir, ids })
}

export function stopCommands(dir: string, ids: readonly string[]) {
  core.send({ type: "commands.stop", project: dir, ids })
}

/** Asks the core for files in a project that match `query`, for an @ mention. `found` hears answers to this query only. */
export function findFiles(dir: string, query: string, found: (paths: readonly string[]) => void) {
  const stop = core.listen((message) => {
    if (message.type !== "files.found" || message.project !== dir || message.query !== query) return
    stop()
    found(message.paths)
  })
  core.send({ type: "files.search", project: dir, query })
  return stop
}

core.listen((message) => {
  if (message.type === "project") setProjects(message.project, { [message.part]: message.value })
})

// A tab coming to the front, or moving to another project, shows its project's Space card, commands and threads.
// The Space card reads afresh each time. Commands and threads read once; the core sends commands again on change.
createRoot(() => {
  const shown = createMemo(() => {
    const tab = shownTab()
    return tab && `${tab.id}\n${tab.project}`
  })
  createEffect(
    on(shown, () => {
      const dir = shownTab()?.project
      if (!dir) return
      for (const part of ["commands", "threads"] as const) if (projects[dir]?.[part] === undefined) readProject(dir, part)
      readProject(dir, "space")
    }),
  )
})

// A hot-swapped copy of this module would start empty, and the core does not send its state again. In development, a change here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
