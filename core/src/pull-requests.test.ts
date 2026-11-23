import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ThreadSummary } from "@comet/protocol"
import { forgetPullRequests, readPullRequests, withPullRequests } from "./pull-requests"
import { tempFolder } from "./test-support"

const path = process.env.PATH
let bin: string
let repo: string

/** A `gh` that answers every query with `answer`, and counts its runs in a file beside it. */
function fakeGh(answer: object) {
  writeFileSync(join(bin, "answer.json"), JSON.stringify(answer))
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho run >> "${join(bin, "runs")}"\ncat "${join(bin, "answer.json")}"\n`)
  chmodSync(join(bin, "gh"), 0o755)
}
const runs = () => readFileSync(join(bin, "runs"), "utf8").trim().split("\n").length

const thread = (id: string, branch?: string): ThreadSummary => ({ id, agent: "claude", title: id, ...(branch ? { branch } : {}), updatedAt: 0, project: repo })
const pr = (number: number, isCrossRepository = false) => ({ number, title: `PR ${number}`, url: `https://github.com/me/web/pull/${number}`, isCrossRepository })

beforeEach(() => {
  forgetPullRequests()
  bin = tempFolder("gh")
  repo = tempFolder("repo")
  process.env.PATH = `${bin}:${path}`
})
afterEach(() => {
  process.env.PATH = path
})

test("finds each branch's pull request, but none for the default branch, which forks open theirs from", async () => {
  fakeGh({ data: { repository: { defaultBranchRef: { name: "develop" }, b0: { nodes: [pr(7)] }, b1: { nodes: [pr(9, true)] } } } })
  const threads = [thread("a", "feat/search"), thread("b", "develop"), thread("c")]
  expect(withPullRequests(repo, threads)).toEqual(threads)
  expect(await readPullRequests(repo, threads)).toBe(true)
  const found = withPullRequests(repo, threads)
  expect(found[0]!.pr).toEqual({ number: 7, title: "PR 7", url: "https://github.com/me/web/pull/7" })
  expect(found[1]!.pr).toBeUndefined()
  expect(found[2]!.pr).toBeUndefined()
})

test("prefers the repo's own pull request to a fork's from a branch of the same name", async () => {
  fakeGh({ data: { repository: { defaultBranchRef: { name: "main" }, b0: { nodes: [pr(12, true), pr(5)] } } } })
  await readPullRequests(repo, [thread("a", "fix")])
  expect(withPullRequests(repo, [thread("a", "fix")])[0]!.pr?.number).toBe(5)
})

test("asks about a branch once while what it learned is fresh, a branch with no pull request too", async () => {
  fakeGh({ data: { repository: { defaultBranchRef: { name: "main" }, b0: { nodes: [] } } } })
  expect(await readPullRequests(repo, [thread("a", "spike")])).toBe(false)
  expect(await readPullRequests(repo, [thread("a", "spike")])).toBe(false)
  expect(runs()).toBe(1)
})

test("learns nothing when gh fails", async () => {
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n")
  chmodSync(join(bin, "gh"), 0o755)
  expect(await readPullRequests(repo, [thread("a", "feat")])).toBe(false)
  expect(withPullRequests(repo, [thread("a", "feat")])[0]!.pr).toBeUndefined()
})
