import { expect, test } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { branchBase, changesSince, checkpoint, headTree, snapshot, workSince } from "./checkpoints"
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

test("leaves out the files a switch to a branch built on this one brings in", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "next")
  write("b.ts", "the next pull request\n")
  commitEarlier(dir, "next")
  git("checkout", "-q", "main")
  const start = (await checkpoint(dir))!
  git("checkout", "-q", "next")
  expect(await workSince(dir, start)).toEqual([])
})

test("leaves out what a pull or a switch brings in, and keeps what the work wrote", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "other")
  write("theirs.ts", "someone else's\n")
  commitEarlier(dir, "theirs")
  git("checkout", "-q", "main")
  const start = (await checkpoint(dir))!
  write("dirty.ts", "uncommitted\n")
  git("checkout", "-q", "other")
  write("mine.ts", "committed in the turn\n")
  git("add", "mine.ts")
  git("commit", "-q", "-m", "mine")
  expect((await workSince(dir, start)).map((file) => file.path).sort()).toEqual(["dirty.ts", "mine.ts"])
})

test("keeps every file while HEAD stays put", async () => {
  const { dir, write } = gitRepo({ "a.ts": "one\n" })
  const start = (await checkpoint(dir))!
  write("a.ts", "two\n")
  expect((await workSince(dir, start)).map((file) => file.path)).toEqual(["a.ts"])
})

test("reads paths Git would quote or split", async () => {
  const repo = gitRepo({ "x b/café.ts": "one\n" })
  const base = await snapshot(repo.dir)
  repo.write("x b/café.ts", "two\n")
  const [change] = await changesSince(repo.dir, base!)
  expect(change).toMatchObject({ path: "x b/café.ts", additions: 1, deletions: 1 })
  expect(change!.patch).toContain("+two")
})
