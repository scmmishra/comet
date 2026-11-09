import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changesSince, snapshot } from "./checkpoints"

const repo = mkdtempSync(join(tmpdir(), "desk-checkpoints-"))
afterAll(() => rmSync(repo, { recursive: true, force: true }))
const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "ignore" })

test("reports what changed since a snapshot, new files included", async () => {
  git("init", "-q", "-b", "main")
  git("config", "user.email", "desk@example.com")
  git("config", "user.name", "Desk")
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n")
  writeFileSync(join(repo, "old.txt"), "gone\n")
  git("add", ".")
  git("commit", "-q", "-m", "init")

  const base = await snapshot(repo)
  expect(base).toBeString()

  writeFileSync(join(repo, "a.txt"), "one\nthree\n")
  writeFileSync(join(repo, "new.txt"), "hello\n")
  rmSync(join(repo, "old.txt"))

  const changes = await changesSince(repo, base!)
  expect(changes.map(({ path, status, additions, deletions }) => ({ path, status, additions, deletions }))).toEqual([
    { path: "a.txt", status: "modified", additions: 1, deletions: 1 },
    { path: "new.txt", status: "added", additions: 1, deletions: 0 },
    { path: "old.txt", status: "deleted", additions: 0, deletions: 1 },
  ])
  expect(changes[0]!.patch).toContain("+three")
})

test("leaves the user's index alone", async () => {
  writeFileSync(join(repo, "staged.txt"), "staged\n")
  git("add", "staged.txt")
  const indexBefore = readFileSync(join(repo, ".git", "index"))
  await snapshot(repo)
  expect(readFileSync(join(repo, ".git", "index")).equals(indexBefore)).toBe(true)
  expect(new TextDecoder().decode(git("diff", "--cached", "--name-only").stdout).trim()).toBe("staged.txt")
})

test("has no changes when nothing moved", async () => {
  const base = await snapshot(repo)
  expect(await changesSince(repo, base!)).toEqual([])
})
