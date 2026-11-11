import { JsonRpc, METHOD_NOT_FOUND, RpcError, type Transport } from "../json-rpc"
import {
  PROTOCOL_VERSION,
  type ClientInfo,
  type ConfigOption,
  type ContentBlock,
  type InitializeResult,
  type McpServer,
  type PermissionRequest,
  type PermissionResponse,
  type SessionNotification,
  type SessionSetup,
  type StopReason,
} from "./protocol"

/** What the client does with the messages an agent sends it. */
export interface AcpClient {
  readonly update: (notification: SessionNotification) => void
  /** Answers once the user has chosen, or once the turn is cancelled. */
  readonly permission: (request: PermissionRequest) => Promise<PermissionResponse>
  /** The agent is gone. Every request still waiting has failed with `error`. */
  readonly closed: (error: Error) => void
  /** A line the agent printed that is not a message. */
  readonly stray?: (line: string) => void
}

export interface ConnectOptions {
  readonly clientInfo: ClientInfo
  /** The method to authenticate with right after `initialize`. Without it, Desk relies on the agent's own sign-in. */
  readonly authMethod?: string
}

/** What a session is opened with. `meta` is the agent's own extension of the request. */
export interface SessionParams {
  readonly cwd: string
  readonly mcpServers: readonly McpServer[]
  readonly meta?: Record<string, unknown>
}

/**
 * A connection to one ACP agent process, initialized and authenticated. Desk offers the agent neither
 * its file system nor its terminals, so the agent uses its own. Requests Desk does not handle are refused.
 */
export class AcpConnection {
  private constructor(
    private readonly rpc: JsonRpc,
    /** What the agent said about itself in `initialize`. */
    readonly agent: InitializeResult,
  ) {}

  /** Initializes the agent on `transport`, then authenticates. A connection that fails to open is closed. */
  static async open(transport: Transport, client: AcpClient, options: ConnectOptions): Promise<AcpConnection> {
    const rpc = new JsonRpc(
      transport,
      {
        notification: (method, params) => method === "session/update" && client.update(params as SessionNotification),
        request: (method, params) => {
          if (method === "session/request_permission") return client.permission(params as PermissionRequest)
          throw new RpcError(`Desk does not handle ${method}.`, METHOD_NOT_FOUND)
        },
        closed: client.closed,
      },
      { versioned: true, ...(client.stray ? { stray: client.stray } : {}) },
    )
    try {
      const agent = await rpc.request<InitializeResult>("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: options.clientInfo,
      })
      if (options.authMethod) await rpc.request("authenticate", { methodId: options.authMethod })
      return new AcpConnection(rpc, agent)
    } catch (error) {
      rpc.close()
      throw error
    }
  }

  newSession(params: SessionParams): Promise<SessionSetup> {
    return this.rpc.request("session/new", sessionRequest(params))
  }

  /** Continues a saved session without replaying its history, as `session/load` would. */
  resumeSession(sessionId: string, params: SessionParams): Promise<SessionSetup> {
    return this.rpc.request("session/resume", { sessionId, ...sessionRequest(params) })
  }

  /** Runs a turn. It answers once the turn has ended, also after a cancel. */
  async prompt(sessionId: string, prompt: readonly ContentBlock[]): Promise<StopReason> {
    return (await this.rpc.request<{ stopReason: StopReason }>("session/prompt", { sessionId, prompt })).stopReason
  }

  /** Asks the running turn to stop. The turn's prompt then answers, normally with `cancelled`. */
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

function sessionRequest({ cwd, mcpServers, meta }: SessionParams) {
  return { cwd, mcpServers, ...(meta ? { _meta: meta } : {}) }
}
