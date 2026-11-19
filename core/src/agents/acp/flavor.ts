import type { PermissionMode } from "@comet/protocol"
import type { Process } from "../process"
import type { ConnectOptions } from "./connection"
import type { ConfigOption, PermissionRequest } from "./protocol"
import type { ToolReader } from "./tools"

/**
 * One ACP agent, as `AcpSession` runs it. ACP fixes the messages, and each agent fills in what the
 * protocol leaves to it: the process to start, how to connect, its mode names, where its tool calls keep
 * their command, and what a sign-in looks like. The optional hooks cover what only some agents do.
 */
export interface AcpFlavor {
  /**
   * Starts the agent's process in a folder. It throws a sentence the user reads when the agent cannot start.
   * The process should come from `explainEnd`, so that when it ends, the error says how and what it printed.
   */
  launch(dir: string): Process
  readonly connect: ConnectOptions
  /** The agent's mode for one of Comet's permission modes. */
  modeId(mode: PermissionMode): string
  readonly tools: ToolReader
  /** Whether a permission request asks a multiple-choice question instead. */
  isQuestion?(request: PermissionRequest): boolean
  /** Whether a line the agent printed outside the protocol says it waits for a sign-in. */
  needsSignIn?(line: string): boolean
  /**
   * Reads, before a prompt, what is needed to check the prompt once it ends. An agent that reports some
   * failures as a normal end gives this, and the check finds them. It runs unless the turn was stopped.
   * Neither the read nor the check may throw.
   */
  watchPrompt?(sessionId: string): PromptCheck | undefined
  /** The agent asked for a sign-in, so the account is signed out. Answers what the turn says to the user. */
  signedOut(): string
  /**
   * The session's settings as the agent reported them, such as its models. `opened` marks a new
   * session's first report, before Comet changed anything, so its model is the account's default.
   */
  learn(options: readonly ConfigOption[], opened: boolean): void
}

/** Checks a prompt once it ended. Undefined means the turn ends as its stop reason says. */
export type PromptCheck = () => PromptFailure | undefined

/** Why a prompt failed although its stop reason did not say so. */
export interface PromptFailure {
  /** What the turn says to the user. */
  readonly message: string
  /** Whether the text the agent is writing only repeats the error. The error item then takes its place. */
  readonly repeats?: (text: string) => boolean
}
