import { version as coreVersion } from "../../../package.json"
import { JsonRpc, METHOD_NOT_FOUND, RpcError, type RequestId, type Transport } from "../json-rpc"
import { explainEnd, run } from "../process"
import { codexPath, CodexMissing } from "./executable"

/** Starts an app-server and gives its stdio. A test passes its own. */
export type Launch = () => Transport

/** How Comet names itself to Codex. The core does not know Comet's version, so it gives its own. */
const CLIENT_INFO = { name: "comet", title: "Comet", version: coreVersion }

/** How long Codex has to answer `initialize`, as in T3 Code. It answers in under a second, and a slow first start has room. */
const INITIALIZE_TIMEOUT_MS = 30_000

/**
 * Runs `codex app-server`, which speaks one JSON message per line over stdio. It throws `CodexMissing` when
 * Comet finds no Codex. If the process ends, the error says how and what it printed on stderr.
 */
export const launchCodex: Launch = () => {
  const path = codexPath()
  if (!path) throw new CodexMissing()
  return explainEnd(run([path, "app-server"]), "Codex")
}

/** What a request or a notification about one thread carries. Codex's older approvals name the thread `conversationId`. */
export type ThreadParams = { readonly threadId?: string; readonly conversationId?: string } & Record<string, unknown>

/** Whoever drives a thread: a session, which hears the thread's notifications and answers its requests. */
export interface ThreadOwner {
  notify(method: string, params: ThreadParams): void
  /**
   * Answers a request about the thread, which may wait for the user, or gives undefined for a request it
   * does not handle. `id` is the request's JSON-RPC id, which Codex names when it settles the request itself.
   */
  request(method: string, params: ThreadParams, id: RequestId): Promise<unknown> | undefined
  /** The app-server is gone, and with it every thread it had loaded. */
  lost(error: Error): void
}

type Listener = (params: never) => void

/**
 * One Codex app-server, shared by Comet's Codex sessions, its thread list and its settings. It starts on
 * the first request. Codex keeps many threads in one process, so the server sends each thread's messages
 * to the owner that claimed the thread. If the process ends, every owner hears so, and the next request
 * starts a new process.
 */
export class AppServer {
  private connection?: Promise<{ readonly rpc: JsonRpc; readonly version?: string }>
  private rpc?: JsonRpc
  private readonly owners = new Map<string, ThreadOwner>()
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(private readonly launch: Launch) {}

  /** Asks the app-server, starting it first if it is not running. */
  async request<T>(method: string, params?: unknown): Promise<T> {
    return (await this.connect()).rpc.request<T>(method, params)
  }

  /** The Codex version that runs, as its handshake reports it. */
  async version(): Promise<string | undefined> {
    return (await this.connect()).version
  }

  /** Sends a thread's notifications and requests to `owner`, until the returned function releases it. */
  own(threadId: string, owner: ThreadOwner): () => void {
    this.owners.set(threadId, owner)
    return () => this.owners.get(threadId) === owner && this.owners.delete(threadId)
  }

  /** Calls `listener` with each notification of `method` that is about no thread, such as a rate-limit update. */
  on<T>(method: string, listener: (params: T) => void): () => void {
    const set = this.listeners.get(method) ?? new Set()
    set.add(listener as Listener)
    this.listeners.set(method, set)
    return () => set.delete(listener as Listener)
  }

  /** Ends the app-server. Its threads' owners hear it is gone. */
  close() {
    this.rpc?.close()
  }

  private connect() {
    this.connection ??= this.open().catch((error) => {
      this.connection = undefined
      throw error
    })
    return this.connection
  }

  private async open() {
    const rpc = new JsonRpc(
      this.launch(),
      {
        notification: (method, params) => this.route(method, params as ThreadParams),
        request: (method, params, id) => this.answer(method, params as ThreadParams, id),
        closed: (error) => this.lost(rpc, error),
      },
      { versioned: false },
    )
    this.rpc = rpc
    const { userAgent } = await this.greet(rpc)
    rpc.notify("initialized")
    return { rpc, version: installedVersion(userAgent) }
  }

  /**
   * Greets the app-server. One that never answers would hold every request behind it, so it is closed after
   * `INITIALIZE_TIMEOUT_MS`. Closing it clears the connection, so the next request starts a new process.
   */
  private async greet(rpc: JsonRpc) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const silent = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Rejected first: closing fails the pending request, and its message would win the race.
        reject(new Error(`Codex did not answer its first message in ${INITIALIZE_TIMEOUT_MS / 1000} seconds, so Comet stopped it. The next request starts it again.`))
        rpc.close()
      }, INITIALIZE_TIMEOUT_MS)
    })
    try {
      return await Promise.race([rpc.request<{ userAgent: string }>("initialize", { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } }), silent])
    } finally {
      clearTimeout(timer)
    }
  }

  private route(method: string, params: ThreadParams) {
    const owner = params?.threadId === undefined ? undefined : this.owners.get(params.threadId)
    if (owner) return owner.notify(method, params)
    for (const listener of this.listeners.get(method) ?? []) listener(params as never)
  }

  private answer(method: string, params: ThreadParams, id: RequestId) {
    const threadId = params?.threadId ?? params?.conversationId
    const reply = threadId === undefined ? undefined : this.owners.get(threadId)?.request(method, params, id)
    if (!reply) throw new RpcError("Comet does not handle that request.", METHOD_NOT_FOUND)
    return reply
  }

  private lost(rpc: JsonRpc, error: Error) {
    if (this.rpc !== rpc) return
    this.rpc = undefined
    this.connection = undefined
    const owners = new Set(this.owners.values())
    this.owners.clear()
    for (const owner of owners) owner.lost(error)
  }
}

/** Codex's version from its user agent, such as "comet/0.167.0 (Mac OS 26.6.2; arm64) …". */
const installedVersion = (userAgent: string) => /^[^/\s]+\/(\S+)/.exec(userAgent)?.[1]
