import type { AgentFeature, AgentId, AgentInfo, ContextReading, ImageAttachment, PermissionAnswer, RunSettings, ThreadEvent, ThreadItem, ThreadSummary } from "@desk/protocol"

/**
 * What Desk needs from a coding agent, such as Claude Code or Codex. An agent runs conversations, keeps
 * their transcripts, and says who is signed in and which models they may use. The rest of the core talks
 * to agents only through these types, so adding an agent means writing one of these and listing it in
 * `registry.ts`. Each agent turns its own messages into Desk's thread events, so nothing outside its
 * folder reads them.
 */
export interface Agent {
  readonly id: AgentId
  /** The agent's name, such as "Claude Code". */
  readonly name: string
  /** What the agent can do beyond a conversation. The core refuses what is not listed, and the app does not offer it. */
  readonly features: readonly AgentFeature[]
  /**
   * Reads whether the agent is installed and signed in, its version and its models, and reports each
   * through the host as it learns it. A failed read reports what to do about it and does not throw.
   */
  inspect(): Promise<void>
  /** Reads the account's plan usage again and reports it through the host. */
  refreshUsage(): Promise<void>
  /** Opens a conversation in a folder. It starts the agent on its first message. */
  open(dir: string, emit: Emit, options: SessionOptions): AgentSession
  /** The conversations the agent saved. */
  readonly threads: AgentThreads
  /** Updates the agent with its own updater. */
  update?(): Promise<void>
  /** Installs the agent on this Mac. */
  install?(): Promise<void>
  /** Signs the user in, in the browser. It resolves once the account is signed in. */
  signIn?(): Promise<void>
  /** Ends what the agent keeps running between conversations, such as a server process. */
  close(): void
}

/** What an agent learned about itself. Each field replaces what Desk knew, and absent fields stay. */
export type AgentReading = Partial<Pick<AgentInfo, "state" | "problem" | "version" | "account" | "models" | "usage">>

/** What the core gives an agent: where to report what it learns, and the settings it reads. */
export interface AgentHost {
  readonly publish: (reading: AgentReading) => void
  /** Whether to compact a large thread that sat idle, read at each ask. */
  readonly compactIdle: () => boolean
}

export type Emit = (event: ThreadEvent) => void

/** Tools Desk offers a session over MCP, such as handing work to another agent. The agent adds the server to the session under `name`. */
export interface ToolServer {
  readonly name: string
  readonly url: string
  /** The Authorization header that names the session to Desk. */
  readonly authorization: string
  /** What to tell the model about the tools, added to its instructions. */
  readonly instructions: string
}

export interface SessionOptions {
  /** A session to continue, from an earlier run of Desk. */
  readonly resume?: string
  /**
   * Where a rewound thread resumes, as the agent's `threads.rewind` named it. The agent drops what follows
   * once the next turn runs, and `onResumedAt` says when that turn has ended.
   */
  readonly resumeAt?: string
  readonly onResumedAt?: () => void
  readonly settings: RunSettings
  /** Called when the agent names the session, so it can be resumed later. */
  readonly onSessionId: (id: string) => void
  readonly tools?: ToolServer
}

/**
 * One conversation with an agent, in one folder. It reports everything through the `Emit` it was opened
 * with: each item of the thread, and a `status` event when a turn starts and when it ends. A session that
 * fails emits an `error` item and ends its turn, and the next message starts it again.
 */
export interface AgentSession {
  /** Whether a turn runs, from a message until its turn's final result. */
  readonly busy: boolean
  /** Starts a turn with a message. */
  send(text: string, images?: readonly ImageAttachment[]): void
  /** Sends a message into the running turn. An agent without `steer` starts a turn with it once the running one ends. */
  steer(text: string, images?: readonly ImageAttachment[]): void
  /** Asks the turn to stop. A turn that has not stopped in time is reported as unresponsive. */
  interrupt(): Promise<void>
  /** Ends a turn that did not stop when asked, as stopped. Says whether there was a stop to force. */
  forceStop(): boolean
  /** Changes how the thread runs. A running thread takes the change from its next reply. */
  configure(settings: RunSettings): Promise<void>
  answerPermission(requestId: string, answer: PermissionAnswer): void
  answerQuestion(requestId: string, answers: Readonly<Record<string, string>> | undefined): void
  /** Stops commands running in the background. */
  stopTasks(ids: readonly string[]): Promise<void>
  /** Restores the files the agent's tools changed from a message on. Only an agent with `restore-files` has it. */
  restoreFiles?(messageId: string): Promise<void>
  close(): void
}

/** Where a thread stands after a rewind. */
export type Rewound =
  /** The rewind took the thread's first message, so nothing is left to resume. */
  | { readonly empty: true }
  /**
   * The thread resumes. With `resumeAt`, the transcript keeps the rewound messages until the next turn
   * runs, and the session resumes there. Without it, the transcript is already cut.
   */
  | { readonly empty: false; readonly resumeAt?: string }

/** The conversations an agent saved, by the id its sessions report. Each optional method needs the feature of its name. */
export interface AgentThreads {
  /** A project's newest threads. A failed read gives none, because the list is a convenience. */
  list(dir: string): Promise<Omit<ThreadSummary, "agent" | "tabId">[]>
  /** A thread read back from the agent's transcript. */
  history(dir: string, threadId: string): Promise<ThreadItem[]>
  /** How full a thread's context is, when it can be read without running a turn. */
  context(dir: string, threadId: string): Promise<ContextReading | undefined>
  rename?(dir: string, threadId: string, title: string): Promise<void>
  /** Copies a thread into a new one, ending with the turn of `messageId` when given. Returns the copy's id. */
  fork?(dir: string, threadId: string, copy: { readonly title: string; readonly messageId?: string }): Promise<string>
  delete?(dir: string, threadId: string): Promise<void>
  /** Takes a thread back to before one of the user's messages. */
  rewind?(dir: string, threadId: string, messageId: string): Promise<Rewound>
}

/** Fails with a sentence the user reads when an agent lacks what was asked of it. */
export function requireFeature(agent: Pick<Agent, "name" | "features">, feature: AgentFeature, action: string) {
  if (!agent.features.includes(feature)) throw new Error(`${agent.name} cannot ${action}.`)
}
