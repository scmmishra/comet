import type { FileChange } from "@desk/protocol"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { git, numstatLine } from "./git"

/**
 * Snapshots of the working tree, so Desk can show what a thread changed. A snapshot is a Git tree
 * built in a temporary index file: the user's index, working tree and refs are never touched.
 * Untracked files that are not ignored are included, because new files are changes too.
 */

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

/** Git's tree with no files, which a repo with no commits compares with. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/** The last commit's tree, for uncommitted changes. A repo with no commits compares with no files. Undefined outside a Git repo. */
export async function headTree(dir: string): Promise<string | undefined> {
  try {
    await git(dir, ["rev-parse", "--git-dir"])
  } catch {
    return undefined
  }
  return (await git(dir, ["rev-parse", "HEAD^{tree}"]).catch(() => EMPTY_TREE)).trim()
}

/**
 * Where the branch left the default branch, for the branch's changes: the merge base with the remote's
 * default branch, else with a local main or master. On the default branch itself, or without one, it is
 * the last commit, so the branch's changes are its uncommitted ones.
 */
export async function branchBase(dir: string): Promise<string | undefined> {
  const remoteHead = (await git(dir, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")).trim()
  for (const candidate of [remoteHead, "main", "master"].filter(Boolean)) {
    const base = (await git(dir, ["merge-base", "HEAD", candidate]).catch(() => "")).trim()
    if (base) return base
  }
  return headTree(dir)
}

/** What changed between a snapshot or commit and the working tree now. */
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
      const { additions, deletions, path: named } = numstatLine(line)
      const path = renamedPath(named)
      const filePatch = patches.get(path) ?? ""
      return { path, status: fileStatus(filePatch), additions, deletions, patch: filePatch }
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
function splitPatch(patch: string): Map<string, string> {
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
