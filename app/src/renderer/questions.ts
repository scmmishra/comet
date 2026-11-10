import type { Question } from "@desk/protocol"

/**
 * Answering Claude's questions, after T3 Code. The questions come one at a time. Picking an option of a
 * single-choice question answers it, and the composer's text, when there is any, answers it instead.
 */

/** What the user has given so far, by question text. */
export interface QuestionDraft {
  readonly index: number
  readonly selected: Readonly<Record<string, readonly string[]>>
  readonly custom: Readonly<Record<string, string>>
}

export const EMPTY_DRAFT: QuestionDraft = { index: 0, selected: {}, custom: {} }

/** A question's answer: the user's own text, else the picked options joined, else none yet. */
export function answerOf(question: Question, draft: QuestionDraft): string | undefined {
  const custom = draft.custom[question.question]?.trim()
  if (custom) return custom
  const selected = draft.selected[question.question] ?? []
  return selected.length ? selected.join(", ") : undefined
}

/** Picks an option. A single-choice question keeps only it, and a multiple-choice one toggles it. */
export function pick(question: Question, draft: QuestionDraft, label: string): QuestionDraft {
  const current = draft.selected[question.question] ?? []
  const next = !question.multiSelect ? [label] : current.includes(label) ? current.filter((value) => value !== label) : [...current, label]
  // A picked option answers the question, so text typed for it gives way.
  return { ...draft, selected: { ...draft.selected, [question.question]: next }, custom: { ...draft.custom, [question.question]: "" } }
}

export function typeAnswer(question: Question, draft: QuestionDraft, text: string): QuestionDraft {
  return { ...draft, custom: { ...draft.custom, [question.question]: text } }
}

/**
 * Moves past the current question once it has an answer. After the last one it gives every answer, by
 * question text, which is how AskUserQuestion takes them.
 */
export function advance(questions: readonly Question[], draft: QuestionDraft): { draft: QuestionDraft } | { answers: Record<string, string> } | undefined {
  const question = questions[draft.index]
  if (!question || answerOf(question, draft) === undefined) return undefined
  if (draft.index < questions.length - 1) return { draft: { ...draft, index: draft.index + 1 } }
  const answers: Record<string, string> = {}
  for (const each of questions) {
    const answer = answerOf(each, draft)
    if (answer === undefined) return undefined
    answers[each.question] = answer
  }
  return { answers }
}
