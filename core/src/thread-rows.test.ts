import type { ThreadItem, ThreadRow } from "@desk/protocol"
import { expect, test } from "bun:test"
import { toolStep } from "./agents/claude/steps"
import { thought as thoughtStep } from "./steps"
import { ThreadRows, threadRows } from "./thread-rows"

const user = (id: string, at?: number): ThreadItem => ({ type: "user", id, text: id, ...(at ? { at } : {}) })
const text = (id: string): ThreadItem => ({ type: "text", id, text: id, done: true })
const thought = (id: string): ThreadItem => thoughtStep(id, `${id}.`)
const tool = (id: string, done = true): ThreadItem => toolStep({ type: "tool", id, name: "Bash", summary: id, ...(done ? { result: { output: "", isError: false } } : {}) })

/** Each row's kind, with an item row named by its item's type. */
const kinds = (rows: readonly { type: string; id: string }[], items: readonly ThreadItem[]) =>
  rows.map((row) => (row.type === "item" ? items.find((item) => item.id === row.id)!.type : row.type))

const laidOut = (items: ThreadItem[], busy: boolean) => kinds(threadRows(items, busy), items)

test("a running turn opens with its head, merges thoughts and tools into groups, and keeps the last group live", () => {
  const rows = threadRows([user("u1", 1000), thought("t1"), tool("a"), thought("t2"), tool("b"), text("x"), thought("t3"), tool("c", false)], true)
  expect(rows.map((row) => row.type)).toEqual(["item", "working", "group", "item", "group"])
  expect(rows[1]).toEqual({ type: "working", id: "working:u1", since: 1000 })
  expect(rows[2]).toEqual({ type: "group", id: "group:t1", steps: ["t1", "a", "t2", "b"], live: false, summary: "Ran 2 commands" })
  expect(rows[4]).toEqual({ type: "group", id: "group:t3", steps: ["t3", "c"], live: true, summary: "Ran a command" })
})

test("a running turn with no steps yet shows only its head", () => {
  expect(laidOut([user("u1")], true)).toEqual(["user", "working"])
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
  expect(kinds(rows, items)).toEqual(["user", "fold", "error", "text", "user"])
  expect(rows[1]).toMatchObject({ id: "fold:u1", durationMs: 63_000, stopped: true })
  expect(kinds((rows[1] as Extract<ThreadRow, { type: "fold" }>).rows, items)).toEqual(["group", "text", "group"])
})

test("a turn of text alone has nothing to fold", () => {
  expect(laidOut([user("u1"), text("hi")], false)).toEqual(["user", "text"])
})

test("keeps a turn's file summary under its answer, out of the fold", () => {
  const changes: ThreadItem = { type: "changes", id: "c", files: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }] }
  expect(laidOut([user("u1"), tool("a"), text("answer"), { type: "result", id: "r", durationMs: 1000, isError: false }, changes], false)).toEqual(["user", "fold", "text", "changes"])
})

test("shows a permission request only while it waits, and Claude's questions never, as they show in the composer", () => {
  const permission = (answered?: boolean): ThreadItem => ({ type: "permission", id: "p", requestId: "p", tool: "Bash", kind: "command", detail: "ls", allowSession: true, ...(answered ? { answered } : {}) })
  const question: ThreadItem = { type: "question", id: "q", requestId: "q", questions: [] }
  expect(laidOut([user("u1"), tool("a"), permission(), question, text("answer")], false)).toEqual(["user", "fold", "permission", "text"])
  expect(laidOut([user("u1"), tool("a"), permission(true), question, text("answer")], false)).toEqual(["user", "fold", "text"])
})

test("keeps a compaction out of the fold, as a line in the thread", () => {
  const compaction: ThreadItem = { type: "compaction", id: "c", status: "done", preTokens: 180_000, postTokens: 32_000 }
  expect(laidOut([user("u1"), tool("a"), compaction, tool("b"), text("answer")], false)).toEqual(["user", "fold", "compaction", "text"])
})

test("shows a /compact turn as its compaction alone, running or done", () => {
  const compact: ThreadItem = { type: "user", id: "u2", text: "/compact keep the plan" }
  const running: ThreadItem = { type: "compaction", id: "c", status: "running" }
  expect(laidOut([user("u1"), text("hi"), compact, running], true)).toEqual(["user", "text", "compaction"])
  const done: ThreadItem = { ...running, status: "done" } as ThreadItem
  expect(laidOut([user("u1"), text("hi"), compact, done, user("u3")], false)).toEqual(["user", "text", "compaction", "user"])
  // A message that only mentions compacting is an ordinary turn.
  expect(laidOut([{ type: "user", id: "u4", text: "/compactor docs" }, text("ok")], false)).toEqual(["user", "text"])
})

test("sends rows after every history, and after an event only when they change", () => {
  const rows = new ThreadRows()
  expect(rows.after({ type: "session.history", tabId: "t", items: [user("u1"), text("hi")] })).toEqual({ type: "session.rows", tabId: "t", rows: [{ type: "item", id: "u1" }, { type: "item", id: "hi" }] })
  // The same items again still answer, for a client that connects later.
  expect(rows.after({ type: "session.history", tabId: "t", items: [user("u1"), text("hi")] })).toBeDefined()
  expect(rows.after({ type: "session.event", tabId: "t", event: { kind: "text.delta", id: "hi", delta: "!" } })).toBeUndefined()
  expect(rows.after({ type: "session.event", tabId: "t", event: { kind: "item", item: { type: "text", id: "hi", text: "hi!", done: true } } })).toBeUndefined()
  expect(rows.after({ type: "session.event", tabId: "t", event: { kind: "item", item: user("u2", 5) } })).toMatchObject({ rows: [{ id: "u1" }, { id: "hi" }, { id: "u2" }] })
  expect(rows.after({ type: "session.event", tabId: "t", event: { kind: "status", busy: true } })).toMatchObject({ rows: [{}, {}, {}, { type: "working", id: "working:u2", since: 5 }] })
  expect(rows.after({ type: "settings", settings: undefined as never })).toBeUndefined()
})
