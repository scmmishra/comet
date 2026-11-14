/**
 * The Agent Client Protocol's messages, as Desk reads and sends them. ACP is JSON-RPC 2.0 over an agent's
 * stdio. These types hold only the fields Desk uses. The schema is at agentclientprotocol.com.
 */

/** The protocol version Desk speaks. An agent answers with the version it chose. */
export const PROTOCOL_VERSION = 1

/** The error an agent answers with when it needs the user to sign in first. */
export const AUTH_REQUIRED = -32000

/** Part of a prompt or of a message. Desk sends text and images, and reads text. */
export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | { readonly type: "resource_link" | "resource" | "audio" }

/** Who the client is, which some agents read to decide what to offer it. */
export interface ClientInfo {
  readonly name: string
  readonly version: string
}

/** An MCP server the agent connects to for a session. Desk offers its tools over HTTP. */
export interface McpServer {
  readonly type: "http"
  readonly name: string
  readonly url: string
  readonly headers: readonly { readonly name: string; readonly value: string }[]
}

/** One choice of a select option, such as one model. */
export interface SelectChoice {
  readonly value: string
  readonly name: string
  readonly description?: string | null
}

/** A setting of a session the agent lets the client change, such as its model or thinking level. */
export interface ConfigOption {
  readonly id: string
  readonly name: string
  readonly category?: string | null
  readonly type: "select" | "boolean"
  readonly currentValue: string | boolean
  /** A select's choices, possibly in named groups. */
  readonly options?: readonly (SelectChoice | { readonly group: string; readonly options: readonly SelectChoice[] })[]
}

/** What `session/new` and `session/resume` answer. A resume answers no id, since the client named it. */
export interface SessionSetup {
  readonly sessionId?: string
  readonly configOptions?: readonly ConfigOption[] | null
  readonly modes?: { readonly currentModeId: string } | null
}

/** Why a prompt's turn ended. */
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"

export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other"
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed"

/** What a tool call shows: a content block, a file's diff, or a terminal the client runs. */
export type ToolContent =
  | { readonly type: "content"; readonly content: ContentBlock }
  | { readonly type: "diff"; readonly path: string; readonly oldText?: string | null; readonly newText: string }
  | { readonly type: "terminal"; readonly terminalId: string }

/** A tool call as the agent reports it. An update carries only the fields that changed, and null leaves a field as it was. */
export interface ToolCall {
  readonly toolCallId: string
  readonly title?: string | null
  readonly kind?: ToolKind | null
  readonly status?: ToolStatus | null
  readonly content?: readonly ToolContent[] | null
  readonly locations?: readonly { readonly path: string }[] | null
  readonly rawInput?: unknown
  readonly rawOutput?: unknown
}

export type SessionUpdate =
  | { readonly sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk"; readonly content: ContentBlock }
  | ({ readonly sessionUpdate: "tool_call" | "tool_call_update" } & ToolCall)
  | { readonly sessionUpdate: "usage_update"; readonly used: number; readonly size: number }
  | { readonly sessionUpdate: "config_option_update"; readonly configOptions: readonly ConfigOption[] }
  | { readonly sessionUpdate: "plan" | "current_mode_update" | "available_commands_update" | "session_info_update" }

export interface SessionNotification {
  readonly sessionId: string
  readonly update: SessionUpdate
}

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always"

export interface PermissionOption {
  readonly optionId: string
  readonly name: string
  readonly kind: PermissionOptionKind
}

/** The agent asks the user before a tool call, with the options it offers. */
export interface PermissionRequest {
  readonly sessionId: string
  readonly toolCall: ToolCall
  readonly options: readonly PermissionOption[]
}

/** The client's answer to a permission request: one of its options, or cancelled when the turn stops. */
export interface PermissionResponse {
  readonly outcome: { readonly outcome: "cancelled" } | { readonly outcome: "selected"; readonly optionId: string }
}
