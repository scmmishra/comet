/** Messages between the Desk app and the core, sent as JSON over one WebSocket. */

export const PROTOCOL_VERSION = 1

/** The line the core prints on stdout once it listens, so the app knows where to connect. */
export interface CoreReady {
  readonly ready: true
  readonly port: number
}

/**
 * One step of a thread, already shaped for drawing. The core turns the Agent SDK's messages into
 * these, so the app never reads SDK types.
 */
export type ThreadEvent =
  | { readonly kind: "user"; readonly id: string; readonly text: string }
  /** Assistant text. A later event with the same id replaces the text; `delta` appends to it. */
  | { readonly kind: "text"; readonly id: string; readonly text: string; readonly done: boolean }
  | { readonly kind: "text.delta"; readonly id: string; readonly delta: string }
  | { readonly kind: "thinking"; readonly id: string }
  | { readonly kind: "tool"; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly kind: "tool.result"; readonly id: string; readonly output: string; readonly isError: boolean }
  | { readonly kind: "permission"; readonly id: string; readonly tool: string; readonly input: Record<string, unknown> }
  | { readonly kind: "permission.resolved"; readonly id: string; readonly allowed: boolean }
  | { readonly kind: "result"; readonly id: string; readonly durationMs: number; readonly costUsd?: number; readonly isError: boolean }
  | { readonly kind: "status"; readonly busy: boolean }
  | { readonly kind: "init"; readonly model: string }
  /** How full the context window is, read after each turn. */
  | { readonly kind: "context"; readonly percent: number; readonly tokens: number; readonly maxTokens: number }
  | { readonly kind: "error"; readonly id: string; readonly message: string }

/** The repo and branch the window shows, for the Space card. */
export interface Space {
  readonly name: string
  readonly root: string
  readonly branch: string
  /** Commits ahead of and behind the upstream branch, when there is one. */
  readonly upstream?: { readonly ahead: number; readonly behind: number }
  /** Uncommitted changes against HEAD, untracked files included. */
  readonly changes: { readonly files: number; readonly additions: number; readonly deletions: number }
  /** The branch's pull request, when `gh` finds one. */
  readonly pr?: {
    readonly number: number
    readonly title: string
    readonly url: string
    readonly state: "OPEN" | "CLOSED" | "MERGED"
    readonly draft: boolean
    readonly checks: { readonly passed: number; readonly failed: number; readonly pending: number }
  }
}

/** One file a thread changed, with its unified diff. */
export interface FileChange {
  readonly path: string
  readonly status: "added" | "modified" | "deleted" | "renamed"
  readonly additions: number
  readonly deletions: number
  /** The unified diff of this file. Empty for binary files. */
  readonly patch: string
}

/** One plan usage window, such as the 5-hour session limit. */
export interface UsageWindow {
  readonly id: "five_hour" | "seven_day"
  readonly label: string
  /** Percentage used, 0–100. */
  readonly percent: number
  readonly resetsAt?: string
}

export interface PlanUsage {
  readonly windows: readonly UsageWindow[]
}

/** Claude Code's own default model, as a ModelOption value. */
export const DEFAULT_MODEL = "default"

/** How much Claude thinks before it answers. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max"

/** A model Claude Code offers the account, as its /model menu lists it. */
export interface ModelOption {
  /** What a session is started with, such as "opus". "default" is Claude Code's own default. */
  readonly value: string
  readonly label: string
  readonly description: string
  /** The model that runs, such as "claude-opus-5-5". */
  readonly resolvedModel?: string
  /** The effort levels the model takes. Empty when it takes none. */
  readonly efforts: readonly Effort[]
  /** The effort Claude Code uses when the tab sets none, after the user's own settings. */
  readonly defaultEffort?: Effort
}

/** A past thread in the space, as Claude Code saved it. */
export interface ThreadSummary {
  /** Claude's session id, which resumes the thread. */
  readonly id: string
  readonly title: string
  readonly branch?: string
  /** Milliseconds since the epoch. */
  readonly updatedAt: number
  /** The tab that has the thread open, if one does. */
  readonly tabId?: string
}

/** A terminal in a tab's panel. Its shell runs in the core under this id. */
export interface TerminalInfo {
  readonly id: string
  readonly title: string
}

/** A top tab as the app shows it. The core saves tabs per space and sends them back on connect. */
export interface TabInfo {
  readonly id: string
  readonly title: string
  /** The terminals in this tab's panel, in order. The core closes any shell that no tab lists. */
  readonly terminals: readonly TerminalInfo[]
  /** The panel tab on show, as a terminal's id. Absent means Review. */
  readonly panelActive?: string
  /** The model this tab's thread runs on, as a ModelOption value. */
  readonly model: string
  /** Absent means the model's default effort. */
  readonly effort?: Effort
}

export type ClientMessage =
  | { readonly type: "ping"; readonly id: number }
  | { readonly type: "space.get" }
  | { readonly type: "usage.get" }
  | { readonly type: "models.get" }
  /** The space's recent threads, open in a tab or not. */
  | { readonly type: "threads.get" }
  /** Continues a past thread in a tab that has not started one. */
  | { readonly type: "thread.resume"; readonly sessionId: string; readonly threadId: string }
  /** Starts a terminal, or reattaches to one already running under this id. */
  | { readonly type: "terminal.open"; readonly id: string; readonly cols: number; readonly rows: number }
  | { readonly type: "terminal.input"; readonly id: string; readonly data: string }
  | { readonly type: "terminal.resize"; readonly id: string; readonly cols: number; readonly rows: number }
  /** The files a tab's thread changed since its first message. */
  | { readonly type: "review.get"; readonly sessionId: string }
  /** The app's tabs, in order, sent whenever they change. */
  | { readonly type: "tabs.save"; readonly tabs: readonly TabInfo[]; readonly active?: string }
  /** Opens a file from the thread in the editor. The core refuses paths outside the space. */
  | { readonly type: "file.open"; readonly path: string; readonly line?: number }
  | { readonly type: "session.send"; readonly sessionId: string; readonly text: string }
  | { readonly type: "session.interrupt"; readonly sessionId: string }
  | { readonly type: "session.close"; readonly sessionId: string }
  | { readonly type: "permission.answer"; readonly sessionId: string; readonly id: string; readonly allow: boolean }

export type CoreMessage =
  /** `dir` is the project folder this core serves. */
  | { readonly type: "hello"; readonly protocol: number; readonly core: string; readonly bun: string; readonly dir: string }
  | { readonly type: "pong"; readonly id: number }
  /** The tabs saved for this space. Each restored tab's thread follows as a session.history message. */
  | { readonly type: "tabs"; readonly tabs: readonly TabInfo[]; readonly active?: string }
  | { readonly type: "threads"; readonly threads: readonly ThreadSummary[] }
  /** The models Claude Code offers, read once when the core starts. */
  | { readonly type: "models"; readonly models: readonly ModelOption[] }
  /** `usage` is absent when Claude has no plan limits, such as with an API key. */
  | { readonly type: "usage"; readonly usage?: PlanUsage }
  | { readonly type: "review"; readonly sessionId: string; readonly files: readonly FileChange[] }
  | { readonly type: "terminal.output"; readonly id: string; readonly data: string }
  | { readonly type: "terminal.exit"; readonly id: string; readonly code: number }
  /** `space` is absent when the folder is not a Git repo. */
  | { readonly type: "space"; readonly space?: Space }
  | { readonly type: "session.event"; readonly sessionId: string; readonly event: ThreadEvent }
  /** A restored thread, read back from Claude's transcript in one message, so the app can tell it from live events. */
  | { readonly type: "session.history"; readonly sessionId: string; readonly events: readonly ThreadEvent[] }
  | { readonly type: "error"; readonly message: string }
