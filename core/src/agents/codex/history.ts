import type { ThreadItem } from "@desk/protocol"
import { resultId } from "../turn-items"
import { imageAttachment } from "./input"
import { threadItems } from "./items"
import type { CodexItem, CodexTurn } from "./protocol"

type UserMessage = Extract<CodexItem, { type: "userMessage" }>

/**
 * Rebuilds a thread from Codex's turns, so a restored tab shows its conversation. A user message keeps
 * the id Desk gave it when it was sent, so live and restored items match. Each turn that has ended
 * closes with a result named after its first message, as Desk names every restored result. A failed
 * turn shows its error first.
 */
export function historyItems(dir: string, turns: readonly CodexTurn[]): ThreadItem[] {
  return turns.flatMap((turn) => {
    const messages = turn.items.filter((item): item is UserMessage => item.type === "userMessage")
    const items = turn.items.flatMap((item): ThreadItem[] =>
      item.type === "userMessage" ? [userItem(item, item === messages[0] ? turn : undefined)] : threadItems(dir, item, true, item.completedAtMs ?? undefined),
    )
    if (turn.status === "inProgress") return items
    const opener = messages[0] ? messageId(messages[0]) : turn.id
    return [...items, ...(turn.status === "failed" ? [turnError(turn)] : []), turnResult(turn, opener, false)]
  })
}

/** The id Desk knows a user message by: its own, when Desk sent it, else Codex's. */
export const messageId = (message: UserMessage) => message.clientId ?? message.id

/** The end of the turn `message` opened. `stopping` marks a turn the user asked to stop, whatever Codex reports. */
export function turnResult(turn: CodexTurn, message: string, stopping: boolean): ThreadItem {
  const durationMs = turn.durationMs ?? (turn.startedAt !== null && turn.completedAt !== null ? (turn.completedAt - turn.startedAt) * 1000 : 0)
  const stopped = stopping || turn.status === "interrupted"
  return { type: "result", id: resultId(message), durationMs, isError: turn.status === "failed", ...(stopped ? { stopped } : {}) }
}

export const turnError = (turn: CodexTurn): ThreadItem => ({ type: "error", id: `error:${turn.id}`, message: turn.error?.message ?? "Codex could not finish the turn." })

/** A user message. The turn it opened gives its time. A message steered into the turn has its own time, when Codex recorded it. */
function userItem(message: UserMessage, opened: CodexTurn | undefined): ThreadItem {
  const text = message.content.flatMap((input) => (input.type === "text" ? [input.text] : [])).join("\n")
  const images = message.content.flatMap(imageAttachment)
  const at = message.startedAtMs ?? (opened?.startedAt ? opened.startedAt * 1000 : undefined)
  return { type: "user", id: messageId(message), text, ...(images.length ? { images } : {}), ...(at ? { at } : {}), ...(opened ? {} : { steered: true }) }
}
