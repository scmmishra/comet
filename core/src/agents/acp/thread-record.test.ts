import { expect, test } from "bun:test"
import { tempFolder } from "../../test-support"
import { acpThreads, ThreadRecord } from "./thread-record"

test("saves a session's items once it has an id, lists them by folder, and adds to them on resume", async () => {
  const folder = tempFolder("acp-threads")
  const threads = acpThreads(() => folder)
  const record = new ThreadRecord(folder, "/repo", undefined)
  record.add({ type: "user", id: "u1", text: "Fix the build\nIt fails on CI" })
  record.add({ type: "text", id: "x1", text: "Look", done: false })
  record.add({ type: "text", id: "x1", text: "Looking", done: true })
  record.add({ type: "permission", id: "p1", requestId: "p1", tool: "Bash", kind: "command", detail: "ls", allowSession: false })
  record.save()
  expect(await threads.list("/repo")).toEqual([])
  record.name("s1")
  record.save()
  new ThreadRecord(folder, "/other", undefined).name("s2")

  expect(await threads.list("/repo")).toEqual([{ id: "s1", title: "Fix the build", updatedAt: expect.any(Number) }])
  expect(await threads.list("/other")).toEqual([])
  expect(await threads.history("/repo", "s1")).toEqual([
    { type: "user", id: "u1", text: "Fix the build\nIt fails on CI" },
    { type: "text", id: "x1", text: "Looking", done: true },
  ])

  const resumed = new ThreadRecord(folder, "/repo", "s1")
  resumed.add({ type: "user", id: "u2", text: "Again" })
  resumed.save()
  expect((await threads.history("/repo", "s1")).map((item) => item.id)).toEqual(["u1", "x1", "u2"])

  await threads.delete!("/repo", "s1")
  expect(await threads.list("/repo")).toEqual([])
  expect(await threads.history("/repo", "s1")).toEqual([])
})
