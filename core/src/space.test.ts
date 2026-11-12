import { expect, test } from "bun:test"
import { join } from "node:path"
import { readSpace } from "./space"
import { gitRepo, tempFolder } from "./test-support"

test("reads the branch and uncommitted changes of a repo, a new file's lines included", async () => {
  const repo = gitRepo({ "a.txt": "one\ntwo\n" })
  repo.write("a.txt", "one\nthree\nfour\n")
  repo.write("new.txt", "new\n")
  const space = await readSpace(repo.dir)
  expect(space?.branch).toBe("main")
  expect(space?.changes).toEqual({ files: 2, additions: 3, deletions: 1 })
})

test("counts staged files before the first commit", async () => {
  const dir = tempFolder("fresh")
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: dir })
  git("init", "-q", "-b", "main")
  await Bun.write(join(dir, "a.txt"), "one\n")
  await Bun.write(join(dir, "b.txt"), "one\ntwo\n")
  git("add", ".")
  const space = await readSpace(dir)
  expect(space?.changes).toEqual({ files: 2, additions: 3, deletions: 0 })
})

test("a project in a subfolder counts only its own folder, as Review does", async () => {
  const repo = gitRepo({ "app/a.ts": "one\n", "web/b.ts": "one\n" })
  repo.write("app/a.ts", "two\n")
  repo.write("web/b.ts", "two\n")
  repo.write("web/new.ts", "new\n")
  expect((await readSpace(join(repo.dir, "app")))?.changes).toEqual({ files: 1, additions: 1, deletions: 1 })
})

test("counts a binary file without lines", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  repo.write("image.png", "\u0000\u0001binary")
  expect((await readSpace(repo.dir))?.changes).toEqual({ files: 1, additions: 0, deletions: 0 })
})

test("is null outside a repo", async () => {
  expect(await readSpace(tempFolder("plain"))).toBeNull()
})
