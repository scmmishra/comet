import type { ThreadItem } from "@desk/protocol"
import { expect, test } from "bun:test"
import { threadRows } from "./thread-rows"

const user = (id: string, at?: number): ThreadItem => ({ type: "user", id, text: id, ...(at ? { at } : {}) })
const text = (id: string): ThreadItem => ({ type: "text", id, text: id, done: true })
const thought = (id: string): ThreadItem => ({ type: "thinking", id, text: `${id}.` })
const tool = (id: string, done = true): ThreadItem => ({ type: "tool", id, name: "Bash", summary: id, ...(done ? { result: { output: "", isError: false } } : {}) })
const kinds = (rows: { type: string }[]) => rows.map((row) => row.type)

test("a running turn opens with its head, merges thoughts and tools into groups, and keeps the last group live", () => {
  const rows = threadRows([user("u1", 1000), thought("t1"), tool("a"), thought("t2"), tool("b"), text("x"), thought("t3"), tool("c", false)], true)
  expect(kinds(rows)).toEqual(["user", "working", "group", "text", "group"])
  expect(rows[1]).toEqual({ type: "working", id: "working:u1", since: 1000 })
  expect(rows[2]).toMatchObject({ steps: [{ id: "t1" }, { id: "a" }, { id: "t2" }, { id: "b" }], live: false })
  expect(rows[4]).toMatchObject({ steps: [{ id: "t3" }, { id: "c" }], live: true })
})

test("a running turn with no steps yet shows only its head", () => {
  expect(kinds(threadRows([user("u1")], true))).toEqual(["user", "working"])
})

test("a finished turn folds everything before its answer, text included, and keeps errors and open requests out", () => {
  const items: ThreadItem[] = [
    user("u1"),
    tool("a"),
    text("mid"),
    { type: "error", id: "e", message: "boom" },
    tool("b"),
    text("answer"),
    { type: "result", id: "r", durationMs: 63_000, isError: false, stopped: true },
    user("u2"),
  ]
  const rows = threadRows(items, false)
  expect(kinds(rows)).toEqual(["user", "fold", "error", "text", "user"])
  expect(rows[1]).toMatchObject({ durationMs: 63_000, stopped: true })
  expect(kinds((rows[1] as { rows: { type: string }[] }).rows)).toEqual(["group", "text", "group"])
})

test("a turn of text alone has nothing to fold", () => {
  expect(kinds(threadRows([user("u1"), text("hi")], false))).toEqual(["user", "text"])
})

test("keeps a turn's file summary under its answer, out of the fold", () => {
  const changes: ThreadItem = { type: "changes", id: "c", files: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }] }
  const rows = threadRows([user("u1"), tool("a"), text("answer"), { type: "result", id: "r", durationMs: 1000, isError: false }, changes], false)
  expect(kinds(rows)).toEqual(["user", "fold", "text", "changes"])
})
