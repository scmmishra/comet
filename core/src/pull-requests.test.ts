import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ThreadSummary } from "@comet/protocol"
import { forgetPullRequests, sendThreads } from "./pull-requests"
import { tempFolder } from "./test-support"

const path = process.env.PATH
let bin: string
let repo: string

/** A `gh` that answers every query with `answer`, or fails without one, and counts its runs in a file beside it. */
function fakeGh(answer?: object) {
  writeFileSync(join(bin, "answer.json"), JSON.stringify(answer ?? {}))
  const reply = answer ? `cat "${join(bin, "answer.json")}"` : "exit 1"
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho run >> "${join(bin, "runs")}"\n${reply}\n`)
  chmodSync(join(bin, "gh"), 0o755)
}
const runs = () => readFileSync(join(bin, "runs"), "utf8").trim().split("\n").length

const thread = (id: string, branch?: string): ThreadSummary => ({ id, agent: "claude", title: id, ...(branch ? { branch } : {}), updatedAt: 0, project: repo })
const pr = (number: number, isCrossRepository = false) => ({ number, title: `PR ${number}`, url: `https://github.com/me/web/pull/${number}`, isCrossRepository })
const answer = (branches: Record<string, object[]>, defaultBranch = "main") => ({ data: { repository: { defaultBranchRef: { name: defaultBranch }, ...Object.fromEntries(Object.entries(branches).map(([alias, nodes]) => [alias, { nodes }])) } } })

/** What `sendThreads` sends for `threads`, each time it sends them. */
async function sent(threads: ThreadSummary[], list = async () => threads) {
  const replies: ThreadSummary[][] = []
  await sendThreads(repo, list, (found) => replies.push(found))
  return replies
}

beforeEach(() => {
  forgetPullRequests()
  bin = tempFolder("gh")
  repo = tempFolder("repo")
  process.env.PATH = `${bin}:${path}`
})
afterEach(() => {
  process.env.PATH = path
})

test("sends the threads at once, then again with each branch's pull request, but none for the default branch, which forks open theirs from", async () => {
  fakeGh(answer({ b0: [pr(7)], b1: [pr(9, true)] }, "develop"))
  const threads = [thread("a", "feat/search"), thread("b", "develop"), thread("c")]
  const [first, second] = await sent(threads)
  expect(first).toEqual(threads)
  expect(second!.map((t) => t.pr)).toEqual([{ number: 7, title: "PR 7", url: "https://github.com/me/web/pull/7" }, undefined, undefined])
})

test("lists the threads again for the second send, so a rename made while gh ran stays", async () => {
  fakeGh(answer({ b0: [pr(7)] }))
  let title = "Before"
  const replies = await sent([], async () => {
    const listed = [{ ...thread("a", "feat"), title }]
    title = "Renamed"
    return listed
  })
  expect(replies.map((threads) => threads[0]!.title)).toEqual(["Before", "Renamed"])
})

test("prefers the repo's own pull request to a fork's from a branch of the same name", async () => {
  fakeGh(answer({ b0: [pr(12, true), pr(5)] }))
  expect((await sent([thread("a", "fix")]))[1]![0]!.pr?.number).toBe(5)
})

test("sends the known pull requests at once, and asks about a branch once while they are fresh, a branch with no pull request too", async () => {
  fakeGh(answer({ b0: [pr(7)], b1: [] }))
  await sent([thread("a", "feat"), thread("b", "spike")])
  const again = await sent([thread("a", "feat"), thread("b", "spike")])
  expect(again).toHaveLength(1)
  expect(again[0]![0]!.pr?.number).toBe(7)
  expect(runs()).toBe(1)
})

test("sends the threads once when gh fails, and waits before it asks about that repo again", async () => {
  fakeGh()
  expect(await sent([thread("a", "feat")])).toEqual([[thread("a", "feat")]])
  await sent([thread("b", "other")])
  expect(runs()).toBe(1)
})
