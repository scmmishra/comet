// The parts of Codex's app-server protocol that Comet reads, written by hand from the schema that
// `codex app-server generate-ts` prints. Each type lists only the fields Comet reads.

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

/** What the user sent: text, or an image as a URL, which Comet makes a data URL. */
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
  | {
      readonly type: "imageGeneration"
      readonly id: string
      /** Such as "completed" or "failed". The schema does not list the values. */
      readonly status: string
      /** The prompt the image was made from, as the model rewrote it. */
      readonly revisedPrompt: string | null
      readonly failure: { readonly type: string } | null
      /** Where Codex saved the image, once it has. */
      readonly savedPath?: string
    }
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

/** A skill as `skills/list` gives it. A plugin's skill names its plugin, such as "pdf@openai-primary-runtime". */
export interface CodexSkill {
  readonly name: string
  readonly description: string
  readonly scope: "user" | "repo" | "system" | "admin"
  readonly enabled: boolean
  readonly pluginId: string | null
  /** Its SKILL.md. */
  readonly path: string
}

/** An MCP server as Codex's config describes it. */
export interface CodexMcpConfig {
  readonly command?: string
  readonly args?: readonly string[]
  readonly url?: string
  readonly enabled?: boolean
}

/** One file of Codex's config, as `config/read` with `includeLayers` gives it, the strongest first. */
export interface CodexConfigLayer {
  /** Such as "user", "project" or "system". */
  readonly name: { readonly type: string }
  readonly config: { readonly mcp_servers?: Readonly<Record<string, CodexMcpConfig>> } | null
  /** Why Codex skips the layer, such as a project the user has not trusted. */
  readonly disabledReason: string | null
}

/** How much of its reasoning the model sums up. */
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none"

export interface CodexConfigRead {
  readonly config: { readonly mcp_servers?: Readonly<Record<string, CodexMcpConfig>>; readonly model_reasoning_summary?: ReasoningSummary | null }
  readonly layers: readonly CodexConfigLayer[] | null
}

/** A server as `mcpServerStatus/list` gives it. */
export interface CodexMcpStatus {
  readonly name: string
  readonly tools: Readonly<Record<string, unknown>>
  /** Why Codex could not list its tools, such as a server that failed to start. */
  readonly toolsError: string | null
  readonly authStatus: "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth"
}

/** How one of a thread's MCP servers is starting, as `mcpServer/startupStatus/updated` says. */
export interface McpStartup {
  readonly name: string
  readonly status: "starting" | "ready" | "failed" | "cancelled"
  readonly error: string | null
}
