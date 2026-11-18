import type { TurnOutcome } from "@comet/plugin"
import type { ThreadEvent } from "@comet/protocol"

/** How a turn ended: for the plugin that owns its thread, and whether the messages that wait should hold. */
interface TurnEnding {
  readonly outcome: TurnOutcome
  /** Whether the user stopped the turn or it failed. Either holds the queue, and any other end sends the next message. */
  readonly held: boolean
}

/** How a turn that ends with no result ended, such as one whose session failed to start. */
const NO_RESULT: TurnOutcome = "error"

/**
 * Follows one session's events, turn by turn. A result says how a turn ended, and an error overrides it.
 * The turn is over once the session says it is no longer busy.
 */
export class TurnWatch {
  private outcome: TurnOutcome = NO_RESULT
  private held = false
  /** The message the running turn answers, which names what Comet keeps about the turn. */
  message?: string

  /** Takes the session's next event. Returns how the turn ended when the event ends it. */
  take(event: ThreadEvent): TurnEnding | undefined {
    if (event.kind === "item") {
      const item = event.item
      if (item.type === "user") this.message = item.id
      if (item.type === "result") {
        this.outcome = item.stopped ? "interrupted" : item.isError ? "error" : "done"
        this.held = !!item.stopped || item.isError
      }
      if (item.type === "error") {
        this.outcome = "error"
        this.held = true
      }
      return undefined
    }
    if (event.kind !== "status" || event.busy) return undefined
    const end = { outcome: this.outcome, held: this.held }
    this.outcome = NO_RESULT
    this.held = false
    return end
  }
}
