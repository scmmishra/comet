import type { Worktree } from "@comet/protocol"
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { cometHome } from "./data-files"
import { git } from "./git"

/**
 * Git worktrees: more checkouts of one repo, each in its own folder and on its own branch. A tab works in
 * one folder, so a tab in a worktree works there like in any other project. This module finds a folder's
 * main checkout, and creates, lists and removes worktrees.
 */

/** New worktrees go under `~/.comet/worktrees/<repo>/`, outside the repo, so its watchers and searches never see them. */
const worktreesHome = () => join(cometHome(), "worktrees")
/** Every branch Comet makes for a new worktree starts with this. */
const BRANCH_PREFIX = "comet/"
/** A branch name from a message keeps this many characters at most. */
const NAME_LENGTH = 40

/**
 * The folder in the main checkout that matches `dir`. A folder in a worktree, or a subfolder of one, has
 * one in the main checkout. Any other folder is its own. It reads Git's files, not Git, so a tab's save
 * can call it. A worktree's `.git` is a file that points into the main checkout's `.git/worktrees/`.
 */
export function mainCheckout(dir: string): string {
  const root = checkoutRoot(dir)
  if (!root) return dir
  const dotGit = join(root, ".git")
  if (!statSync(dotGit).isFile()) return dir
  const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim()
  if (!gitDir) return dir
  const commonFile = join(resolve(root, gitDir), "commondir")
  if (!existsSync(commonFile)) return dir
  const common = resolve(resolve(root, gitDir), readFileSync(commonFile, "utf8").trim())
  // A bare repo's worktrees have no main checkout.
  if (basename(common) !== ".git") return dir
  return join(dirname(common), relative(root, dir))
}

/**
 * The folder in `checkout`'s checkout of the repo that matches `project`, such as the same subfolder in a
 * worktree. Undefined when `checkout` is not a checkout of `project`'s repo.
 */
export function matchingFolder(project: string, checkout: string): string | undefined {
  const [from, to] = [checkoutRoot(project), checkoutRoot(checkout)]
  if (!from || !to || !samePath(mainCheckout(from), mainCheckout(to))) return undefined
  return join(to, relative(from, project))
}

/** Whether two paths name one folder, though one may go through a link, as /tmp does on a Mac. */
export const samePath = (a: string, b: string) => a === b || real(a) === real(b)

/** The root of the checkout `dir` is in: the nearest folder at or above it that holds a `.git`. Undefined outside a repo. */
export function checkoutRoot(dir: string): string | undefined {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) return at
    if (dirname(at) === at) return undefined
  }
}

const real = (dir: string) => {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

/**
 * The checkouts of `dir`'s repo, the main checkout first, as Git lists them. Each `path` is the folder
 * in that checkout that matches `dir`. A worktree whose folder is gone is left out.
 */
export async function listWorktrees(dir: string): Promise<Worktree[]> {
  const main = mainCheckout(dir)
  const root = checkoutRoot(main)
  if (!root) return []
  const inside = relative(root, main)
  const listed = await git(root, ["worktree", "list", "--porcelain"]).catch(() => "")
  return listed
    .split("\n\n")
    .flatMap((entry, index): Worktree[] => {
      const path = /^worktree (.+)$/m.exec(entry)?.[1]
      if (!path || /^bare$/m.test(entry) || /^prunable/m.test(entry)) return []
      const branch = /^branch refs\/heads\/(.+)$/m.exec(entry)?.[1]
      const folder = index === 0 ? main : join(path, inside)
      // The folder asked about keeps the caller's spelling, so it matches the tab that works there.
      return [{ path: samePath(folder, dir) ? dir : folder, main: index === 0, ...(branch ? { branch } : {}) }]
    })
    .filter((worktree) => existsSync(worktree.path))
}

/**
 * Makes a worktree for `dir`'s repo, on a new branch from what `dir` has checked out. The branch is named
 * from `words`, such as the thread's first message, under `comet/`. Returns the folder in the new worktree
 * that matches `dir`.
 */
export async function createWorktree(dir: string, words: string): Promise<string> {
  const main = mainCheckout(dir)
  const root = checkoutRoot(main)
  if (!root) throw new Error("Comet can make a worktree only in a Git repo.")
  const name = await freeName(root, slug(words))
  const path = join(worktreesHome(), basename(root), name)
  await git(dir, ["worktree", "add", "-b", `${BRANCH_PREFIX}${name}`, path, "HEAD"])
  return join(path, relative(root, main))
}

/**
 * Removes the worktree `dir` is in, and whatever is uncommitted in it, since the user confirmed. Its branch
 * stays, so committed work is kept. The main checkout is never removed.
 */
export async function removeWorktree(dir: string) {
  const main = mainCheckout(dir)
  if (main === dir) throw new Error("This is the repo's main checkout, not a worktree.")
  const root = checkoutRoot(dir)!
  await git(checkoutRoot(main)!, ["worktree", "remove", "--force", root])
}

/** A name from the first words of `text`, for a branch and a folder. A text with no letters gives a short random one. */
export function slug(text: string): string {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  let name = ""
  for (const word of words) {
    const next = name ? `${name}-${word}` : word
    if (next.length > NAME_LENGTH) break
    name = next
  }
  return name || crypto.randomUUID().slice(0, 8)
}

/** `name`, or `name-2`, `name-3` and on, until neither a branch nor a worktree folder has it. */
async function freeName(root: string, name: string): Promise<string> {
  const branches = new Set((await git(root, ["branch", "--format=%(refname:short)"]).catch(() => "")).split("\n"))
  const taken = (candidate: string) => branches.has(`${BRANCH_PREFIX}${candidate}`) || existsSync(join(worktreesHome(), basename(root), candidate))
  let candidate = name
  for (let n = 2; taken(candidate); n++) candidate = `${name}-${n}`
  return candidate
}
