import type { FileChange } from "@desk/protocol"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

/**
 * Snapshots of the working tree, so Desk can show what a thread changed. A snapshot is a Git tree
 * built in a temporary index file: the user's index, working tree and refs are never touched.
 * Untracked files that are not ignored are included, because new files are changes too.
 */

async function git(dir: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...env },
  })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${error.trim()}`)
  return output
}

/** The tree of the working tree as it is now, or undefined outside a Git repo. */
export async function snapshot(dir: string): Promise<string | undefined> {
  const scratch = mkdtempSync(join(tmpdir(), "desk-index-"))
  const index = join(scratch, "index")
  const env = { GIT_INDEX_FILE: index }
  try {
    // A copy of the user's index keeps Git's file-stat cache, so `add -A` hashes only changed files.
    // Without one, as in a repo with no commits, the snapshot starts empty.
    const userIndex = (await git(dir, ["rev-parse", "--git-path", "index"])).trim()
    try {
      copyFileSync(isAbsolute(userIndex) ? userIndex : join(dir, userIndex), index)
    } catch {
      await git(dir, ["read-tree", "--empty"], env)
    }
    await git(dir, ["add", "-A"], env)
    return (await git(dir, ["write-tree"], env)).trim()
  } catch {
    return undefined
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** What changed between a snapshot and the working tree now. */
export async function changesSince(dir: string, base: string): Promise<FileChange[]> {
  const current = await snapshot(dir)
  if (!current || current === base) return []
  const [numstat, patch] = await Promise.all([
    git(dir, ["diff", "--numstat", "-M", base, current]),
    git(dir, ["diff", "--no-color", "--no-ext-diff", "-M", base, current]),
  ])
  const patches = splitPatch(patch)
  return numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...rest] = line.split("\t")
      const path = renamedPath(rest.join("\t"))
      const filePatch = patches.get(path) ?? ""
      return {
        path,
        status: fileStatus(filePatch),
        // Binary files show "-" for both counts.
        additions: Number(added) || 0,
        deletions: Number(removed) || 0,
        patch: filePatch,
      }
    })
}

/** numstat writes a rename as `old => new` or `dir/{old => new}/file`. The new path is the one that exists. */
function renamedPath(path: string): string {
  const braces = /\{(.*) => (.*)\}/.exec(path)
  if (braces) return path.replace(braces[0], braces[2]!).replace("//", "/")
  const arrow = path.indexOf(" => ")
  return arrow >= 0 ? path.slice(arrow + 4) : path
}

/** Splits a multi-file patch into one patch per file, keyed by the file's new path. */
export function splitPatch(patch: string): Map<string, string> {
  const files = new Map<string, string>()
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    const header = /^diff --git a\/(.*) b\/(.*)$/m.exec(chunk)
    if (header) files.set(header[2]!, chunk)
  }
  return files
}

function fileStatus(patch: string): FileChange["status"] {
  if (/^new file mode/m.test(patch)) return "added"
  if (/^deleted file mode/m.test(patch)) return "deleted"
  if (/^rename from/m.test(patch)) return "renamed"
  return "modified"
}
