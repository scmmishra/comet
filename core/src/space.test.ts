import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseChanges, readSpace } from "./space"

const repo = mkdtempSync(join(tmpdir(), "desk-space-"))
afterAll(() => rmSync(repo, { recursive: true, force: true }))

const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "ignore", stderr: "ignore" })

test("reads the branch and uncommitted changes of a repo", async () => {
  git("init", "-q", "-b", "main")
  git("config", "user.email", "desk@example.com")
  git("config", "user.name", "Desk")
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n")
  git("add", ".")
  git("commit", "-q", "-m", "init")
  writeFileSync(join(repo, "a.txt"), "one\nthree\nfour\n")
  writeFileSync(join(repo, "new.txt"), "new\n")

  const space = await readSpace(repo)
  expect(space?.branch).toBe("main")
  expect(space?.changes).toEqual({ files: 2, additions: 2, deletions: 1 })
  expect(space?.pr).toBeUndefined()
})

test("returns nothing outside a repo", async () => {
  expect(await readSpace(tmpdir())).toBeUndefined()
})

test("counts binary files without line counts", () => {
  expect(parseChanges("-\t-\timage.png\n3\t1\ta.ts\n", "")).toEqual({ files: 2, additions: 3, deletions: 1 })
})
