import type { TabInfo, ThreadItem } from "@desk/protocol"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Chevron, Icon } from "./icons"
import { Markdown } from "./markdown"
import { openFile } from "./file-tabs"
import { advance, answerOf, EMPTY_DRAFT, pick, typeAnswer, type QuestionDraft } from "./questions"
import { answerQuestion } from "./threads"

type QuestionItem = Extract<ThreadItem, { type: "question" }>

/** How long a pick on a single-choice question shows before the next question, as in T3 Code. */
const AUTO_ADVANCE_MS = 200
/** Options past this many get no number key. */
const NUMBERED_OPTIONS = 9

/** What the user has given each open set of questions, by request id. It lasts while the app runs. */
const [drafts, setDrafts] = createStore<Record<string, QuestionDraft>>({})

export const questionDraft = (item: QuestionItem) => drafts[item.requestId] ?? EMPTY_DRAFT
const activeQuestion = (item: QuestionItem) => item.questions[questionDraft(item).index]

/** The composer's text, which answers the current question in its own words. */
export const typedAnswer = (item: QuestionItem) => {
  const question = activeQuestion(item)
  return question ? (questionDraft(item).custom[question.question] ?? "") : ""
}

export function typeQuestionAnswer(item: QuestionItem, text: string) {
  const question = activeQuestion(item)
  if (question) setDrafts(item.requestId, typeAnswer(question, questionDraft(item), text))
}

/** Whether the current question has an answer, so the composer can move on. */
export const canAdvance = (item: QuestionItem) => {
  const question = activeQuestion(item)
  return !!question && answerOf(question, questionDraft(item)) !== undefined
}

export const isLastQuestion = (item: QuestionItem) => questionDraft(item).index >= item.questions.length - 1

/** Moves to the next question, or sends every answer after the last one. */
export function advanceQuestion(tabId: string, item: QuestionItem) {
  const next = advance(item.questions, questionDraft(item))
  if (!next) return
  if ("draft" in next) return setDrafts(item.requestId, next.draft)
  answerQuestion(tabId, item.requestId, next.answers)
}

/**
 * Claude's questions, at the top of the composer, after T3 Code. One question shows at a time with its
 * options. A number key picks an option while the composer is not being typed in. Picking an option of a
 * single-choice question moves on by itself. The header folds the question away, and the cross dismisses it.
 */
export function QuestionPanel(props: { tab: TabInfo; item: QuestionItem }) {
  const [folded, setFolded] = createSignal(false)
  const question = () => activeQuestion(props.item)
  const draft = () => questionDraft(props.item)
  const isPicked = (label: string) => {
    const current = question()
    return !!current && !draft().custom[current.question]?.trim() && (draft().selected[current.question] ?? []).includes(label)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const choose = (label: string) => {
    const current = question()
    if (!current) return
    setDrafts(props.item.requestId, pick(current, draft(), label))
    if (current.multiSelect) return
    clearTimeout(timer)
    timer = setTimeout(() => advanceQuestion(props.tab.id, props.item), AUTO_ADVANCE_MS)
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (folded() || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Digits typed into the composer are an answer, not a pick.
      if (target?.closest("input, textarea, [contenteditable='true']")) return
      const option = question()?.options[Number(event.key) - 1]
      if (!option || !/^[1-9]$/.test(event.key)) return
      event.preventDefault()
      choose(option.label)
    }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
  })

  return (
    <Show when={question()}>
      {(current) => (
        <section aria-label="Claude's question" class="flex flex-col border-b border-line px-4 pb-2 pt-2.5">
          <div class="flex min-w-0 items-center gap-2 text-[12px]">
            <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={!folded()} onClick={() => setFolded(!folded())}>
              <span class="shrink-0 text-fg-3">{current().header}</span>
              <Show when={folded()}>
                <span class="min-w-0 truncate text-fg-2">{current().question}</span>
              </Show>
            </button>
            <Show when={props.item.questions.length > 1}>
              <span class="shrink-0 tabular-nums text-fg-3">
                {draft().index + 1}/{props.item.questions.length}
              </span>
            </Show>
            <Chevron open={!folded()} class="size-[13px] shrink-0 text-fg-3" />
            <IconButton
              type="button"
              variant="ghost-muted"
              size="small"
              aria-label="Dismiss question without answering"
              icon={<Icon name="xmark-small" />}
              onClick={() => answerQuestion(props.tab.id, props.item.requestId)}
            />
          </div>
          <Show when={!folded()}>
            {/*
              The options' hover fill reaches past the header's edge, so the scroll area widens by the same
              amount and the question takes it back as padding. A negative margin inside it would scroll sideways.
            */}
            <div class="-mx-1.5 max-h-[40vh] overflow-y-auto">
              <div class="px-1.5 pt-1.5 text-[length:var(--desk-text-size)] text-fg">
                <Markdown text={current().question} done onOpenFile={(path, line) => openFile(props.tab.project, path, line)} />
              </div>
              <div class="mt-1.5 flex flex-col">
                <For each={current().options}>
                  {(option, index) => (
                    <button
                      type="button"
                      aria-pressed={isPicked(option.label)}
                      class="flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left"
                      classList={{ "text-fg": isPicked(option.label), "text-fg-2 hover:bg-hover": !isPicked(option.label) }}
                      onClick={() => choose(option.label)}
                    >
                      <span class="flex h-5 shrink-0 items-center">
                        <OptionMark checked={isPicked(option.label)} multiple={current().multiSelect} />
                      </span>
                      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span class="text-[13px] font-medium">{option.label}</span>
                        <Show when={option.description}>{(description) => <span class="text-[12px] text-fg-3">{description()}</span>}</Show>
                      </span>
                      <Show when={index() < NUMBERED_OPTIONS}>
                        <span class="flex h-5 shrink-0 items-center">
                          <Keybind keys={[String(index() + 1)]} />
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </section>
      )}
    </Show>
  )
}

/**
 * A radio or checkbox mark, drawn rather than taken from `@opencode/ui`. Its Radio checks only inside a
 * RadioGroup, whose arrow keys pick options and would set off the single-choice auto-advance, as T3 Code notes.
 */
function OptionMark(props: { checked: boolean; multiple: boolean }) {
  return (
    <span
      aria-hidden="true"
      class="relative inline-flex size-4 shrink-0 items-center justify-center border"
      classList={{
        "rounded-full": !props.multiple,
        "rounded-[4px]": props.multiple,
        "border-fg bg-fg": props.checked,
        "border-fg-3": !props.checked,
      }}
    >
      <Show when={props.checked}>
        <Show when={props.multiple} fallback={<span class="size-1.5 rounded-full bg-card" />}>
          <Icon name="check" class="size-3 text-card" />
        </Show>
      </Show>
    </span>
  )
}
