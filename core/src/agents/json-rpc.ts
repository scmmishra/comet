import { errorMessage } from "../errors"

/** Where a peer's messages come from and go to, one JSON message per line. A test passes its own. */
export interface Transport {
  readonly lines: AsyncIterable<string>
  write(line: string): void
  close(): void
}

/** The id a peer gives a request. */
export type RequestId = number | string

/** JSON-RPC's code for a method the peer does not have. */
export const METHOD_NOT_FOUND = -32601
/** JSON-RPC's code for an error inside a handler. */
const INTERNAL_ERROR = -32603

/** An error that answers a request: one a peer sent back, or one a handler throws to pick the code of its answer. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
  }
}

type Message = { readonly id?: RequestId; readonly method?: string; readonly params?: unknown; readonly result?: unknown; readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown } }

interface Handlers {
  /** A message the peer sent that expects no answer. */
  readonly notification: (method: string, params: unknown) => void
  /**
   * A request the peer sent, with the id the peer gave it. What it returns answers the request, and what
   * it throws answers it with an error.
   */
  readonly request: (method: string, params: unknown, id: RequestId) => unknown
  /** The peer is gone. Every request still waiting has failed with `error`. */
  readonly closed: (error: Error) => void
}

interface Options {
  /** Whether each message carries `"jsonrpc":"2.0"`. ACP agents require it, and Codex's app-server leaves it out. */
  readonly versioned: boolean
  /** A line that is not JSON, since some agents print plain text between messages. */
  readonly stray?: (line: string) => void
}

/**
 * A JSON-RPC peer that speaks one message per line, as Codex's app-server and ACP agents do over stdio.
 * Both sides send requests and notifications.
 */
export class JsonRpc {
  private nextId = 1
  private readonly waiting = new Map<RequestId, { resolve(value: unknown): void; reject(error: Error): void }>()
  private ended?: Error

  constructor(
    private readonly transport: Transport,
    private readonly handlers: Handlers,
    private readonly options: Options,
  ) {
    void this.read()
  }

  /** Asks the peer and waits for its answer. It fails with an RpcError when the peer answers with one, and when the peer is gone. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.ended) return Promise.reject(this.ended)
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.write({ id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  notify(method: string, params?: unknown) {
    if (!this.ended) this.write({ method, ...(params === undefined ? {} : { params }) })
  }

  close() {
    this.end(new Error("The connection was closed."))
    this.transport.close()
  }

  private write(message: Message) {
    this.transport.write(JSON.stringify(this.options.versioned ? { jsonrpc: "2.0", ...message } : message))
  }

  private async read() {
    try {
      for await (const line of this.transport.lines) {
        if (!line.trim()) continue
        let message: Message
        try {
          message = JSON.parse(line)
        } catch {
          this.options.stray?.(line)
          continue
        }
        this.take(message)
      }
      this.end(new Error("The agent's process ended."))
    } catch (error) {
      this.end(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private take(message: Message) {
    if (message.method === undefined) return this.settle(message)
    if (message.id === undefined) return this.handlers.notification(message.method, message.params)
    const id = message.id
    // A handler may answer later, such as a permission request that waits for the user.
    Promise.resolve()
      .then(() => this.handlers.request(message.method!, message.params, id))
      .then(
        (result) => this.ended || this.write({ id, result: result ?? null }),
        (error) => this.ended || this.write({ id, error: { code: error instanceof RpcError && error.code !== undefined ? error.code : INTERNAL_ERROR, message: errorMessage(error) } }),
      )
  }

  private settle(message: Message) {
    const waiting = message.id === undefined ? undefined : this.waiting.get(message.id)
    if (!waiting) return
    this.waiting.delete(message.id!)
    if (message.error) waiting.reject(new RpcError(message.error.message ?? "The agent answered with an error.", message.error.code))
    else waiting.resolve(message.result)
  }

  private end(error: Error) {
    if (this.ended) return
    this.ended = error
    for (const { reject } of this.waiting.values()) reject(error)
    this.waiting.clear()
    this.handlers.closed(error)
  }
}
