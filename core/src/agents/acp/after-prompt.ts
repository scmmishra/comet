import type { BackgroundWork } from "./flavor"
import type { SessionUpdate, ToolCall } from "./protocol"

/**
 * How long the agent stays quiet after a reply ends before its turn ends, as T3 Code waits. An agent may
 * mark the end of every model call, not only the last, and its next call may follow within milliseconds.
 */
export const SETTLE_MS = 3_000
/** How long an open reply may stay quiet before its turn ends anyway. A model can be silent for seconds before its first token. As T3 Code. */
export const REPLY_LIMIT_MS = 2 * 60_000
/**
 * How long a call the turn waits on may stay quiet before the turn ends anyway, as T3 Code. A call the
 * agent never reports on would keep the tab busy for good. If the call ends later, its reply starts a turn.
 */
export const HOLD_LIMIT_MS = 30 * 60_000

/** The updates that carry what the agent wrote or did. */
const OUTPUT: ReadonlySet<SessionUpdate["sessionUpdate"]> = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update"])

/** Whether an update carries what the agent wrote or did. */
const isOutput = (update: SessionUpdate) => OUTPUT.has(update.sessionUpdate)

/**
 * Whether an update starts a turn when none is open. A lone update of a call does not: a call that a stop
 * ended reports its end after its turn. When the agent goes on after a call, its reply starts the turn.
 */
export const opensTurn = (update: SessionUpdate) => update.sessionUpdate !== "tool_call_update" && isOutput(update)

/**
 * What keeps one turn open after its prompt answered, for an agent that works past its prompt. It follows
 * the calls the turn runs and whether a reply is open. The turn ends once the agent has been quiet long
 * enough: briefly after a reply ends, longer while a reply is open, and longest while a call it waits on runs.
 */
export class AfterPrompt {
  /** The calls the turn ran, by id. Only these hold it, so a call an earlier turn gave up on does not. */
  private readonly calls = new Set<string>()
  private replying = false
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly work: BackgroundWork,
    /** A call as the session knows it now. */
    private readonly call: (toolCallId: string) => ToolCall | undefined,
  ) {}

  /** Follows an update of the turn. */
  take(update: SessionUpdate) {
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") this.calls.add(update.toolCallId)
    if (this.work.endsReply(update)) this.replying = false
    else if (isOutput(update)) this.replying = true
  }

  /** The prompt answered, which ended its reply. */
  promptAnswered() {
    this.replying = false
  }

  /** The user answered a request, and the agent goes on with its reply. */
  answered() {
    this.replying = true
  }

  /** Whether a call the turn ran still runs past its prompt. A call that waits for permission has not started. */
  holds(): boolean {
    return [...this.calls].some((id) => {
      const call = this.call(id)
      return call?.status === "in_progress" && this.work.outlivesPrompt(call)
    })
  }

  /** Calls `end` once the agent has been quiet long enough. Each call starts the wait again. A stop waits only to let the agent's last frames land. */
  wait(stopping: boolean, end: () => void) {
    this.clear()
    const quiet = stopping ? SETTLE_MS : this.holds() ? HOLD_LIMIT_MS : this.replying ? REPLY_LIMIT_MS : SETTLE_MS
    this.timer = setTimeout(end, quiet)
  }

  clear() {
    clearTimeout(this.timer)
  }
}
