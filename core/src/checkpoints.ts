import type { FileChange } from "@desk/protocol"
import { copyFileSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { instanceName } from "./data-files"
import { git } from "./git"

/**
 * Checkpoints of the working tree, so Desk can show what a turn or a thread changed, after T3 Code. A
 * snapshot is a Git tree built in a temporary index file, and a checkpoint is a commit of that tree.
 * The user's index, working tree and branches are never touched. Untracked files that are not ignored
 * are included, because new files are changes too. A project in a subfolder of a repo snapshots only
 * its own folder.
 */

/** Git's tree with no files, which a repo with no commits compares with. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/** Who checkpoint commits name as their author, so they never need the user's identity. */
const CHECKPOINT_AUTHOR = { GIT_AUTHOR_NAME: "Desk", GIT_AUTHOR_EMAIL: "desk@localhost", GIT_COMMITTER_NAME: "Desk", GIT_COMMITTER_EMAIL: "desk@localhost" }

/** The most Desk reads of one diff, after T3 Code. A longer file list fails, and a longer patch is cut. */
const MAX_DIFF_BYTES = 10_000_000

/**
 * Settings that change what Git prints, pinned so a user's own config cannot change it: paths from the
 * repo's root and written out as they are, blank context lines kept as a space, and no signature lines
 * in a log.
 */
const GIT_DEFAULTS = ["-c", "diff.relative=false", "-c", "core.quotePath=false", "-c", "diff.suppressBlankEmpty=false", "-c", "log.showSignature=false"]

/** The tree of the project's folder as it is now, or undefined outside a Git repo. */
export async function snapshot(dir: string): Promise<string | undefined> {
  const scratch = mkdtempSync(join(tmpdir(), "desk-index-"))
  const index = join(scratch, "index")
  const env = { GIT_INDEX_FILE: index }
  try {
    // A copy of the user's index keeps Git's file-stat cache, so `add` hashes only changed files.
    // Without one, as in a repo with no commits, the snapshot starts empty.
    const userIndex = (await git(dir, ["rev-parse", "--git-path", "index"])).trim()
    try {
      const source = isAbsolute(userIndex) ? userIndex : join(dir, userIndex)
      copyFileSync(source, index)
      // Git trusts a file's cached stat when the file is older than the index. A copy is newer than its
      // source, so a same-size edit made in the second the user's index was written would look unchanged.
      // Dating the copy a second before its source makes Git check those files, after T3 Code.
      const { mtimeMs } = statSync(source)
      utimesSync(index, new Date(mtimeMs - 1000), new Date(mtimeMs - 1000))
    } catch {
      await git(dir, ["read-tree", "--empty"], { env })
    }
    await git(dir, ["add", "-A", "--", "."], { env })
    return (await git(dir, ["write-tree"], { env })).trim()
  } catch {
    return undefined
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

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

/** Where Desk's checkpoint refs live. Each Desk instance keeps its own, so one never removes another's. */
const refPrefix = () => `refs/desk/${instanceName()}/checkpoints/`

/**
 * Takes a checkpoint of the project and returns its commit, or undefined outside a Git repo. The commit
 * holds a snapshot, its parent is HEAD at the time and its date is when it was taken, so it records
 * where history stood. A ref keeps it from `git gc`.
 */
export async function capture(dir: string): Promise<string | undefined> {
  const tree = await snapshot(dir)
  if (!tree) return undefined
  try {
    const head = (await git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "")).trim()
    const commit = (await git(dir, ["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", "Desk checkpoint"], { env: CHECKPOINT_AUTHOR })).trim()
    await git(dir, ["update-ref", `${refPrefix()}${commit}`, commit])
    return commit
  } catch {
    return undefined
  }
}

/** Removes the refs of this Desk's checkpoints in a project that `keep` does not name, so Git may prune them. */
export async function keepCheckpoints(dir: string, keep: ReadonlySet<string>): Promise<void> {
  const refs = (await git(dir, ["for-each-ref", "--format=%(refname)", refPrefix()])).split("\n").filter(Boolean)
  const stale = refs.filter((ref) => !keep.has(ref.slice(refPrefix().length)))
  if (stale.length) await git(dir, ["update-ref", "--stdin"], { input: stale.map((ref) => `delete ${ref}\n`).join("") })
}

/**
 * What changed between two checkpoints, without the files Git brought in. When HEAD moved between them,
 * as after a branch switch, a pull or a rebase, the two snapshots also differ in every file the new
 * commits touch. Only the files the work in between could have written stay, after T3 Code.
 */
export async function checkpointChanges(dir: string, from: string, to: string): Promise<FileChange[]> {
  const [fromInfo, toInfo] = (await git(dir, ["log", "--no-walk=unsorted", "--format=%P %ct", from, to])).trimEnd().split("\n")
  const [startHead = "", startedAt = ""] = (fromInfo ?? "").split(" ")
  const [endHead = ""] = (toInfo ?? "").split(" ")
  const files = await treeChanges(dir, `${from}^{tree}`, `${to}^{tree}`)
  if (!startHead || !endHead || startHead === endHead) return files.map(withoutPreviousPath)
  // A failed read keeps no file: an empty summary is better than one listing a whole branch.
  const written = await writtenPaths(dir, { from, startHead, startedAt, to, endHead }).catch(() => new Set<string>())
  return files.filter((file) => written.has(file.path) || (file.previousPath !== undefined && written.has(file.previousPath))).map(withoutPreviousPath)
}

/**
 * The files the work between two checkpoints could have written while HEAD moved from `startHead` to
 * `endHead`: those uncommitted at either checkpoint, and those touched by commits made after the first
 * checkpoint, on either side of the move. Older commits are not the turn's work: those HEAD reached, such
 * as a pulled branch's, and those it left behind, such as the branch a turn switched off. T3 Code counts
 * every commit left behind, so a switch off a branch lists that branch's whole history. A merge commit
 * counts only for the files it had to fix by hand, so a clean merge of another branch brings in nothing.
 */
async function writtenPaths(dir: string, points: { from: string; startHead: string; startedAt: string; to: string; endHead: string }): Promise<Set<string>> {
  const { from, startHead, startedAt, to, endHead } = points
  const lists = await Promise.all([
    pathsOf(dir, ["diff", startHead, from]),
    pathsOf(dir, ["diff", endHead, to]),
    pathsOf(dir, ["log", "--format=", "--diff-merges=remerge", `--since=@${startedAt}`, `${endHead}..${startHead}`]),
    pathsOf(dir, ["log", "--format=", "--diff-merges=remerge", `--since=@${startedAt}`, `${startHead}..${endHead}`]),
  ])
  return new Set(lists.flat())
}

/** The paths a diff or log command touches, with rename detection off so both names of a moved file show. */
async function pathsOf(dir: string, args: readonly string[]): Promise<string[]> {
  const output = await git(dir, [...GIT_DEFAULTS, ...args, "--name-only", "-z", "--no-renames", "--no-ext-diff"], { maxBytes: MAX_DIFF_BYTES })
  return output.split("\0").filter(Boolean)
}

const withoutPreviousPath = ({ previousPath: _previous, ...file }: TreeChange): FileChange => file

/** What changed between a snapshot or commit and the working tree now. */
export async function changesSince(dir: string, base: string): Promise<FileChange[]> {
  const current = await snapshot(dir)
  if (!current || current === base) return []
  return (await treeChanges(dir, base, current)).map(withoutPreviousPath)
}

/** A file's change between two trees, with the path it had before when Git saw it renamed. */
type TreeChange = FileChange & { readonly previousPath?: string }

/**
 * Each file in the project's folder that differs between two trees, with its counts and its patch. A
 * submodule shows as one line of commits, so its entry keeps its `diff --git` header.
 */
async function treeChanges(dir: string, from: string, to: string): Promise<TreeChange[]> {
  const flags = ["-M", "--no-ext-diff", "--no-textconv", "--submodule=short"]
  const [numstat, patch] = await Promise.all([
    git(dir, [...GIT_DEFAULTS, "diff", "--numstat", "-z", ...flags, from, to, "--", "."], { maxBytes: MAX_DIFF_BYTES }),
    git(dir, [...GIT_DEFAULTS, "diff", "--no-color", ...flags, "--src-prefix=a/", "--dst-prefix=b/", from, to, "--", "."], { maxBytes: MAX_DIFF_BYTES, overflow: "truncate" }),
  ])
  const patches = splitPatch(patch)
  return numstatEntries(numstat).map(({ additions, deletions, path, previousPath }) => {
    const filePatch = patches.get(path) ?? ""
    return { path, status: fileStatus(filePatch), additions, deletions, patch: filePatch, ...(previousPath === undefined ? {} : { previousPath }) }
  })
}

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
