import type { PermissionAnswer, ThreadItem } from "@desk/protocol"
import { SERVER_NAME } from "../../delegate/tools"

/** The request Codex sends when an MCP server asks the user something. In practice it asks to approve a tool call. */
export const ELICITATION = "mcpServer/elicitation/request"

/** How long a request's message runs in its row. */
const MAX_DETAIL = 400

type PermissionItem = Extract<ThreadItem, { type: "permission" }>

/** An MCP server's question, as Codex passes it on. `url` mode sends the user to a page, which Desk does not do. */
export interface Elicitation {
  readonly serverName: string
  readonly mode: string
  readonly message?: string
  readonly requestedSchema?: { readonly properties?: Readonly<Record<string, { readonly default?: unknown }>> }
}

/** Whether Desk can answer the question: a form it can fill, not a page to open. */
export const answerable = (asked: Elicitation) => asked.mode !== "url"

/**
 * Whether the question comes from Desk's own tools. Desk approves those itself: the user chose the
 * thread's permission mode, and work handed to another agent runs no broader than it.
 */
export const fromDesk = (asked: Elicitation) => asked.serverName === SERVER_NAME

/** The row that asks the user to approve an MCP server's tool call. */
export function elicitationItem(asked: Elicitation, requestId: string): PermissionItem {
  const message = asked.message?.trim() || `Allow ${asked.serverName} to run a tool`
  return { type: "permission", id: `permission:${requestId}`, requestId, tool: asked.serverName, kind: "permission", detail: message.slice(0, MAX_DETAIL), allowSession: true }
}

/**
 * Codex's reply for an answer. Accepting fills each field of the form with its default, which is how a
 * plain approval answers, and allowing for the session asks Codex to keep the approval.
 */
export function elicitationReply(asked: Elicitation, answer: PermissionAnswer) {
  if (answer === "decline" || answer === "cancel") return { action: answer, content: null, _meta: null }
  const defaults = Object.entries(asked.requestedSchema?.properties ?? {}).flatMap(([field, { default: value }]) => (value === undefined || value === null ? [] : [[field, value] as const]))
  return { action: "accept", content: Object.fromEntries(defaults), _meta: answer === "allow-session" ? { persist: "session" } : null }
}
