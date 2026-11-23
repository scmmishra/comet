import type { AgentFeature, AgentId, AgentInfo, ContextReading, ImageAttachment, McpServer, PermissionAnswer, QueuedMessage, RunSettings, Skill, ThreadEvent, ThreadItem, ThreadSummary } from "@comet/protocol"

/**
 * What Comet needs from a coding agent, such as Claude Code or Codex. An agent runs conversations, keeps
 * their transcripts, and says who is signed in and which models they may use. The rest of the core talks
 * to agents only through these types. Each agent turns its own messages into Comet's thread events, so
 * nothing outside its folder reads them. AGENTS.md lists the steps to add one.
 */
export interface Agent {
  readonly id: AgentId
  /** The agent's name, such as "Claude Code". */
  readonly name: string
  /** What the agent can do beyond a conversation. The core refuses what is not listed, and the app does not offer it. */
  readonly features: readonly AgentFeature[]
  /**
   * Whether the agent resumes a thread in another checkout of its repo, such as a worktree, when Comet names
   * that folder. Such a thread can move: its agent asks through Comet's `move_to_worktree` tool, or moves
   * with a tool of its own and reports it through `onMoved`. It resumes in the new folder from its next
   * turn. Any other agent keeps each thread in the folder it started in.
   */
  readonly movesThreads?: boolean
  /**
   * Whether the agent's threads draw a call of Comet's `show` tool as its visual. They can when the
   * agent's tool calls name their MCP server and tool. Any other agent is not offered `show`, since its
   * thread would show the call as a step and the user would never see the data.
   */
  readonly drawsVisuals?: boolean
  /**
   * Reads whether the agent is installed and signed in, its version and its models, and reports each
   * through the host as it learns it. What it throws shows as the agent's problem.
   */
  inspect(): Promise<void>
  /** Reads the account's plan usage again and reports it through the host. */
  refreshUsage(): Promise<void>
  /** Opens a conversation in a folder. It starts the agent on its first message. */
  open(dir: string, emit: Emit, options: SessionOptions): AgentSession
  /** The conversations the agent saved. */
  readonly threads: AgentThreads
  /**
   * The skills and commands the agent offers in a folder, grouped. Null when the agent could not be asked.
   * An agent that has `slash-commands` runs them from a `/` in a message. An agent that offers none has no such method.
   */
  commands?(dir: string): Promise<Skill[] | null>
  /** The MCP servers the agent loads in a folder, for an agent that has `mcp`. */
  readonly mcp?: AgentMcp
  /** Updates the agent to its newest version. It runs to its end, since stopping an updater midway can leave the agent broken. */
  update?(): Promise<void>
  /** Installs the agent on this Mac. It stops, and leaves the install as it was, once `signal` aborts. */
  install?(signal: AbortSignal): Promise<void>
  /**
   * Signs the user in, in the browser, and resolves once the account is signed in. It publishes the
   * page it opened as `signInLink`, so the user can open it again. It stops once `signal` aborts.
   */
  signIn?(signal: AbortSignal): Promise<void>
  /** Ends what the agent keeps running between conversations, such as a server process. */
  close(): void
}

/** What an agent learned about itself. Each field replaces what Comet knew, and absent fields stay. */
export type AgentReading = Partial<Pick<AgentInfo, "state" | "problem" | "version" | "account" | "models" | "usage" | "signInLink">>

/** What the core gives an agent: where to report what it learns, and the settings it reads. */
export interface AgentHost {
  readonly publish: (reading: AgentReading) => void
  /** Whether to compact a large thread that sat idle, read at each ask. */
  readonly compactIdle: () => boolean
}

export type Emit = (event: ThreadEvent) => void

/**
 * The MCP servers an agent loads in a folder. Each call publishes the list as soon as there is one, and
 * again each time it changes while servers connect. Null means the agent could not be asked.
 */
export interface AgentMcp {
  read(dir: string, publish: (servers: McpServer[] | null) => void): Promise<void>
  /** Turns a server on or off, then publishes the servers as they change. */
  toggle(dir: string, name: string, enabled: boolean, publish: (servers: McpServer[] | null) => void): Promise<void>
}

/** Tools Comet offers a session over MCP, such as handing work to another agent. The agent adds the server to the session under `SERVER_NAME`. */
export interface ToolServer {
  readonly url: string
  /** The Authorization header that names the session to Comet. */
  readonly authorization: string
  /** What to tell the model about the tools, added to its instructions. */
  readonly instructions: string
}

export interface SessionOptions {
  /** A session to continue, from an earlier run of Comet. */
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
  /** Called when the agent lost the session, such as one it could not find to resume. The next message starts a new one, so the id is dropped. */
  readonly onSessionLost?: () => void
  /** Called when the agent renames the session itself, such as from a `/rename` in a message. The agent has already saved the title. */
  readonly onRenamed?: (title: string) => void
  /** Called when the agent moved its session into another folder with a tool of its own, such as a worktree it entered. */
  readonly onMoved?: (dir: string) => void
  /**
   * Called when a turn ends without messages sent into it, which the agent never read, such as a steer that
   * a Force stop cut off or that the agent exited before reading. The window puts them first in the queue.
   */
  readonly onUnsent?: (messages: readonly QueuedMessage[]) => void
  readonly tools?: ToolServer
  /** Whether the session leaves no saved thread, such as work one agent hands another. Its transcript is not listed or resumed. */
  readonly ephemeral?: boolean
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
  /** Sends a message into the running turn. Only an agent with `steer` has it. */
  steer?(text: string, images?: readonly ImageAttachment[]): void
  /** Asks the turn to stop. A turn that has not stopped in time is reported as unresponsive. */
  interrupt(): Promise<void>
  /** Ends a turn that did not stop when asked, as stopped. Says whether there was a stop to force. */
  forceStop(): boolean
  /** Changes how the thread runs. A running thread takes the change from its next reply. */
  configure(settings: RunSettings): Promise<void>
  answerPermission(requestId: string, answer: PermissionAnswer): void
  answerQuestion(requestId: string, answers: Readonly<Record<string, string>> | undefined): void
  /** Stops commands running in the background. An agent that shows none has no such method. */
  stopTasks?(ids: readonly string[]): Promise<void>
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

/** How many threads an agent lists for a project. Enough for thread search to reach back months. */
export const THREAD_LIMIT = 200

/** A thread as an agent lists it. `dir` is the folder it started in, when the agent records one. */
export type ListedThread = Omit<ThreadSummary, "agent" | "tabId" | "project"> & { readonly dir?: string }

/** The conversations an agent saved, by the id its sessions report. Each optional method needs the feature of its name. */
export interface AgentThreads {
  /** A project's newest threads. A failed read gives none, because the list is a convenience. */
  list(dir: string): Promise<ListedThread[]>
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
