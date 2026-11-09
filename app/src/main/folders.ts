import { app, dialog, type BrowserWindow } from "electron"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The folders Desk has opened, most recent first. Kept beside Electron's own data for the app. */
const projectsFile = () => join(app.getPath("userData"), "projects.json")
const MAX_PROJECTS = 20

export function isFolder(path: string) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Recent projects that still exist. The first is the one Desk reopens on launch. */
export function recentProjects(): string[] {
  try {
    const { paths } = JSON.parse(readFileSync(projectsFile(), "utf8")) as { paths?: unknown }
    return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string" && isFolder(path)) : []
  } catch {
    return []
  }
}

/** Moves a folder to the front of the recent projects. */
export function rememberProject(path: string) {
  const paths = [path, ...recentProjects().filter((found) => found !== path)].slice(0, MAX_PROJECTS)
  writeFileSync(projectsFile(), JSON.stringify({ paths }, null, 2))
}

export async function chooseFolder(window?: BrowserWindow): Promise<string | undefined> {
  const options = { title: "Open Folder", buttonLabel: "Open", properties: ["openDirectory" as const] }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled ? undefined : result.filePaths[0]
}

/** DESK_DIR wins, as `bin/desk` sets it. Then the most recent project, then the picker. */
export async function initialFolder(): Promise<string | undefined> {
  const fromEnv = process.env.DESK_DIR
  if (fromEnv && isFolder(fromEnv)) return fromEnv
  return recentProjects()[0] ?? (await chooseFolder())
}
