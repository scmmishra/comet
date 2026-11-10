import { expect, test } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { branchBase, capture, changesSince, checkpointChanges, headTree, keepCheckpoints, snapshot } from "./checkpoints"
import { gitRepo, tempFolder } from "./test-support"

test("reports what changed since a snapshot, new and deleted files included", async () => {
  const repo = gitRepo({ "a.txt": "one\ntwo\n", "old.txt": "gone\n" })
  const base = await snapshot(repo.dir)
  repo.write("a.txt", "one\nthree\n")
  repo.write("new.txt", "hello\n")
  rmSync(join(repo.dir, "old.txt"))

  const changes = await changesSince(repo.dir, base!)
  expect(changes.map(({ path, status, additions, deletions }) => ({ path, status, additions, deletions }))).toEqual([
    { path: "a.txt", status: "modified", additions: 1, deletions: 1 },
    { path: "new.txt", status: "added", additions: 1, deletions: 0 },
    { path: "old.txt", status: "deleted", additions: 0, deletions: 1 },
  ])
  expect(changes[0]!.patch).toContain("+three")
})

test("reports a renamed file under its new path", async () => {
  const repo = gitRepo({ "src/old-name.ts": "export const a = 1\n".repeat(20) })
  const base = await snapshot(repo.dir)
  repo.git("mv", "src/old-name.ts", "src/new-name.ts")
  const [change] = await changesSince(repo.dir, base!)
  expect(change).toMatchObject({ path: "src/new-name.ts", status: "renamed" })
})

test("leaves the user's index alone", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  repo.write("staged.txt", "staged\n")
  repo.git("add", "staged.txt")
  const indexBefore = readFileSync(join(repo.dir, ".git", "index"))
  await snapshot(repo.dir)
  expect(readFileSync(join(repo.dir, ".git", "index")).equals(indexBefore)).toBe(true)
  expect(repo.git("diff", "--cached", "--name-only")).toBe("staged.txt")
})

test("has no changes when nothing moved", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  const base = await snapshot(repo.dir)
  expect(await changesSince(repo.dir, base!)).toEqual([])
})

test("compares uncommitted work with the last commit, and a branch's work with where it left main", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "feature")
  write("b.ts", "committed on the branch\n")
  git("add", ".")
  git("commit", "-q", "-m", "branch work")
  write("a.ts", "one\ntwo\n")

  const uncommitted = await changesSince(dir, (await headTree(dir))!)
  expect(uncommitted.map((file) => file.path)).toEqual(["a.ts"])
  const branch = await changesSince(dir, (await branchBase(dir))!)
  expect(branch.map((file) => file.path).sort()).toEqual(["a.ts", "b.ts"])
})

test("has no base outside a Git repo", async () => {
  expect(await headTree(tempFolder("plain"))).toBeUndefined()
})

/** Commits everything with a commit time an hour ago, as work done before a turn started. */
function commitEarlier(dir: string, message: string) {
  const env = { ...process.env, GIT_COMMITTER_DATE: `@${Math.floor(Date.now() / 1000) - 3600}` }
  Bun.spawnSync(["git", "add", "-A"], { cwd: dir })
  Bun.spawnSync(["git", "commit", "-q", "-m", message], { cwd: dir, env })
}

// Each edit below changes a file's size. Desk copies the user's index for a snapshot, and Git may take a
// same-size edit made in the second the index was written for an unchanged file.
const paths = (files: readonly { path: string }[]) => files.map((file) => file.path).sort()

test("leaves out the files a switch to a branch built on this one brings in", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "next")
  write("b.ts", "the next pull request\n")
  commitEarlier(dir, "next")
  git("checkout", "-q", "main")
  const from = (await capture(dir))!
  git("checkout", "-q", "next")
  expect(await checkpointChanges(dir, from, (await capture(dir))!)).toEqual([])
})

test("leaves out what a switch brings in, and keeps what the turn wrote, committed or not", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "other")
  write("theirs.ts", "someone else's\n")
  commitEarlier(dir, "theirs")
  git("checkout", "-q", "main")
  const from = (await capture(dir))!
  write("dirty.ts", "uncommitted\n")
  git("checkout", "-q", "other")
  write("mine.ts", "committed in the turn\n")
  git("add", "mine.ts")
  git("commit", "-q", "-m", "mine")
  expect(paths(await checkpointChanges(dir, from, (await capture(dir))!))).toEqual(["dirty.ts", "mine.ts"])
})

test("leaves out a branch merged in cleanly during the turn", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "feature")
  write("feature.ts", "from the feature branch\n")
  commitEarlier(dir, "feature")
  git("checkout", "-q", "main")
  write("main.ts", "on main\n")
  commitEarlier(dir, "main work")
  const from = (await capture(dir))!
  git("merge", "-q", "--no-ff", "-m", "merge feature", "feature")
  expect(await checkpointChanges(dir, from, (await capture(dir))!)).toEqual([])
})

test("keeps every file while HEAD stays put", async () => {
  const { dir, write } = gitRepo({ "a.ts": "one\n" })
  const from = (await capture(dir))!
  write("a.ts", "changed\n")
  expect(paths(await checkpointChanges(dir, from, (await capture(dir))!))).toEqual(["a.ts"])
})

test("chains turns: the next turn starts where the last one ended, and counts edits made between them", async () => {
  const { dir, write } = gitRepo({ "a.ts": "one\n" })
  const start = (await capture(dir))!
  write("a.ts", "turn one\n")
  const first = (await capture(dir))!
  write("between.ts", "the user's edit between turns\n")
  write("b.ts", "turn two\n")
  const second = (await capture(dir))!
  expect(paths(await checkpointChanges(dir, start, first))).toEqual(["a.ts"])
  expect(paths(await checkpointChanges(dir, first, second))).toEqual(["b.ts", "between.ts"])
  expect(paths(await checkpointChanges(dir, start, second))).toEqual(["a.ts", "b.ts", "between.ts"])
})

test("keeps checkpoints from git gc under this Desk's refs, and lets go of those no thread names", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  const kept = (await capture(dir))!
  write("a.ts", "changed\n")
  const dropped = (await capture(dir))!
  git("update-ref", `refs/desk/dev/checkpoints/${dropped}`, dropped)
  expect(git("for-each-ref", "--format=%(refname)", "refs/desk/main/checkpoints/").split("\n").sort()).toEqual([`refs/desk/main/checkpoints/${dropped}`, `refs/desk/main/checkpoints/${kept}`].sort())

  await keepCheckpoints(dir, new Set([kept]))
  expect(git("for-each-ref", "--format=%(refname)", "refs/desk/")).toBe([`refs/desk/dev/checkpoints/${dropped}`, `refs/desk/main/checkpoints/${kept}`].join("\n"))
  // The user's branches and log are untouched.
  expect(git("branch", "--format=%(refname:short)")).toBe("main")
  expect(git("log", "--format=%s")).toBe("init")
})

test("reads paths Git would quote or split", async () => {
  const repo = gitRepo({ "x b/café.ts": "one\n" })
  const base = await snapshot(repo.dir)
  repo.write("x b/café.ts", "changed\n")
  const [change] = await changesSince(repo.dir, base!)
  expect(change).toMatchObject({ path: "x b/café.ts", additions: 1, deletions: 1 })
  expect(change!.patch).toContain("+changed")
})

test("reads the same patch whatever the user's diff settings", async () => {
  const repo = gitRepo({ "a.ts": "one\n\nthree\n" })
  for (const [key, value] of [["diff.noprefix", "true"], ["diff.mnemonicPrefix", "true"], ["diff.suppressBlankEmpty", "true"], ["diff.relative", "true"], ["color.diff", "always"]]) repo.git("config", key!, value!)
  const base = await snapshot(repo.dir)
  repo.write("a.ts", "one\n\n3\n")
  const [change] = await changesSince(repo.dir, base!)
  expect(change).toMatchObject({ path: "a.ts", additions: 1, deletions: 1 })
  // A blank context line stays a single space, so the patch still parses.
  expect(change!.patch).toContain("\n one\n \n-three\n+3")
})

test("lists a changed submodule even when the user asks diffs for its log", async () => {
  const inner = gitRepo({ "lib.ts": "one\n" })
  const repo = gitRepo({ "a.ts": "one\n" })
  repo.git("-c", "protocol.file.allow=always", "submodule", "add", "-q", inner.dir, "vendor")
  repo.git("commit", "-q", "-m", "add submodule")
  repo.git("config", "diff.submodule", "log")
  const base = await snapshot(repo.dir)
  inner.write("lib.ts", "two\n")
  inner.git("commit", "-qam", "two")
  Bun.spawnSync(["git", "pull", "-q"], { cwd: join(repo.dir, "vendor") })
  expect(paths(await changesSince(repo.dir, base!))).toEqual(["vendor"])
})

test("a project in a subfolder of a repo shows only its own files", async () => {
  const { dir, write } = gitRepo({ "app/a.ts": "one\n", "other/b.ts": "one\n" })
  const project = join(dir, "app")
  const from = (await capture(project))!
  write("app/a.ts", "changed\n")
  write("app/new.ts", "new\n")
  write("other/b.ts", "changed\n")
  write("other/new.ts", "new\n")
  expect(paths(await checkpointChanges(project, from, (await capture(project))!))).toEqual(["app/a.ts", "app/new.ts"])
  expect(paths(await changesSince(project, (await headTree(project))!))).toEqual(["app/a.ts", "app/new.ts"])
})
