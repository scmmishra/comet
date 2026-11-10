import type { Question } from "@desk/protocol"
import { expect, test } from "bun:test"
import { advance, answerOf, EMPTY_DRAFT, pick, typeAnswer } from "./questions"

const single: Question = { header: "View", question: "Which view?", options: [{ label: "Top" }, { label: "Side" }], multiSelect: false }
const multi: Question = { header: "Parts", question: "Which parts?", options: [{ label: "Legs" }, { label: "Top" }, { label: "Drawer" }], multiSelect: true }

test("a single-choice question keeps the last pick, and a multiple-choice one toggles picks in order", () => {
  expect(answerOf(single, pick(single, pick(single, EMPTY_DRAFT, "Top"), "Side"))).toBe("Side")
  const draft = pick(multi, pick(multi, pick(multi, EMPTY_DRAFT, "Drawer"), "Legs"), "Drawer")
  expect(answerOf(multi, draft)).toBe("Legs")
  expect(answerOf(multi, pick(multi, draft, "Top"))).toBe("Legs, Top")
})

test("typed text answers a question over its picks, and a later pick clears the text", () => {
  const typed = typeAnswer(single, pick(single, EMPTY_DRAFT, "Top"), "  Neither, show the edges  ")
  expect(answerOf(single, typed)).toBe("Neither, show the edges")
  expect(answerOf(single, typeAnswer(single, typed, "   "))).toBe("Top")
  expect(answerOf(single, pick(single, typed, "Side"))).toBe("Side")
})

test("steps through the questions once each is answered, then gives the answers by question text", () => {
  const questions = [single, multi]
  expect(advance(questions, EMPTY_DRAFT)).toBeUndefined()
  const first = advance(questions, pick(single, EMPTY_DRAFT, "Top"))
  expect(first).toEqual({ draft: { ...pick(single, EMPTY_DRAFT, "Top"), index: 1 } })
  const onSecond = (first as { draft: typeof EMPTY_DRAFT }).draft
  expect(advance(questions, onSecond)).toBeUndefined()
  expect(advance(questions, pick(multi, pick(multi, onSecond, "Legs"), "Drawer"))).toEqual({ answers: { "Which view?": "Top", "Which parts?": "Legs, Drawer" } })
})
