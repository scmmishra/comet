import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { useTempHome } from "../../test-support"
import { sessionLog } from "./home"
import { QUOTA_REACHED, SIGNATURE_REJECTED, STOPPED_BY_ERROR, watchPrompt } from "./prompt-outcome"

useTempHome()

const USER_STEP = 14
const ERROR_STEP = 17
const SIGNATURE_LINE = "INVALID_ARGUMENT (code 400): invalid_request_error: messages.1.content.0: Invalid `signature` in `thinking` block"
/** The reply the CLI sends for the error. */
const REPLY = `\n⚠ ${SIGNATURE_LINE}\n`

/** A string field of a protobuf message: its tag, its length and its bytes. */
const field = (tag: number, text: string) => {
  const bytes = new TextEncoder().encode(text)
  const length = bytes.length < 128 ? [bytes.length] : [(bytes.length & 0x7f) | 0x80, bytes.length >> 7]
  return new Uint8Array([tag, ...length, ...bytes])
}

/** An error step as agy 1.5.9 writes it. The error line's length byte is a printable letter. */
function errorPayload(line: string, trace = "HTTP 400 Bad Request\n{\n  \"error\": { \"code\": 400 }\n}\ngoroutine 1 [running]:\nmain.main()") {
  return new Uint8Array([...field(0x0a, "Agent execution terminated due to error."), ...field(0x12, line), ...field(0x1a, trace)])
}

let sessions = 0
/** A new session's log with `steps`, and its id. */
function sessionWith(steps: [number, Uint8Array][] = []) {
  const id = `s-${++sessions}`
  mkdirSync(dirname(sessionLog(id)), { recursive: true })
  const log = new Database(sessionLog(id))
  log.exec("CREATE TABLE `steps` (`idx` integer, `step_type` integer NOT NULL DEFAULT 0, `step_payload` blob, PRIMARY KEY (`idx`))")
  log.close()
  add(id, steps)
  return id
}

function add(id: string, steps: [number, Uint8Array][]) {
  const log = new Database(sessionLog(id))
  const next = log.query<{ idx: number | null }, []>("SELECT max(idx) AS idx FROM steps").get()?.idx ?? -1
  steps.forEach(([type, payload], index) => log.query("INSERT INTO steps VALUES (?, ?, ?)").run(next + 1 + index, type, payload))
  log.close()
}

const plain = (text: string) => new TextEncoder().encode(text)

test("fails a turn whose prompt added an error step, and knows the reply that repeats it", () => {
  const id = sessionWith([[USER_STEP, plain("hi")], [15, plain("thinking")]])
  const check = watchPrompt(id)!
  add(id, [[USER_STEP, plain("again")], [ERROR_STEP, errorPayload(SIGNATURE_LINE)]])
  expect(SIGNATURE_LINE.length).toBeGreaterThan(64)
  const failure = check()!
  expect(failure.message).toBe(SIGNATURE_REJECTED)
  expect(failure.repeats?.(REPLY)).toBe(true)
  expect(failure.repeats?.(`I looked at it.${REPLY}`)).toBe(false)
  expect(failure.repeats?.("⚠ something else")).toBe(false)
})

test("reads the message of an error, without the stack trace, else says only that it stopped", () => {
  const cases: [string, string][] = [
    ["UNAVAILABLE (code 503): The model is overloaded. Try again later.", "The model is overloaded. Try again later."],
    ["Error 429, Message: Too many requests, Status: RESOURCE_EXHAUSTED", "Too many requests"],
    ["RESOURCE_EXHAUSTED (code 429): quota [reason:QUOTA_EXHAUSTED quotaResetDelay:1h]", QUOTA_REACHED],
    ["Something broke", STOPPED_BY_ERROR],
  ]
  for (const [line, message] of cases) {
    const id = sessionWith()
    const check = watchPrompt(id)!
    add(id, [[USER_STEP, plain("hi")], [ERROR_STEP, errorPayload(line)]])
    expect(check()?.message).toBe(message)
  }
})

test("reads the message of an HTTP error, and of the one error a match may not run past", () => {
  // The CLI writes a gateway failure with its HTTP status line in place of a gRPC status, as T3 Code found.
  const badGateway = new Uint8Array([...errorPayload("Error 502, Message: Bad Gateway: Failed to connect to backend API, Status: 502 Bad Gateway, Details: []"), ...plain("\nThe model is currently unreachable.")])
  const twoErrors = errorPayload("Error 500, Message: First, Status: unknown, Details: []\nError 429, Message: Too many requests, Status: RESOURCE_EXHAUSTED, Details: []")
  const cases: [Uint8Array, string][] = [
    [badGateway, "Bad Gateway: Failed to connect to backend API"],
    [twoErrors, "Too many requests"],
  ]
  for (const [payload, message] of cases) {
    const id = sessionWith()
    const check = watchPrompt(id)!
    add(id, [[USER_STEP, plain("hi")], [ERROR_STEP, payload]])
    expect(check()?.message).toBe(message)
  }
})

test("leaves a turn whose prompt added no error step, even when an earlier one ended with one", () => {
  const id = sessionWith([[USER_STEP, plain("hi")], [ERROR_STEP, errorPayload(SIGNATURE_LINE)]])
  const check = watchPrompt(id)!
  expect(check()).toBeUndefined()
  add(id, [[USER_STEP, plain("again")], [15, plain("Done.")]])
  expect(check()).toBeUndefined()
})

test("reads every step of a log the prompt created", () => {
  const id = "s-new"
  const check = watchPrompt(id)!
  const log = new Database(sessionLog(id), { create: true })
  log.exec("CREATE TABLE `steps` (`idx` integer, `step_type` integer NOT NULL DEFAULT 0, `step_payload` blob, PRIMARY KEY (`idx`))")
  log.query("INSERT INTO steps VALUES (0, ?, ?)").run(ERROR_STEP, errorPayload("UNAVAILABLE (code 503): Overloaded"))
  log.close()
  expect(check()?.message).toBe("Overloaded")
})

test("checks nothing when the log is missing or cannot be read", () => {
  expect(watchPrompt("missing")!()).toBeUndefined()
  const id = "broken"
  writeFileSync(sessionLog(id), "not a database")
  expect(watchPrompt(id)).toBeUndefined()
  expect(watchPrompt("../escape")).toBeUndefined()
})
