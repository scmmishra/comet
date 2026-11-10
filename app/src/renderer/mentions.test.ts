import { expect, test } from "bun:test"
import { insertMention, mentionAt } from "./mentions"

test("finds the mention the caret is in, at the start or after a space", () => {
  expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" })
  expect(mentionAt("look at @src/ma", 15)).toEqual({ start: 8, query: "src/ma" })
  expect(mentionAt("look at @src/ma and", 15)).toEqual({ start: 8, query: "src/ma" })
})

test("leaves an email address, and a mention the caret has left, alone", () => {
  expect(mentionAt("mail me@example.com", 19)).toBeUndefined()
  expect(mentionAt("@src/main.ts done", 17)).toBeUndefined()
})

test("puts the path in place of what was typed, with one space after it", () => {
  expect(insertMention("see @ma please", 4, 7, "core/src/main.ts")).toEqual({ text: "see @core/src/main.ts please", caret: 22 })
  expect(insertMention("@ma", 0, 3, "a.ts")).toEqual({ text: "@a.ts ", caret: 6 })
})
