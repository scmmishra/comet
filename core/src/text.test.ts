import { expect, test } from "bun:test"
import { textEnd, textStart } from "./text"

/** Half of a surrogate pair, as JSON.stringify writes it. The client rejects JSON that holds one. */
const HALF_PAIR = /\\ud[89a-f][0-9a-f]{2}/i

test("cuts the start of a text between whole characters, so its JSON holds no half of a surrogate pair", () => {
  const text = `${"a".repeat(9)}😀b`
  expect(textStart(text, 10)).toBe("a".repeat(9))
  expect(textStart(text, 11)).toBe(`${"a".repeat(9)}😀`)
  expect(textStart(text, 20)).toBe(text)
  expect(JSON.stringify(textStart("😀".repeat(50), 41))).not.toMatch(HALF_PAIR)
})

test("keeps an emoji made of several code points whole, and cuts a longer cluster between code points", () => {
  const family = "👩‍👩‍👧"
  expect(textStart(`ab${family}c`, 2 + family.length - 1)).toBe("ab")
  const accented = `${"a".repeat(40)}e${"\u0301".repeat(80)}`
  expect(textStart(accented, 60)).toBe("a".repeat(40))
  // A cluster that starts before the window the cut reads is cut between code points.
  expect(textStart(accented, 100)).toBe(accented.slice(0, 100))
  const people = `👩${"\u200d👩".repeat(20)}`
  for (const limit of [40, 41, 42]) expect(textStart(people, limit).isWellFormed()).toBe(true)
})

test("cuts the end of a text on a whole code point", () => {
  const text = `a😀${"b".repeat(9)}`
  expect(textEnd(text, 10)).toBe("b".repeat(9))
  expect(textEnd(text, 11)).toBe(`😀${"b".repeat(9)}`)
  expect(textEnd(text, 20)).toBe(text)
})
