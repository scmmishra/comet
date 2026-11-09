import { dialog, type BrowserWindow } from "electron"
import { statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

/** A folder as an absolute path, as the core takes it, or undefined when it is not a folder. */
export function folder(path: string, cwd = process.cwd()): string | undefined {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path)
  try {
    return statSync(absolute).isDirectory() ? absolute : undefined
  } catch {
    return undefined
  }
}

export async function chooseFolder(window?: BrowserWindow): Promise<string | undefined> {
  const options = { title: "Open Folder", buttonLabel: "Open", properties: ["openDirectory" as const] }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled ? undefined : result.filePaths[0]
}
