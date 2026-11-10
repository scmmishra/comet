import type { FileChange } from "@desk/protocol"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { git } from "./git"

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

/** The commit HEAD points to, or undefined outside a Git repo or before its first commit. */
export async function headCommit(dir: string): Promise<string | undefined> {
  return (await git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "")).trim() || undefined
}

/** Where a turn or a thread started: a snapshot of the working tree, the commit HEAD pointed to, and when. */
export interface Checkpoint {
  readonly tree: string
  /** Absent in a repo with no commits yet. */
  readonly head?: string
  /** Milliseconds since the epoch. */
  readonly at: number
}

/** A checkpoint of the working tree as it is now, or undefined outside a Git repo. */
export async function checkpoint(dir: string): Promise<Checkpoint | undefined> {
  // Taken before the snapshot, so a commit made while the snapshot runs counts as after it.
  const at = Date.now()
  const [tree, head] = await Promise.all([snapshot(dir), headCommit(dir)])
  return tree ? { tree, ...(head ? { head } : {}), at } : undefined
}

/**
 * What changed since a checkpoint, without the files Git brought in. When HEAD moved, as after a
 * branch switch, a pull or a rebase, the two trees also differ in every file the new commits touch.
 * Only the files the work since the checkpoint could have written stay, after T3 Code.
 */
export async function workSince(dir: string, start: Checkpoint): Promise<FileChange[]> {
  const [current, head] = await Promise.all([snapshot(dir), headCommit(dir)])
  if (!current || current === start.tree) return []
  const files = await treeChanges(dir, start.tree, current)
  if (!start.head || !head || head === start.head) return files.map(({ previousPath: _previous, ...file }) => file)
  // A failed read keeps no file: an empty summary is better than one listing a whole branch.
  const written = await writtenPaths(dir, start, head, current).catch(() => new Set<string>())
  return files.filter((file) => written.has(file.path) || (file.previousPath !== undefined && written.has(file.previousPath))).map(({ previousPath: _previous, ...file }) => file)
}

/**
 * The files the work between two points could have written while HEAD moved from `start.head` to
 * `head`: those uncommitted at either end, those the commits HEAD left behind touched, and those
 * touched by commits made after the start. Commits HEAD reached that are older than the start, such
 * as a pulled branch's, are someone else's. A merge commit counts only for the files it had to fix by
 * hand, so a clean merge of another branch brings in nothing.
 */
async function writtenPaths(dir: string, start: Checkpoint, head: string, tree: string): Promise<Set<string>> {
  const lists = await Promise.all([
    pathsOf(dir, ["diff", start.head!, start.tree]),
    pathsOf(dir, ["diff", head, tree]),
    pathsOf(dir, ["log", "--format=", "--diff-merges=remerge", `${head}..${start.head}`]),
    pathsOf(dir, ["log", "--format=", "--diff-merges=remerge", `--since=@${Math.floor(start.at / 1000)}`, `${start.head}..${head}`]),
  ])
  return new Set(lists.flat())
}

/** The paths a diff or log command touches, with rename detection off so both names of a moved file show. */
async function pathsOf(dir: string, args: readonly string[]): Promise<string[]> {
  const output = await git(dir, [...GIT_DEFAULTS, ...args, "--name-only", "-z", "--no-renames", "--no-ext-diff"])
  return output.split("\0").filter(Boolean)
}

/** What changed between a snapshot or commit and the working tree now. */
export async function changesSince(dir: string, base: string): Promise<FileChange[]> {
  const current = await snapshot(dir)
  if (!current || current === base) return []
  return (await treeChanges(dir, base, current)).map(({ previousPath: _previous, ...file }) => file)
}

/** A file's change between two trees, with the path it had before when Git saw it renamed. */
type TreeChange = FileChange & { readonly previousPath?: string }

/** Each file that differs between two trees, with its counts and its patch. */
async function treeChanges(dir: string, from: string, to: string): Promise<TreeChange[]> {
  const [numstat, patch] = await Promise.all([
    git(dir, [...GIT_DEFAULTS, "diff", "--numstat", "-z", "-M", "--no-ext-diff", "--no-textconv", from, to]),
    git(dir, [...GIT_DEFAULTS, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", "--src-prefix=a/", "--dst-prefix=b/", from, to]),
  ])
  const patches = splitPatch(patch)
  return numstatEntries(numstat).map(({ additions, deletions, path, previousPath }) => {
    const filePatch = patches.get(path) ?? ""
    return { path, status: fileStatus(filePatch), additions, deletions, patch: filePatch, ...(previousPath === undefined ? {} : { previousPath }) }
  })
}

/**
 * Settings that change what Git prints, pinned so a user's own config cannot change it: paths from the
 * repo's root and written out as they are, and no signature lines in a log.
 */
const GIT_DEFAULTS = ["-c", "diff.relative=false", "-c", "core.quotePath=false", "-c", "log.showSignature=false"]

/** `git diff --numstat -z`: each entry is `added\tremoved\tpath`, or for a rename `added\tremoved\t`, then the old and the new path. */
function numstatEntries(output: string): { additions: number; deletions: number; path: string; previousPath?: string }[] {
  const fields = output.split("\0")
  const entries = []
  for (let index = 0; index < fields.length; index++) {
    const [added, removed, path] = fields[index]!.split("\t")
    if (path === undefined) continue
    const counts = { additions: Number(added) || 0, deletions: Number(removed) || 0 }
    if (path) entries.push({ ...counts, path })
    else {
      entries.push({ ...counts, previousPath: fields[index + 1]!, path: fields[index + 2]! })
      index += 2
    }
  }
  return entries
}

/** Splits a multi-file patch into one patch per file, keyed by the file's new path. */
function splitPatch(patch: string): Map<string, string> {
  const files = new Map<string, string>()
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    const path = patchPath(chunk)
    if (path !== undefined) files.set(path, chunk)
  }
  return files
}

/**
 * The new path of one file's patch. A rename names it on its own line. Otherwise the header names the
 * same path twice, as `a/<path> b/<path>`, so its second half is the path even when the path holds " b/".
 */
function patchPath(chunk: string): string | undefined {
  const renamed = /^rename to (.*)$/m.exec(chunk)
  if (renamed) return renamed[1]
  const header = /^diff --git a\/(.*)$/m.exec(chunk)?.[1]
  if (header === undefined) return undefined
  return header.slice((header.length - " b/".length) / 2 + " b/".length)
}

function fileStatus(patch: string): FileChange["status"] {
  if (/^new file mode/m.test(patch)) return "added"
  if (/^deleted file mode/m.test(patch)) return "deleted"
  if (/^rename from/m.test(patch)) return "renamed"
  return "modified"
}
