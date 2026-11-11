import type { PermissionMode } from "@desk/protocol"
import type { Process } from "../process"
import type { ClientInfo, ConfigOption, InitializeResult, PermissionRequest } from "./protocol"
import type { ToolReader } from "./tools"

/**
 * What one ACP agent adds to the protocol, so `AcpSession` can run it: how to start it, how it names its
 * modes, where it keeps a tool call's command, and what to do when it needs a sign-in.
 */
export interface AcpFlavor {
  /** Starts the agent's process in a folder. It throws a sentence the user reads when the agent cannot start. */
  launch(dir: string): Process
  readonly clientInfo: ClientInfo
  /** The method to authenticate with after `initialize`. */
  readonly authMethod?: string
  /** The agent's mode for one of Desk's permission modes. */
  modeId(mode: PermissionMode): string
  /** The agent's own `_meta` for a new or resumed session, chosen from what it said in `initialize`. */
  sessionMeta?(agent: InitializeResult): Record<string, unknown> | undefined
  readonly tools: ToolReader
  /** Whether a permission request asks a multiple-choice question instead. */
  isQuestion?(request: PermissionRequest): boolean
  /** Whether a line the agent printed outside the protocol says it waits for a sign-in. */
  needsSignIn?(line: string): boolean
  /** What a turn says when the agent needs the user to sign in. */
  readonly signInProblem: string
  /** The agent asked for a sign-in, so the account is signed out. */
  signedOut(): void
  /**
   * The session's settings as the agent reported them, such as its models. `opened` marks a new
   * session's first report, before Desk changed anything, so its model is the account's default.
   */
  learn(options: readonly ConfigOption[], opened: boolean): void
  /** Where the agent's threads are saved, as `ThreadRecord` keeps them. */
  threadsFolder(): string
}
