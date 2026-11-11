import type { ImageAttachment, ThreadItem } from "@desk/protocol"
import { errorMessage } from "../errors"

/**
 * The items every agent's session adds to a thread the same way: the user's message, a turn's result and
 * an error. Each agent maps its own messages to the rest.
 */

type Item<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>

const RESULT_PREFIX = "result:"

/** The user's message, as sent now. `steered` marks one that joined a running turn. */
export function userItem(id: string, text: string, images: readonly ImageAttachment[], steered = false): Item<"user"> {
  return { type: "user", id, text, ...(images.length ? { images } : {}), at: Date.now(), ...(steered ? { steered: true } : {}) }
}

/** The id of the result of the turn a message opened. A thread read back from a transcript names its results this way, so what Desk saved about a turn finds it again. */
export const resultId = (messageId: string) => `${RESULT_PREFIX}${messageId}`

/** The message whose turn a restored result closes. */
export const resultMessage = (id: string) => id.slice(RESULT_PREFIX.length)

/** The result of a turn that did not stop when asked, and was ended as stopped. */
export const forcedStop = (): Item<"result"> => ({ type: "result", id: resultId(`forced-${Date.now()}`), durationMs: 0, isError: false, stopped: true })

/** An error a session shows in its thread. */
export const errorItem = (error: unknown): Item<"error"> => ({ type: "error", id: `error-${Date.now()}`, message: errorMessage(error) })
