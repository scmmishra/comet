import { expect, test } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { changesSince, snapshot } from "./checkpoints"
import { gitRepo } from "./test-support"

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
