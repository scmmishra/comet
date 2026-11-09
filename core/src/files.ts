import { statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { insideProject } from "./project-path"

/** The editor command, which takes `path:line`. Zed's CLI does; set DESK_EDITOR for another. */
const EDITOR = process.env.DESK_EDITOR ?? "zed"

/** A file a reply names, inside the project. Anything that is not a regular file is refused too. */
export function projectFile(dir: string, path: string): string | undefined {
  const file = insideProject(dir, path.startsWith("~/") ? join(homedir(), path.slice(2)) : path)
  try {
    return file && statSync(file).isFile() ? file : undefined
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
