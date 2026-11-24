import type { ThreadItem } from "@comet/protocol"
import { resultId } from "../turn-items"
import { imageAttachment } from "./input"
import { threadItems } from "./items"
import type { CodexItem, CodexTurn } from "./protocol"

type UserMessage = Extract<CodexItem, { type: "userMessage" }>

/**
 * Rebuilds a thread from Codex's turns, so a restored tab shows its conversation. A user message keeps
 * the id Comet gave it when it was sent, so live and restored items match. Each turn that has ended
 * closes with a result named after its first message, as Comet names every restored result. A failed
 * turn shows its error first.
 */
export function historyItems(dir: string, turns: readonly CodexTurn[]): ThreadItem[] {
  return turns.flatMap((turn) => {
    const messages = turn.items.filter((item): item is UserMessage => item.type === "userMessage")
    const items = turn.items.flatMap((item): ThreadItem[] =>
      item.type === "userMessage" ? [restoredUserItem(item, item === messages[0] ? turn : undefined)] : threadItems(dir, item, true, item.completedAtMs ?? undefined),
    )
    if (turn.status === "inProgress") return items
    const opener = messages[0] ? messageId(messages[0]) : turn.id
    return [...items, ...(turn.status === "failed" ? [turnError(turn)] : []), turnResult(turn, opener, false)]
  })
}

/** The id Comet knows a user message by: its own, when Comet sent it, else Codex's. */
export const messageId = (message: UserMessage) => message.clientId ?? message.id

/** The end of the turn `message` opened. `stopping` marks a turn the user asked to stop, whatever Codex reports. */
export function turnResult(turn: CodexTurn, message: string, stopping: boolean): Extract<ThreadItem, { type: "result" }> {
  const durationMs = turn.durationMs ?? (turn.startedAt !== null && turn.completedAt !== null ? (turn.completedAt - turn.startedAt) * 1000 : 0)
  const stopped = stopping || turn.status === "interrupted"
  return { type: "result", id: resultId(message), durationMs, isError: turn.status === "failed", ...(stopped ? { stopped } : {}) }
}

/** A provider's status or reason for a request too large to take, after T3 Code. A gateway such as nginx answers it with an HTML page. */
const REQUEST_TOO_LARGE_STATUS = /^\s*(?:(?:API Error|Error|HTTP|status)(?:\s*:)?\s*)?413\b/iu
const REQUEST_TOO_LARGE_REASON = /\b(?:Request Entity|Payload|Content) Too Large\b/u
/** What a request too large reads as. Sending the same thread again fails the same way. */
export const REQUEST_TOO_LARGE = "The request was too large for the provider. Start a new thread, or remove large attachments."

/** Why the turn failed. A request too large reads as one sentence, in place of the provider's page. */
export function turnError(turn: CodexTurn): ThreadItem {
  const message = turn.error?.message ?? "Codex could not finish the turn."
  const tooLarge = REQUEST_TOO_LARGE_STATUS.test(message) || REQUEST_TOO_LARGE_REASON.test(message)
  return { type: "error", id: `error:${turn.id}`, message: tooLarge ? REQUEST_TOO_LARGE : message }
}

/** A user message. The turn it opened gives its time. A message steered into the turn has its own time, when Codex recorded it. */
function restoredUserItem(message: UserMessage, opened: CodexTurn | undefined): ThreadItem {
  const text = message.content.flatMap((input) => (input.type === "text" ? [input.text] : [])).join("\n")
  const images = message.content.flatMap(imageAttachment)
  const at = message.startedAtMs ?? (opened?.startedAt ? opened.startedAt * 1000 : undefined)
  return { type: "user", id: messageId(message), text, ...(images.length ? { images } : {}), ...(at ? { at } : {}), ...(opened ? {} : { steered: true }) }
}
