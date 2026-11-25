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
/** A Go duration, such as `4m42s` or `3600s`. */
const GO_DURATION = String.raw`(?:\d+(?:\.\d+)?(?:ns|us|µs|μs|ms|h|m|s))+`
/**
 * Where a quota error says when the quota resets, after T3 Code, in the order it reads them: Google's reset
 * time, its delay, the delay to retry after, and the CLI's own words, such as "Resets in 4m42s.".
 */
const RESET_TIME = /\bquotaResetTimeStamp:([^\s\]]+)/
const RESET_DELAYS = [new RegExp(String.raw`\bquotaResetDelay:(${GO_DURATION})(?=[\s\]])`), new RegExp(String.raw`\bretryDelay:(${GO_DURATION})(?=[\s\]])`), new RegExp(String.raw`\bResets in (${GO_DURATION})(?!\w|\.\d)`)]
/** One part of a Go duration, and how many milliseconds each of its units is. */
const DURATION_PART = /(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|h|m|s)/g
const UNIT_MS: Record<string, number> = { ns: 1e-6, us: 1e-3, µs: 1e-3, μs: 1e-3, ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }
/**
 * A Google API error, as the CLI writes it, after T3 Code. Its status is a gRPC code, or an HTTP status
 * line such as `502 Bad Gateway`. The message stops at the next error, so a match never spans two.
 */
const API_ERROR = /Error \d{3}, Message: ((?:(?!, Status: |Error \d{3}, Message: ).)+), Status: (?:[A-Z_]+|\d{3}[^,\n]*)/s
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
  if (QUOTA.test(text)) {
    const reset = resetDelay(text)
    return { message: reset ? `${QUOTA_REACHED} It resets in ${duration(reset)}.` : QUOTA_REACHED, repeats }
  }
  const message = API_ERROR.exec(text)?.[1] ?? ERROR_LINE.exec(text)?.[1]
  return { message: message?.trim() || STOPPED_BY_ERROR, repeats }
}

/** How long until the quota resets, in milliseconds. A reset time that has passed or does not parse gives way to a delay. */
function resetDelay(text: string): number | undefined {
  const time = Date.parse(RESET_TIME.exec(text)?.[1] ?? "")
  if (time > Date.now()) return time - Date.now()
  const delay = RESET_DELAYS.map((pattern) => pattern.exec(text)?.[1]).find((found) => found !== undefined)
  if (delay === undefined) return undefined
  const ms = [...delay.matchAll(DURATION_PART)].reduce((sum, [, amount, unit]) => sum + Number(amount) * UNIT_MS[unit!]!, 0)
  return ms > 0 ? ms : undefined
}

/** A wait in hours, minutes and seconds, such as `1h` or `4m42s`. It rounds up to a second. */
function duration(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  const parts: [number, string][] = [
    [Math.floor(seconds / 3600), "h"],
    [Math.floor((seconds % 3600) / 60), "m"],
    [seconds % 60, "s"],
  ]
  return parts.flatMap(([amount, unit]) => (amount ? [`${amount}${unit}`] : [])).join("")
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
