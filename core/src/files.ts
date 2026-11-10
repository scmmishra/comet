import { statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

/** The editor command, which takes `path:line`. Zed's CLI does; set DESK_EDITOR for another. */
const EDITOR = process.env.DESK_EDITOR ?? "zed"

/**
 * A file a reply names, to open in the editor. A relative path is in the project, and ~/ is the home
 * folder. It may lie outside the project, such as a report Claude wrote to a temporary folder. Only a
 * regular file is opened: the path comes from model output, so a folder, an app or a missing file is refused.
 */
export function openableFile(dir: string, path: string): string | undefined {
  const file = resolve(dir, path.startsWith("~/") ? join(homedir(), path.slice(2)) : path)
  try {
    return statSync(file).isFile() ? file : undefined
  } catch {
    return undefined
  }
}

/** Opens a file in the editor at a line. Without the editor, macOS opens it in the default text editor. */
export function openInEditor(file: string, line?: number) {
  const target = line ? `${file}:${line}` : file
  try {
    Bun.spawn([EDITOR, target], { stdout: "ignore", stderr: "ignore" })
  } catch {
    // `open -t` always opens a text editor, so a script never runs from here.
    Bun.spawn(["open", "-t", file], { stdout: "ignore", stderr: "ignore" })
  }
}
