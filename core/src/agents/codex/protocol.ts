// The parts of Codex's app-server protocol that Desk reads, written by hand from the schema that
// `codex app-server generate-ts` prints. Each type lists only the fields Desk reads.

export interface CodexTurn {
  readonly id: string
  readonly items: readonly CodexItem[]
  readonly status: "completed" | "interrupted" | "failed" | "inProgress"
  readonly error: { readonly message: string } | null
  /** Seconds since the epoch. A turn queued behind another has none yet. */
  readonly startedAt: number | null
  readonly completedAt: number | null
  readonly durationMs: number | null
}

export interface CodexThread {
  readonly id: string
  readonly name: string | null
  /** Usually the thread's first message. */
  readonly preview: string
  /** Seconds since the epoch. */
  readonly updatedAt: number
  readonly gitInfo: { readonly branch: string | null } | null
  /** Filled only by `thread/read` with `includeTurns`, `thread/resume` and `thread/fork`. */
  readonly turns: readonly CodexTurn[]
}

/** What the user sent: text, or an image as a URL, which Desk makes a data URL. */
export type UserInput = { readonly type: "text"; readonly text: string } | { readonly type: "image"; readonly url: string } | { readonly type: "localImage"; readonly path: string }

export type FileChangeKind = { readonly type: "add" } | { readonly type: "delete" } | { readonly type: "update"; readonly move_path: string | null }

export interface FileUpdate {
  readonly path: string
  readonly kind: FileChangeKind
  /** A unified diff for an update. An added or deleted file's whole text. */
  readonly diff: string
}

/** One item of a turn. The lifecycle times come from history, when Codex recorded them. */
export type CodexItem = { readonly startedAtMs?: number | null; readonly completedAtMs?: number | null } & (
  | { readonly type: "userMessage"; readonly id: string; readonly clientId: string | null; readonly content: readonly UserInput[] }
  | { readonly type: "agentMessage"; readonly id: string; readonly text: string }
  | { readonly type: "reasoning"; readonly id: string; readonly summary: readonly string[]; readonly content: readonly string[] }
  | {
      readonly type: "commandExecution"
      readonly id: string
      readonly command: string
      readonly status: "inProgress" | "completed" | "failed" | "declined"
      readonly aggregatedOutput: string | null
      readonly exitCode: number | null
    }
  | { readonly type: "fileChange"; readonly id: string; readonly changes: readonly FileUpdate[]; readonly status: "inProgress" | "completed" | "failed" | "declined" }
  | {
      readonly type: "mcpToolCall"
      readonly id: string
      readonly server: string
      readonly tool: string
      readonly status: "inProgress" | "completed" | "failed"
      readonly arguments: unknown
      readonly result: { readonly content: readonly unknown[] } | null
      readonly error: { readonly message: string } | null
    }
  | { readonly type: "webSearch"; readonly id: string; readonly query: string }
  | { readonly type: "contextCompaction"; readonly id: string }
  | {
      readonly type: "collabAgentToolCall"
      readonly id: string
      readonly tool: string
      readonly status: "inProgress" | "completed" | "failed"
      readonly receiverThreadIds: readonly string[]
      readonly prompt: string | null
    }
  | { readonly type: "subAgentActivity"; readonly id: string; readonly kind: "started" | "interacted" | "interrupted" | "completed"; readonly agentThreadId: string; readonly agentPath: string }
)

export interface CodexModel {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly hidden: boolean
  readonly isDefault: boolean
  readonly supportedReasoningEfforts: readonly { readonly reasoningEffort: string }[]
  readonly defaultReasoningEffort: string
  readonly serviceTiers: readonly { readonly id: string }[]
}

export type CodexAccount =
  | { readonly type: "chatgpt"; readonly email: string | null; readonly planType: string; readonly workspaceName: string | null }
  | { readonly type: "apiKey" }
  | { readonly type: "amazonBedrock" }
  | { readonly type: "gcp" }

export interface RateLimitWindow {
  readonly usedPercent: number
  readonly windowDurationMins: number | null
  /** Seconds since the epoch. */
  readonly resetsAt: number | null
}

/** A plan's usage limits. An update may leave a window null, which means it is unknown, not gone. */
export interface RateLimitSnapshot {
  readonly limitId: string | null
  readonly primary: RateLimitWindow | null
  readonly secondary: RateLimitWindow | null
}

export interface TokenUsage {
  readonly last: { readonly totalTokens: number }
  readonly modelContextWindow: number | null
}
