import { existsSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"

/** Whether a folder can be a project: an absolute path to a directory that exists. */
export function isProjectFolder(dir: string) {
  return isAbsolute(dir) && existsSync(dir) && statSync(dir).isDirectory()
}

export function requireProjectFolder(dir: string) {
  if (!isProjectFolder(dir)) throw new Error(`Comet cannot open ${dir}: it is not a folder.`)
}

/**
 * A path inside a project, as an absolute path. A relative path is read from the project's folder.
 * Paths come from the app or from model output, so anything outside the project is refused.
 */
export function insideProject(dir: string, path: string): string | undefined {
  const absolute = resolve(dir, path)
  const inside = relative(dir, absolute)
  return inside && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) ? absolute : undefined
}
