import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import type { PromptCheck, PromptFailure } from "../acp/flavor"
import { sessionLog } from "./home"

/** What a turn says when Claude rejects a thinking block the session saved. Every later prompt fails the same way. */
export const SIGNATURE_REJECTED = "This Antigravity thread can no longer go on. The model rejects a thinking block saved in it. Start a new thread."
/** What a turn says when the account used up its quota. */
export const QUOTA_REACHED = "You have reached your Antigravity quota for this period."
/** What a turn says when Google asks the user to verify the account. A link to Google's check follows it when the error has one. */
export const VERIFY_ACCOUNT = "Google asks you to verify your Google account. Verify it, then send again."
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
/** Where the HTTP body of an error starts. The CLI writes it as JSON, compact or indented, and a stack trace may follow it. */
const ERROR_BODY = /\{\s*"error"\s*:/g
/**
 * The link to Google's account check that Comet shows, as T3 Code accepts it: a sign-in that continues on
 * accounts.google.com, with no control characters, spaces or fragment.
 */
const VERIFICATION_URL = /^https:\/\/accounts\.google\.com\/(?:v3\/)?signin\/continue\?[^\s\p{Cc}\\#]+$/u
/** The longest link to Google's account check that Comet shows. */
const MAX_URL = 4096
/** The detail of a Google API error that asks for an account check. */
const ERROR_INFO = "type.googleapis.com/google.rpc.ErrorInfo"
const CHECK_DOMAIN = "cloudcode-pa.googleapis.com"
const CHECK_REASON = "VALIDATION_REQUIRED"
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

/** The parts of an HTTP error's body that ask for an account check. */
interface ErrorBody {
  readonly error?: { readonly code?: unknown; readonly status?: unknown; readonly details?: unknown }
}

interface ErrorInfo {
  readonly "@type"?: unknown
  readonly domain?: unknown
  readonly reason?: unknown
  readonly metadata?: { readonly validation_url?: unknown } | null
}

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
  const check = accountCheck(text)
  if (check) return { message: check.link ? `${VERIFY_ACCOUNT}\n${check.link}` : VERIFY_ACCOUNT, repeats }
  const message = API_ERROR.exec(text)?.[1] ?? ERROR_LINE.exec(text)?.[1]
  return { message: message?.trim() || STOPPED_BY_ERROR, repeats }
}

/**
 * Whether the error's body asks the user to verify the account, after T3 Code, with the link to Google's
 * check when Comet trusts it. Google answers 403 with an ErrorInfo of reason VALIDATION_REQUIRED, and puts
 * the link in its `validation_url`.
 */
function accountCheck(text: string): { readonly link?: string } | undefined {
  for (const start of text.matchAll(ERROR_BODY)) {
    const error = (parsed(jsonObject(text, start.index)) as ErrorBody | undefined)?.error
    if (error?.code !== 403 || error.status !== "PERMISSION_DENIED" || !Array.isArray(error.details)) continue
    const info = (error.details as (ErrorInfo | null)[]).find((detail) => detail?.["@type"] === ERROR_INFO && detail.domain === CHECK_DOMAIN && detail.reason === CHECK_REASON)
    if (!info) continue
    const link = info.metadata?.validation_url
    return typeof link === "string" && link.length <= MAX_URL && VERIFICATION_URL.test(link) ? { link } : {}
  }
  return undefined
}

/** The JSON object that starts at `start`, up to its closing brace. Undefined when the text ends first. */
function jsonObject(text: string, start: number): string | undefined {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}" && --depth === 0) return text.slice(start, index + 1)
  }
  return undefined
}

function parsed(json: string | undefined): unknown {
  if (json === undefined) return undefined
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
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
