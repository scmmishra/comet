import type { FileView } from "@desk/protocol"
import { closeSync, openSync, readSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"
import { spawn } from "./environment"
import { projectFiles } from "./project-files"

/** The most of a file the panel shows. A longer file shows its start. */
const MAX_VIEW_BYTES = 1_000_000
/** How much of a file is looked at to tell text from binary. Git looks at the same amount. */
const SNIFF_BYTES = 8000

/** The editor command, which takes `path:line`. Zed's CLI does. DESK_EDITOR names another. */
const editor = () => process.env.DESK_EDITOR ?? "zed"

/** A path as a reply names it, made absolute: a relative path is in the project, and ~/ is the home folder. */
function namedPath(dir: string, path: string): string {
  return resolve(dir, path.startsWith("~/") ? join(homedir(), path.slice(2)) : path)
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * A file a reply names, to show in the panel or open in the editor. A relative path is in the project,
 * and ~/ is the home folder. It may lie outside the project, such as a report an agent wrote to a
 * temporary folder. Only a regular file is opened: the path comes from model output, so a folder, an app
 * or a missing file is refused.
 */
export function openableFile(dir: string, path: string): string | undefined {
  const file = namedPath(dir, path)
  return isFile(file) ? file : undefined
}

/**
 * The absolute path of the file a reply names. Agents often cite a file by a shorter path, such as one
 * relative to a package, or by its name alone. So when a plain relative path names no file, the project's
 * one file whose path ends with it is the file, as T3 Code finds it. With no such file, or several, the
 * path stays as written, and the panel says no file is there.
 */
export async function findNamedFile(dir: string, path: string): Promise<string> {
  const literal = namedPath(dir, path)
  if (isFile(literal) || !isPlainRelative(path)) return literal
  // In a project inside a repo, a path from the repo's root repeats the project's folders.
  const repeated = withoutProjectFolders(dir, path)
  if (repeated && isFile(join(dir, repeated))) return join(dir, repeated)
  const tail = `/${path}`
  // Git lists a tracked file deleted from the disk, so each match is checked.
  const matches = (await projectFiles(dir)).filter((file) => `/${file}`.endsWith(tail)).map((file) => join(dir, file)).filter(isFile)
  return matches.length === 1 ? matches[0]! : literal
}

/** A path that names its folder only from the project, with no `/`, `~/`, `./` or `../` to fix where it starts. */
function isPlainRelative(path: string): boolean {
  return !/^(\/|~\/|\.{1,2}\/)/.test(path) && !path.endsWith("/")
}

/** `packages/web/src/a.ts` in the project `…/packages/web` is `src/a.ts`. Undefined when the path repeats no folders. */
function withoutProjectFolders(dir: string, path: string): string | undefined {
  const folders = dir.split(sep).filter(Boolean)
  const parts = path.split("/")
  for (let count = Math.min(folders.length, parts.length - 1); count > 0; count--) {
    if (folders.slice(-count).every((folder, i) => folder === parts[i])) return parts.slice(count).join("/")
  }
  return undefined
}

/**
 * Reads a file for the panel. A path with no file, or with a folder, is missing. A file with a NUL byte
 * near its start is binary and shows no text, as Git decides. A large file shows its first megabyte, cut
 * on a line.
 */
export function readForView(dir: string, path: string): FileView {
  const file = openableFile(dir, path)
  if (!file) return { path: namedPath(dir, path), missing: true }
  const size = statSync(file).size
  const bytes = Buffer.alloc(Math.min(size, MAX_VIEW_BYTES))
  const handle = openSync(file, "r")
  try {
    readSync(handle, bytes, 0, bytes.length, 0)
  } finally {
    closeSync(handle)
  }
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return { path: file, binary: true }
  const text = bytes.toString("utf8")
  if (size <= MAX_VIEW_BYTES) return { path: file, text }
  return { path: file, text: text.slice(0, text.lastIndexOf("\n") + 1), truncated: true }
}

/** Opens a file in the editor at a line. Without the editor, macOS opens it in the default text editor. */
export function openInEditor(file: string, line?: number) {
  const target = line ? `${file}:${line}` : file
  try {
    spawn([editor(), target], { stdout: "ignore", stderr: "ignore" })
  } catch {
    // `open -t` always opens a text editor, so a script never runs from here.
    spawn(["open", "-t", file], { stdout: "ignore", stderr: "ignore" })
  }
}
