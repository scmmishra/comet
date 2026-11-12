import { expect, test } from "bun:test"
import type { ThreadEvent } from "@desk/protocol"
import { TurnWatch } from "./turn"

const result = (fields: { isError?: boolean; stopped?: boolean } = {}): ThreadEvent => ({ kind: "item", item: { type: "result", id: "r", durationMs: 1, isError: false, ...fields } })
const error: ThreadEvent = { kind: "item", item: { type: "error", id: "e", message: "lost" } }
const idle: ThreadEvent = { kind: "status", busy: false }

/** How a turn made of `events` ends. */
const ending = (...events: ThreadEvent[]) => {
  const watch = new TurnWatch()
  return events.map((event) => watch.take(event)).at(-1)
}

test("tells how a turn ended from its result, and counts a turn with an error or no result as failed", () => {
  expect(ending(result(), idle)).toEqual({ outcome: "done", held: false })
  expect(ending(result({ stopped: true }), idle)).toEqual({ outcome: "interrupted", held: true })
  expect(ending(result({ isError: true }), idle)).toEqual({ outcome: "error", held: true })
  expect(ending(result(), error, idle)).toEqual({ outcome: "error", held: true })
  expect(ending(idle)).toEqual({ outcome: "error", held: false })
})

test("a turn ends only when its session is no longer busy, and the next turn starts afresh", () => {
  const watch = new TurnWatch()
  expect(watch.take({ kind: "status", busy: true })).toBeUndefined()
  expect(watch.take(error)).toBeUndefined()
  expect(watch.take(idle)).toEqual({ outcome: "error", held: true })
  watch.take(result())
  expect(watch.take(idle)).toEqual({ outcome: "done", held: false })
})

test("names the message the running turn answers", () => {
  const watch = new TurnWatch()
  expect(watch.message).toBeUndefined()
  watch.take({ kind: "item", item: { type: "user", id: "u1", text: "Hello" } })
  expect(watch.message).toBe("u1")
})
