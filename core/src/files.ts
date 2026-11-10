import type { FileView } from "@desk/protocol"
import { closeSync, openSync, readSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

/** The editor command, which takes `path:line`. Zed's CLI does; set DESK_EDITOR for another. */
const EDITOR = process.env.DESK_EDITOR ?? "zed"

/**
 * A file a reply names, to show in the panel or open in the editor. A relative path is in the project, and ~/ is the home
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

/** The most of a file the panel shows. A longer file shows its start. */
const MAX_VIEW_BYTES = 1_000_000
/** How much of a file is looked at to tell text from binary. Git looks at the same amount. */
const SNIFF_BYTES = 8000

/**
 * Reads a file for the panel. A file with a NUL byte near its start is binary and shows no text, as Git
 * decides. A large file shows its first megabyte, cut on a line.
 */
export function readForView(file: string): FileView {
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
    Bun.spawn([EDITOR, target], { stdout: "ignore", stderr: "ignore" })
  } catch {
    // `open -t` always opens a text editor, so a script never runs from here.
    Bun.spawn(["open", "-t", file], { stdout: "ignore", stderr: "ignore" })
  }
}
