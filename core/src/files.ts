import { statSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

/** The editor command, which takes `path:line`. Zed's CLI does; set DESK_EDITOR for another. */
const EDITOR = process.env.DESK_EDITOR ?? "zed"

/**
 * Resolves a path from a reply to a file inside the space. The path comes from model output, so
 * anything outside the space, or anything that is not a regular file, is refused.
 */
export function resolveSpaceFile(dir: string, path: string): string | undefined {
  const expanded = path.startsWith("~/") ? resolve(process.env.HOME ?? "", path.slice(2)) : path
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(dir, expanded)
  const inside = relative(dir, absolute)
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return undefined
  try {
    return statSync(absolute).isFile() ? absolute : undefined
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
