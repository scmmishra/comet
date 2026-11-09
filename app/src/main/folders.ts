import { app, dialog, type BrowserWindow } from "electron"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const lastFolderFile = () => join(app.getPath("userData"), "last-folder.json")

function isFolder(path: string) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The folder Desk had open when it last quit, if it still exists. */
export function lastFolder(): string | undefined {
  try {
    const { path } = JSON.parse(readFileSync(lastFolderFile(), "utf8")) as { path?: string }
    return path && isFolder(path) ? path : undefined
  } catch {
    return undefined
  }
}

export function rememberFolder(path: string) {
  writeFileSync(lastFolderFile(), JSON.stringify({ path }))
}

export async function chooseFolder(window?: BrowserWindow): Promise<string | undefined> {
  const options = { title: "Open Folder", buttonLabel: "Open", properties: ["openDirectory" as const] }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled ? undefined : result.filePaths[0]
}

/** DESK_DIR wins, as `bin/desk` sets it. Then the last folder, then the picker. */
export async function initialFolder(): Promise<string | undefined> {
  const fromEnv = process.env.DESK_DIR
  if (fromEnv && isFolder(fromEnv)) return fromEnv
  return lastFolder() ?? (await chooseFolder())
}
