import type { Transport } from "../json-rpc"
import type { CodexModel } from "./protocol"

type Message = { readonly id?: number | string; readonly method?: string; readonly params?: any; readonly result?: any; readonly error?: { readonly code?: number; readonly message: string } }
type Answer = (params: any) => unknown

const model = (id: string, displayName: string, extra: Partial<CodexModel> = {}): CodexModel => ({
  id,
  displayName,
  description: `${displayName} model`,
  hidden: false,
  isDefault: false,
  supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
  defaultReasoningEffort: "low",
  serviceTiers: [{ id: "priority" }],
  ...extra,
})

/** Models as `model/list` gives them: a default, another without Fast, and one Codex hides. */
export const MODELS = [model("gpt-6.1-sol", "GPT-6.1-Sol", { isDefault: true }), model("gpt-6-luna", "GPT-6-Luna", { serviceTiers: [], defaultReasoningEffort: "high" }), model("codex-auto-review", "Auto review", { hidden: true })]

/** The user agent Codex 0.167 answers `initialize` with. */
export const USER_AGENT = "desk/0.167.0 (Mac OS 26.6.2; arm64) unknown (desk; 0.0.1)"

/**
 * A Codex app-server a test plays, over an in-memory transport. It answers each request whose method
 * has an answer, and records every message Desk sent. Each launch is a new process, so a test can end
 * one and see Desk start the next.
 */
export function fakeAppServer() {
  const written: Message[] = []
  const answers = new Map<string, Answer>([["initialize", () => ({ userAgent: USER_AGENT })]])
  let current: { say(message: Message): void; hangUp(): void } | undefined
  let launches = 0

  const launch = (): Transport => {
    launches++
    const queue: string[] = []
    let wake: (() => void) | undefined
    let closed = false
    const say = (message: Message) => {
      queue.push(JSON.stringify(message))
      wake?.()
    }
    const hangUp = () => {
      closed = true
      wake?.()
    }
    current = { say, hangUp }
    return {
      lines: (async function* () {
        while (true) {
          while (queue.length) yield queue.shift()!
          if (closed) return
          await new Promise<void>((resolve) => (wake = resolve))
        }
      })(),
      write: (line) => {
        const message: Message = JSON.parse(line)
        written.push(message)
        const answer = message.method !== undefined && message.id !== undefined ? answers.get(message.method) : undefined
        if (!answer) return
        Promise.resolve()
          .then(() => answer(message.params))
          .then(
            (result) => say({ id: message.id, result }),
            (error: Error) => say({ id: message.id, error: { message: error.message } }),
          )
      },
      close: hangUp,
    }
  }

  return {
    launch,
    get launches() {
      return launches
    },
    /** Answers every later request of `method`, with a value or with what a function of its params returns or throws. */
    answer(method: string, answer: unknown) {
      answers.set(method, typeof answer === "function" ? (answer as Answer) : () => answer)
    },
    /** The params of each request and notification Desk sent with `method`. */
    sent: (method: string) => written.filter((message) => message.method === method).map((message) => message.params),
    /** Desk's reply to the request Codex sent with `id`, once it has written one. */
    reply: (id: number | string) => written.find((message) => message.method === undefined && message.id === id),
    notify: (method: string, params: object) => current!.say({ method, params }),
    /** Codex asks Desk something, such as an approval. */
    ask: (id: number | string, method: string, params: object) => current!.say({ id, method, params }),
    /** The app-server's process ends. */
    hangUp: () => current!.hangUp(),
  }
}
