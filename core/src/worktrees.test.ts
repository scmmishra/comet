import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { basename, join } from "node:path"
import { gitRepo, tempFolder, useTempHome } from "./test-support"
import { createWorktree, listWorktrees, mainCheckout, matchingFolder, removeWorktree, samePath, slug } from "./worktrees"

useTempHome()

/** A repo with a subfolder, and a worktree of it on the branch `side`. */
function repoWithWorktree() {
  const repo = gitRepo({ "app/a.ts": "one\n" })
  const worktree = join(tempFolder("worktree"), "side")
  repo.git("worktree", "add", "-q", "-b", "side", worktree)
  return { repo, worktree }
}

test("finds the main checkout of a worktree and of a folder in it, and leaves other folders as they are", () => {
  const { repo, worktree } = repoWithWorktree()
  expect(mainCheckout(repo.dir)).toBe(repo.dir)
  expect(samePath(mainCheckout(worktree), repo.dir)).toBe(true)
  expect(samePath(mainCheckout(join(worktree, "app")), join(repo.dir, "app"))).toBe(true)
  const plain = tempFolder("plain")
  expect(mainCheckout(plain)).toBe(plain)
})

test("matches a folder across checkouts of one repo, and not across repos", () => {
  const { repo, worktree } = repoWithWorktree()
  expect(matchingFolder(join(repo.dir, "app"), worktree)).toBe(join(worktree, "app"))
  expect(samePath(matchingFolder(join(worktree, "app"), repo.dir)!, join(repo.dir, "app"))).toBe(true)
  expect(matchingFolder(repo.dir, gitRepo({ "b.txt": "b\n" }).dir)).toBeUndefined()
})

test("lists the repo's checkouts, the main one first, each at the project's folder", async () => {
  const { repo, worktree } = repoWithWorktree()
  const listed = await listWorktrees(join(worktree, "app"))
  expect(listed.map((found) => [found.main, found.branch])).toEqual([
    [true, "main"],
    [false, "side"],
  ])
  expect(samePath(listed[0]!.path, join(repo.dir, "app"))).toBe(true)
  expect(samePath(listed[1]!.path, join(worktree, "app"))).toBe(true)
  expect(await listWorktrees(tempFolder("plain"))).toEqual([])
})

test("makes a worktree under Desk's folder on a branch named from the words, and a second one beside it", async () => {
  const repo = gitRepo({ "app/a.ts": "one\n" })
  const made = await createWorktree(join(repo.dir, "app"), "Fix the login form!")
  expect(made).toBe(join(process.env.DESK_HOME!, "worktrees", basename(repo.dir), "fix-the-login-form", "app"))
  expect(existsSync(join(made, "a.ts"))).toBe(true)
  expect(repo.git("branch", "--list", "desk/*")).toContain("desk/fix-the-login-form")
  const again = await createWorktree(repo.dir, "Fix the login form")
  expect(basename(again)).toBe("fix-the-login-form-2")
})

test("removes a worktree and keeps its branch, but never the main checkout", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  const made = await createWorktree(repo.dir, "Try it")
  await Bun.write(join(made, "draft.txt"), "uncommitted\n")
  await removeWorktree(made)
  expect(existsSync(made)).toBe(false)
  expect(repo.git("branch", "--list", "desk/try-it")).toContain("desk/try-it")
  expect(removeWorktree(repo.dir)).rejects.toThrow("main checkout")
})

test("names a branch from a message's first words, cut at a word", () => {
  expect(slug("Add tests for the login form, then the signup form")).toBe("add-tests-for-the-login-form-then-the")
  expect(slug("?!")).toMatch(/^[0-9a-f]{8}$/)
})
