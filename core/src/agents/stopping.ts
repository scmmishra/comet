import type { Emit } from "./agent"

/** How long a stop may take before the tab offers Force stop, as in T3 Code. */
const UNRESPONSIVE_AFTER_MS = 15_000

/**
 * A stop the user asked of a running turn, which every agent's session reports the same way: the tab
 * hears the turn is stopping, and hears it is unresponsive once the agent has not stopped in time, so
 * Force stop can end it.
 */
export class Stop {
  private timer?: ReturnType<typeof setTimeout>
  private asked = false

  constructor(private readonly emit: Emit) {}

  /** Whether a stop waits for its turn to end. */
  get pending() {
    return this.asked
  }

  /** Tells the tab the turn is stopping. Returns false when a stop is already under way. */
  begin(): boolean {
    if (this.asked) return false
    this.asked = true
    const since = Date.now()
    this.emit({ kind: "stopping", since, unresponsive: false })
    this.timer = setTimeout(() => this.asked && this.emit({ kind: "stopping", since, unresponsive: true }), UNRESPONSIVE_AFTER_MS)
    return true
  }

  /** The turn ended, so nothing waits any more. */
  clear() {
    this.asked = false
    clearTimeout(this.timer)
  }
}
