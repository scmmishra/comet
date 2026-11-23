import type { PermissionMode } from "@comet/protocol"
import type { Process } from "../process"
import type { ConnectOptions } from "./connection"
import type { ConfigOption, PermissionRequest, SessionUpdate, ToolCall } from "./protocol"
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
  /** Whether a permission request asks to run one of Comet's own tools, which Comet approves itself. */
  isCometTool?(request: PermissionRequest): boolean
  /** Whether a line the agent printed outside the protocol says it waits for a sign-in. */
  needsSignIn?(line: string): boolean
  /**
   * Reads what is needed to check, once a turn ends, the work the agent did since. An agent that reports
   * some failures as a normal end gives this, and the check finds them. It is read before each prompt. For
   * an agent with `background` work, it is also read when a prompt answers while that work goes on, and when
   * a turn ends, for a turn the agent may start next. The check runs unless the turn was stopped. Neither the
   * read nor the check may throw.
   */
  watchPrompt?(sessionId: string): PromptCheck | undefined
  /**
   * Set for an agent that goes on working after its prompt answers. It runs some calls past the prompt,
   * and replies by itself once they end. The turn then stays open until that work and its reply end.
   */
  readonly background?: BackgroundWork
  /** The agent asked for a sign-in, so the account is signed out. Answers what the turn says to the user. */
  signedOut(): string
  /**
   * The session's settings as the agent reported them, such as its models. `opened` marks a new
   * session's first report, before Comet changed anything, so its model is the account's default.
   */
  learn(options: readonly ConfigOption[], opened: boolean): void
}

/** What an agent that works past its prompt says about that work. */
export interface BackgroundWork {
  /** Whether a running call goes on after the prompt answers, so that the turn waits for it to end. */
  outlivesPrompt(call: ToolCall): boolean
  /** Whether an update ends a reply. A reply the agent starts by itself has no prompt to answer, so this ends it. */
  endsReply(update: SessionUpdate): boolean
}

/** Checks a turn once it ended. Undefined means the turn ends as its stop reason says. */
export type PromptCheck = () => PromptFailure | undefined

/** Why a turn failed although the agent ended it as normal. */
export interface PromptFailure {
  /** What the turn says to the user. */
  readonly message: string
  /** Whether the text the agent is writing only repeats the error. The error item then takes its place. */
  readonly repeats?: (text: string) => boolean
}
