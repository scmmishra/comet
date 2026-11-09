import { expect, test } from "bun:test"
import { parseChanges, readSpace } from "./space"
import { gitRepo, tempFolder } from "./test-support"

test("reads the branch and uncommitted changes of a repo", async () => {
  const repo = gitRepo({ "a.txt": "one\ntwo\n" })
  repo.write("a.txt", "one\nthree\nfour\n")
  repo.write("new.txt", "new\n")
  const space = await readSpace(repo.dir)
  expect(space?.branch).toBe("main")
  expect(space?.changes).toEqual({ files: 2, additions: 2, deletions: 1 })
})

test("is null outside a repo", async () => {
  expect(await readSpace(tempFolder("plain"))).toBeNull()
})

test("counts binary files without line counts", () => {
  expect(parseChanges("-\t-\timage.png\n3\t1\ta.ts\n", "")).toEqual({ files: 2, additions: 3, deletions: 1 })
})
