import type { Process } from "../json-rpc"
import type { ConfigOption, SessionUpdate } from "./protocol"

type Message = { readonly jsonrpc?: string; readonly id?: number | string; readonly method?: string; readonly params?: any; readonly result?: any; readonly error?: any }
type Handler = (params: any) => unknown

/** Settings a fake session reports: two models, of which the first has thinking levels. */
export const FAKE_OPTIONS: ConfigOption[] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gemini-pro",
    options: [{ group: "google", options: [{ value: "gemini-pro", name: "Gemini Pro", description: "Google's best" }] }, { value: "claude-sonnet", name: "Claude Sonnet" }],
  },
  { id: "thinking", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
]

/**
 * An ACP agent for tests, as a process that runs no program. It answers the client's requests with
 * `handlers`, else with a default answer, and records every message the client wrote. A prompt waits
 * until the test ends the turn. The test can send updates and requests of its own, print stray lines, and
 * end the process.
 */
export function fakeAcpAgent(handlers: Record<string, Handler> = {}) {
  const written: Message[] = []
  const queue: string[] = []
  let wake: (() => void) | undefined
  let ended = false
  let exit: (code: number) => void = () => {}
  let stderr = ""
  let nextId = 1
  const waiting = new Map<number | string, (result: unknown) => void>()
  let endPrompt: ((stopReason: string) => void) | undefined
  let options = FAKE_OPTIONS

  const say = (message: object | string) => {
    queue.push(typeof message === "string" ? message : JSON.stringify(message))
    wake?.()
  }
  const end = () => {
    ended = true
    wake?.()
    exit(1)
  }
  const defaults: Record<string, Handler> = {
    initialize: () => ({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } }, agentInfo: { name: "fake-acp", version: "1.4.5" } }),
    authenticate: () => ({}),
    "session/new": () => ({ sessionId: "s1", configOptions: options, modes: { currentModeId: "default" } }),
    "session/resume": () => ({ configOptions: options, modes: { currentModeId: "default" } }),
    "session/set_mode": () => ({}),
    "session/set_config_option": ({ configId, value }) => {
      options = options.map((option) => (option.id === configId ? { ...option, currentValue: value } : option))
      return { configOptions: options }
    },
    "session/prompt": () => new Promise((resolve) => (endPrompt = (stopReason) => resolve({ stopReason }))),
  }
  const answer = (message: Message) => {
    const handler = handlers[message.method!] ?? defaults[message.method!]
    Promise.resolve()
      .then(() => (handler ? handler(message.params) : null))
      .then(
        (result) => say({ jsonrpc: "2.0", id: message.id, result: result ?? null }),
        (error: { code?: number; message?: string }) => say({ jsonrpc: "2.0", id: message.id, error: { code: error.code ?? -32603, message: error.message ?? "failed" } }),
      )
  }

  const process: Process = {
    lines: (async function* () {
      while (true) {
        while (queue.length) yield queue.shift()!
        if (ended) return
        await new Promise<void>((resolve) => (wake = resolve))
      }
    })(),
    write(line) {
      const message: Message = JSON.parse(line)
      written.push(message)
      if (message.method && message.id !== undefined) answer(message)
      else if (!message.method && message.id !== undefined) waiting.get(message.id)?.(message.result)
    },
    close: end,
    stderr: () => stderr,
    exited: new Promise<number>((resolve) => (exit = resolve)),
  }

  return {
    process,
    /** Every message the client wrote, in order. */
    written,
    /** The params of each request or notification the client sent with `method`. */
    sent: (method: string) => written.filter((message) => message.method === method).map((message) => message.params),
    update: (update: SessionUpdate, sessionId = "s1") => say({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } }),
    /** Asks the client, and resolves with its answer. */
    request(method: string, params: unknown): Promise<any> {
      const id = `agent-${nextId++}`
      return new Promise((resolve) => {
        waiting.set(id, resolve)
        say({ jsonrpc: "2.0", id, method, params })
      })
    },
    /** Prints a line that is not a message. */
    print: (line: string) => say(line),
    /** Ends the running prompt's turn. */
    endTurn: (stopReason = "end_turn") => endPrompt?.(stopReason),
    /** Ends the process, after printing `text` on stderr. */
    die(text = "") {
      stderr = text
      end()
    },
  }
}
