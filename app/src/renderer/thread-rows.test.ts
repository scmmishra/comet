import type { ThreadItem } from "@desk/protocol"
import { expect, test } from "bun:test"
import { resolveRows } from "./thread-rows"

const user: ThreadItem = { type: "user", id: "u1", text: "hi" }
const tool: ThreadItem = { type: "tool", id: "a", name: "Bash", summary: "ls" }
const answer: ThreadItem = { type: "text", id: "x", text: "done", done: true }

test("puts each item in its row, inside folds and groups", () => {
  const rows = resolveRows(
    [
      { type: "item", id: "u1" },
      { type: "fold", id: "fold:u1", rows: [{ type: "group", id: "group:a", steps: ["a"], live: false }], durationMs: 1000, stopped: false },
      { type: "item", id: "x" },
    ],
    [user, tool, answer],
  )
  expect(rows).toEqual([user, { type: "fold", id: "fold:u1", rows: [{ type: "group", id: "group:a", steps: [tool as never], live: false }], durationMs: 1000, stopped: false }, answer])
})

test("leaves out an id whose item has not arrived", () => {
  expect(resolveRows([{ type: "item", id: "u1" }, { type: "item", id: "later" }, { type: "group", id: "group:b", steps: ["b"], live: true }, { type: "working", id: "working:u1" }], [user])).toEqual([user, { type: "working", id: "working:u1" }])
})
