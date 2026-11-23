import { JsonRpc, METHOD_NOT_FOUND, RpcError } from "../json-rpc"
import type { Process } from "../process"
import {
  PROTOCOL_VERSION,
  type ClientInfo,
  type ConfigOption,
  type ContentBlock,
  type McpServer,
  type PermissionRequest,
  type PermissionResponse,
  type SessionNotification,
  type SessionSetup,
  type StopReason,
} from "./protocol"

/**
 * How long an agent has to answer each call that starts a session, as in T3 Code: `initialize`, then
 * `session/new` or `session/resume`. The bound is per call. Resuming a long thread may take longer than
 * `initialize`, and 90 seconds leaves it room. `authenticate` has no bound, since it waits while the user
 * signs in with Google in the browser.
 */
export const START_TIMEOUT_MS = 90_000

/** What the client does with the messages an agent sends it. */
export interface AcpClient {
  readonly update: (notification: SessionNotification) => void
  /** Answers once the user has chosen, or once the turn is cancelled. */
  readonly permission: (request: PermissionRequest) => Promise<PermissionResponse>
  /** The agent is gone. Every request still waiting has failed with `error`. */
  readonly closed: (error: Error) => void
  /** A line the agent printed outside the protocol: on stdout, a line that is not a message, and every line on stderr. */
  readonly stray?: (line: string) => void
}

/** How the client connects: who it says it is, and how it authenticates. */
export interface ConnectOptions {
  readonly clientInfo: ClientInfo
  /** The method to authenticate with right after `initialize`. Without it, Comet relies on the agent's own sign-in. */
  readonly authMethod?: string
}

/** What a session is opened with. */
interface SessionParams {
  readonly cwd: string
  readonly mcpServers: readonly McpServer[]
}

/**
 * A connection to one ACP agent process, initialized and authenticated. Comet offers the agent neither
 * its file system nor its terminals, so the agent uses its own. Requests Comet does not handle are refused.
 */
export class AcpConnection {
  private constructor(private readonly rpc: JsonRpc) {}

  /** Initializes the agent in `process`, then authenticates. A connection that fails to open is closed. */
  static async open(process: Process, client: AcpClient, options: ConnectOptions): Promise<AcpConnection> {
    if (client.stray) process.onStderrLine(client.stray)
    const rpc = new JsonRpc(
      process,
      {
        notification: (method, params) => method === "session/update" && client.update(params as SessionNotification),
        request: (method, params) => {
          if (method === "session/request_permission") return client.permission(params as PermissionRequest)
          throw new RpcError(`Comet does not handle ${method}.`, METHOD_NOT_FOUND)
        },
        closed: client.closed,
      },
      { versioned: true, ...(client.stray ? { stray: client.stray } : {}) },
    )
    try {
      await answerInTime(rpc, "initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: options.clientInfo,
      })
      if (options.authMethod) await rpc.request("authenticate", { methodId: options.authMethod })
      return new AcpConnection(rpc)
    } catch (error) {
      rpc.close()
      throw error
    }
  }

  newSession(params: SessionParams): Promise<SessionSetup> {
    return answerInTime(this.rpc, "session/new", params)
  }

  /** Continues a saved session without replaying its history, as `session/load` would. */
  resumeSession(sessionId: string, params: SessionParams): Promise<SessionSetup> {
    return answerInTime(this.rpc, "session/resume", { sessionId, ...params })
  }

  /** Runs a turn. It answers once the turn has ended, also after a cancel. */
  async prompt(sessionId: string, prompt: readonly ContentBlock[]): Promise<StopReason> {
    return (await this.rpc.request<{ stopReason: StopReason }>("session/prompt", { sessionId, prompt })).stopReason
  }

  /**
   * Asks the running turn to stop. The turn's prompt then answers, normally with `cancelled`. An agent that
   * works past its prompt may also stop that work, with no prompt open.
   */
  cancel(sessionId: string) {
    this.rpc.notify("session/cancel", { sessionId })
  }

  async setMode(sessionId: string, modeId: string) {
    await this.rpc.request("session/set_mode", { sessionId, modeId })
  }

  /** Changes a setting, and answers every setting as it now stands, since one may change others. */
  async setConfigOption(sessionId: string, configId: string, value: string): Promise<readonly ConfigOption[] | undefined> {
    return (await this.rpc.request<{ configOptions?: ConfigOption[] } | null>("session/set_config_option", { sessionId, configId, value }))?.configOptions
  }

  /** Ends the connection, which ends the agent's process. */
  close() {
    this.rpc.close()
  }
}

/**
 * Asks the agent a call that starts a session. An agent that never answers would leave its turn starting
 * for good, so after `START_TIMEOUT_MS` the call fails and the connection closes, which ends the process.
 */
async function answerInTime<T>(rpc: JsonRpc, method: string, params: unknown): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const silent = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Rejected first: closing fails the pending request, and its message would win the race.
      reject(new Error(`The agent did not answer ${method} in ${START_TIMEOUT_MS / 1000} seconds, so Comet stopped it. The next message starts it again.`))
      rpc.close()
    }, START_TIMEOUT_MS)
  })
  try {
    return await Promise.race([rpc.request<T>(method, params), silent])
  } finally {
    clearTimeout(timer)
  }
}
