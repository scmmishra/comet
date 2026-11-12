import type { PermissionMode } from "@desk/protocol"
import type { Process } from "../process"
import type { ConnectOptions } from "./connection"
import type { ConfigOption, InitializeResult, PermissionRequest } from "./protocol"
import type { ToolReader } from "./tools"

/**
 * One ACP agent, as `AcpSession` runs it. ACP fixes the messages, and each agent fills in what the
 * protocol leaves to it: the process to start, how to connect, its mode names, where its tool calls keep
 * their command, and what a sign-in looks like. The optional hooks cover what only some agents do.
 */
export interface AcpFlavor {
  /** Starts the agent's process in a folder. It throws a sentence the user reads when the agent cannot start. */
  launch(dir: string): Process
  readonly connect: ConnectOptions
  /** The agent's mode for one of Desk's permission modes. */
  modeId(mode: PermissionMode): string
  /** The agent's own `_meta` for a new or resumed session, chosen from what it said in `initialize`. */
  sessionMeta?(agent: InitializeResult): Record<string, unknown> | undefined
  readonly tools: ToolReader
  /** Whether a permission request asks a multiple-choice question instead. */
  isQuestion?(request: PermissionRequest): boolean
  /** Whether a line the agent printed outside the protocol says it waits for a sign-in. */
  needsSignIn?(line: string): boolean
  /** The agent asked for a sign-in, so the account is signed out. Answers what the turn says to the user. */
  signedOut(): string
  /**
   * The session's settings as the agent reported them, such as its models. `opened` marks a new
   * session's first report, before Desk changed anything, so its model is the account's default.
   */
  learn(options: readonly ConfigOption[], opened: boolean): void
}
