import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import type { PromptCheck, PromptFailure } from "../acp/flavor"
import { sessionLog } from "./home"

/** What a turn says when Claude rejects a thinking block the session saved. Every later prompt fails the same way. */
export const SIGNATURE_REJECTED = "This Antigravity thread can no longer go on. The model rejects a thinking block saved in it. Start a new thread."
/** What a turn says when the account used up its quota. */
export const QUOTA_REACHED = "You have reached your Antigravity quota for this period."
/** What a turn says when the error has no message Comet can read. */
export const STOPPED_BY_ERROR = "Antigravity stopped this turn because of an error."

/** The step the CLI adds when an error ends a turn. */
const ERROR_STEP = 17
/** The error's text leads its step. A Go stack trace may follow it. */
const MAX_PAYLOAD_BYTES = 16_384
/** A session id that names one file in the conversations folder. */
const SESSION_ID = /^[\w-]+$/
/** Claude's answer for a thinking block without a valid signature, as T3 Code reads it. */
const SIGNATURE = /\bmessages\.\d+\.content\.\d+(?:\.thinking\.signature: Field required|: Invalid `signature` in `thinking` block)/
const QUOTA = /\breason:QUOTA_EXHAUSTED\b/
/** A Google API error, as the CLI writes it, after T3 Code. */
const API_ERROR = /Error \d{3}, Message: (.+?), Status: [A-Z_]+/s
/**
 * The error line the CLI also sends as the reply, such as `INVALID_ARGUMENT (code 400): <message>`. The
 * step is protobuf, and the byte before the status is its length, so only what follows the code is read.
 */
const ERROR_LINE = /\(code \d{3}\): ([^\x00-\x1f]+)/
/** How the CLI marks the error line it sends as the reply. */
const REPLY_MARK = "⚠ "

interface Step {
  readonly type: number
  readonly payload: Uint8Array
}

/**
 * Antigravity ends a prompt that an API error stopped as a normal turn, with the error line as its reply.
 * Its session log ends that turn with an error step. So this notes the log's last step now, before a prompt
 * or before work the agent does after it, and once the turn ends reads the last step added since. A log it
 * cannot read leaves the turn as the agent ended it.
 */
export function watchPrompt(sessionId: string): PromptCheck | undefined {
  if (!SESSION_ID.test(sessionId)) return undefined
  const path = sessionLog(sessionId)
  // A session's first prompt may create its log, and then every step is the prompt's.
  const start = existsSync(path) ? readLog(path, lastIndex) : -1
  if (start === undefined) return undefined
  return () => {
    const step = existsSync(path) ? readLog(path, (log) => lastStepAfter(log, start)) : undefined
    return step?.type === ERROR_STEP ? failure(new TextDecoder().decode(step.payload)) : undefined
  }
}

/** The failure an error step's text names. */
function failure(text: string): PromptFailure {
  const repeats = (reply: string) => {
    const line = reply.trim()
    const error = line.slice(REPLY_MARK.length)
    return line.startsWith(REPLY_MARK) && error.length > 0 && !error.includes("\n") && text.includes(error)
  }
  if (SIGNATURE.test(text)) return { message: SIGNATURE_REJECTED, repeats }
  if (QUOTA.test(text)) return { message: QUOTA_REACHED, repeats }
  const message = API_ERROR.exec(text)?.[1] ?? ERROR_LINE.exec(text)?.[1]
  return { message: message?.trim() || STOPPED_BY_ERROR, repeats }
}

/** Reads the log read-only. Undefined when it cannot be read. */
function readLog<T>(path: string, read: (log: Database) => T): T | undefined {
  try {
    const log = new Database(path, { readonly: true })
    try {
      // The CLI may be writing to it.
      log.exec("PRAGMA busy_timeout = 100")
      return read(log)
    } finally {
      log.close()
    }
  } catch {
    return undefined
  }
}

const hasSteps = (log: Database) => log.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'steps'").get() !== null

function lastIndex(log: Database): number {
  if (!hasSteps(log)) return -1
  const row = log.query<{ idx: number | null }, []>("SELECT max(idx) AS idx FROM steps").get()
  return row?.idx ?? -1
}

function lastStepAfter(log: Database, index: number): Step | undefined {
  if (!hasSteps(log)) return undefined
  const row = log
    .query<{ type: number; payload: Uint8Array | null }, [number, number]>("SELECT step_type AS type, substr(step_payload, 1, ?) AS payload FROM steps WHERE idx > ? ORDER BY idx DESC LIMIT 1")
    .get(MAX_PAYLOAD_BYTES, index)
  return row ? { type: row.type, payload: row.payload ?? new Uint8Array() } : undefined
}
