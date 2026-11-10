import type { ThreadItem } from "@desk/protocol"
import { expect, test } from "bun:test"
import { currentIndex, hitStripWidth, markAt, markTop, minimapItems, railHeight } from "./minimap-items"

test("marks each message the user sent, with the last thing Claude wrote before the next", () => {
  const items: ThreadItem[] = [
    { type: "user", id: "u1", text: "Fix the  login\nbug" },
    { type: "text", id: "t1", text: "Looking.", done: true },
    { type: "tool", id: "x", name: "Bash", summary: "ls" },
    { type: "text", id: "t2", text: "Fixed it.", done: true },
    { type: "user", id: "n1", text: "Background command finished", fromTask: true },
    { type: "text", id: "t3", text: "The review is in.", done: true },
    { type: "user", id: "u2", text: "", images: [{ mediaType: "image/png", data: "x" }] },
  ]
  expect(minimapItems(items)).toEqual([
    { id: "u1", text: "Fix the login bug", answer: "The review is in." },
    { id: "u2", text: "User message" },
  ])
})

test("spaces marks 8px apart, evenly, and finds the one nearest a point", () => {
  expect(railHeight(3)).toBe("min(16px, calc(100vh - 18rem))")
  expect([0, 1, 2, 3, 4].map((index) => markTop(index, 5))).toEqual([0, 25, 50, 75, 100])
  expect(markAt(0, 5)).toBe(0)
  expect(markAt(0.6, 5)).toBe(2)
  expect(markAt(1.4, 5)).toBe(4)
})

test("fits the hit strip to the gutter, and finds the turn being read", () => {
  expect(hitStripWidth(30)).toBe(18)
  expect(hitStripWidth(200)).toBe(40)
  expect(hitStripWidth(8)).toBe(0)
  // Messages at 0, 500 and 1200, on a screen from 600 to 1000: the second turn is being read.
  expect(currentIndex([0, 500, 1200], 600, 1000)).toBe(1)
  expect(currentIndex([0, 700, 1200], 600, 1000)).toBe(1)
  expect(currentIndex([0, 500, 900], 600, 1000)).toBe(2)
})
