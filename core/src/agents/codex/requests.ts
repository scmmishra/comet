import type { PermissionAnswer, PermissionKind, Question, ThreadItem } from "@comet/protocol"
import { SERVER_NAME } from "../../tools/mcp"
import { textStart } from "../../text"
import type { RequestId } from "../json-rpc"
import { scriptOfWords, shellScript } from "./shell"

// What Comet shows for Codex's requests, and how the user's answers go back, after T3 Code. An approval
// becomes a `permission` item, and a question for the user a `question` item.

/** Codex's decision for each answer, in the approvals of its current protocol. */
const DECISIONS: Record<PermissionAnswer, string> = { allow: "accept", "allow-session": "acceptForSession", decline: "decline", cancel: "cancel" }
/** Codex's decision for each answer, in its older approvals. */
const REVIEW_DECISIONS: Record<PermissionAnswer, unknown> = { allow: "approved", "allow-session": "approved_for_session", decline: { denied: { rejection: "The user declined." } }, cancel: "abort" }
/** The request Codex sends when an MCP server asks the user something. In practice it asks to approve a tool call. */
const ELICITATION = "mcpServer/elicitation/request"
/** How long an MCP server's message runs in its row. */
const MAX_DETAIL = 400

type PermissionItem = Extract<ThreadItem, { type: "permission" }>
type QuestionItem = Extract<ThreadItem, { type: "question" }>
type Answers = Readonly<Record<string, string>> | undefined

/**
 * A request waiting for the user: the item that shows it, Codex's reply for each answer, and the reply
 * for a request nobody answered, such as when the tab closes. That reply declines.
 */
export type CodexRequest =
  | { readonly item: PermissionItem; readonly reply: (answer: PermissionAnswer) => unknown; readonly dismissed: unknown }
  | { readonly item: QuestionItem; readonly reply: (answers: Answers) => unknown; readonly dismissed: unknown }

/** A request Comet answers itself, without asking the user. */
interface AnsweredRequest {
  readonly answer: unknown
}

/** Whether a request asks for approval, rather than asking questions. */
export const asksApproval = (request: CodexRequest): request is Extract<CodexRequest, { item: PermissionItem }> => request.item.type === "permission"

const decide = (answer: PermissionAnswer) => ({ decision: DECISIONS[answer] })
const review = (answer: PermissionAnswer) => ({ decision: REVIEW_DECISIONS[answer] })

type Params = Record<string, unknown> & { readonly itemId?: string; readonly reason?: string | null }

/**
 * The request Codex asks with `method`: one for the user, one Comet answers itself, or undefined for one
 * Comet does not handle. `rpcId` is the id Codex gave the request. `files` gives the paths of a file
 * change Codex has already reported, by its item id. `accept` says the user allowed everything, as in
 * full access, so Comet accepts what it can without asking.
 */
export function readRequest(
  method: string,
  params: Params,
  rpcId: RequestId,
  files: (itemId: string) => readonly string[] | undefined,
  accept: boolean,
): CodexRequest | AnsweredRequest | undefined {
  switch (method) {
    case "item/commandExecution/requestApproval": {
      const ask = params as Params & NetworkAsk
      if (accept && !asksNetwork(ask)) return { answer: decide("allow") }
      const command = (typeof params.command === "string" ? shellScript(params.command) : "") || "Run a command"
      const target = ask.networkApprovalContext
      const detail = target ? `${command}\nNetwork access to ${target.host} (${target.protocol})` : command
      return asking(permission(String(params.approvalId ?? params.itemId), "Bash", "command", detail, params.reason), decide)
    }
    case "item/fileChange/requestApproval": {
      const paths = files(String(params.itemId))
      return asking(permission(String(params.itemId), "Edit", "file-change", paths?.join(", ") || params.reason || "Change files", params.reason), decide)
    }
    case "item/permissions/requestApproval":
      return permissionsRequest(params as Params & { permissions: Permissions })
    case "item/tool/requestUserInput":
      return questionRequest(String(params.itemId), params.questions as readonly CodexQuestion[])
    case "execCommandApproval": {
      const command = scriptOfWords(params.command as string[])
      return asking(permission(String(params.approvalId ?? params.callId), "Bash", "command", command, params.reason), review)
    }
    case "applyPatchApproval": {
      const paths = Object.keys((params.fileChanges as object | null) ?? {})
      return asking(permission(String(params.callId), "Edit", "file-change", paths.join(", ") || "Change files", params.reason), review)
    }
    case ELICITATION:
      return elicitationRequest(params as Params & Elicitation, rpcId, accept)
    default:
      return undefined
  }
}

/** What a command approval carries when the command needs network access that Codex's network settings do not allow. */
interface NetworkAsk {
  /** The host the command asks to reach, and how. */
  readonly networkApprovalContext?: { readonly host: string; readonly protocol: string } | null
  readonly proposedNetworkPolicyAmendments?: readonly unknown[] | null
}

/**
 * Whether a command approval asks about network access, after T3 Code. The user's network settings stay in
 * force in full access too, so such a command still asks.
 */
const asksNetwork = (params: NetworkAsk) => params.networkApprovalContext != null || (params.proposedNetworkPolicyAmendments?.length ?? 0) > 0

const asking = (item: PermissionItem, reply: (answer: PermissionAnswer) => unknown): CodexRequest => ({ item, reply, dismissed: reply("decline") })

function permission(requestId: string, tool: string, kind: PermissionKind, detail: string, reason: string | null | undefined): PermissionItem {
  const why = reason?.trim()
  return { type: "permission", id: `permission:${requestId}`, requestId, tool, kind, detail, ...(why && why !== detail ? { reason: why } : {}), allowSession: true }
}

/** Extra access Codex asks for beyond its sandbox: the network, and folders to read or write. */
interface Permissions {
  readonly network: { readonly enabled: boolean | null } | null
  readonly fileSystem: FileSystemAsk | null
}

/**
 * The paths Codex asks for. Codex 0.169 lists them in `entries`, and still sends the older `read` and
 * `write` lists, which it will remove. A path can appear in both.
 */
interface FileSystemAsk {
  readonly read: readonly string[] | null
  readonly write: readonly string[] | null
  readonly entries?: readonly { readonly access: Access; readonly path: FileSystemPath }[]
}

type Access = "read" | "write" | "deny"

type FileSystemPath =
  | { readonly type: "path"; readonly path: string }
  | { readonly type: "glob_pattern"; readonly pattern: string }
  | { readonly type: "special"; readonly value: SpecialPath }

/** The paths Codex names by kind rather than by path. */
type SpecialPath =
  | { readonly kind: "root" | "minimal" | "tmpdir" | "slash_tmp" }
  | { readonly kind: "project_roots"; readonly subpath: string | null }
  | { readonly kind: "unknown"; readonly path: string; readonly subpath: string | null }

/** How the request names each kind of access, in the order it lists them. */
const ACCESS_WORDS: Record<Access, string> = { write: "writing to", read: "reading", deny: "no access to" }

/** Allowing grants what Codex asked for, for the turn or the session. A refusal grants nothing. */
function permissionsRequest(params: Params & { permissions: Permissions }): CodexRequest {
  const { network, fileSystem } = params.permissions
  const paths = fileSystem ? askedPaths(fileSystem) : undefined
  const asked = [
    network?.enabled ? "network access" : undefined,
    ...(Object.keys(ACCESS_WORDS) as Access[]).map((access) => (paths?.[access].size ? `${ACCESS_WORDS[access]} ${[...paths[access]].join(", ")}` : undefined)),
  ].filter(Boolean)
  const detail = asked.length ? `Allow ${asked.join(" and ")}` : "Allow more access"
  return asking(permission(String(params.itemId), "Permissions", "permission", detail, params.reason), (answer) => {
    const allowed = answer === "allow" || answer === "allow-session"
    return { permissions: allowed ? granted(params.permissions) : {}, scope: answer === "allow-session" ? "session" : "turn" }
  })
}

/** Each path Codex asks for, by access, from both its lists. A set drops a path that both list. */
function askedPaths(fileSystem: FileSystemAsk): Record<Access, Set<string>> {
  const paths: Record<Access, Set<string>> = { write: new Set(fileSystem.write ?? []), read: new Set(fileSystem.read ?? []), deny: new Set() }
  for (const entry of fileSystem.entries ?? []) paths[entry.access]?.add(pathLabel(entry.path))
  return paths
}

/** How a path reads in the request, after T3 Code. */
function pathLabel(path: FileSystemPath): string {
  if (path.type === "path") return path.path
  if (path.type === "glob_pattern") return path.pattern
  const special = path.value
  switch (special.kind) {
    case "root":
      return "/ (the whole disk)"
    case "minimal":
      return "the minimal system paths"
    case "tmpdir":
      return "the temporary folder"
    case "slash_tmp":
      return "/tmp"
    case "project_roots":
      return ["the project roots", special.subpath].filter(Boolean).join("/")
    case "unknown":
      return [special.path, special.subpath].filter(Boolean).join("/") || "an unknown path"
  }
}

/** What Codex asked for, in the shape its grant takes, which leaves out what was not asked. */
const granted = ({ network, fileSystem }: Permissions) => ({ ...(network ? { network } : {}), ...(fileSystem ? { fileSystem } : {}) })

interface CodexQuestion {
  readonly id: string
  readonly header: string
  readonly question: string
  readonly options: readonly { readonly label: string; readonly description: string }[] | null
}

/**
 * Codex's questions. Comet answers by question text, and Codex by question id, so the reply maps one to
 * the other. A dismissal answers every question with nothing.
 */
function questionRequest(requestId: string, asked: readonly CodexQuestion[]): CodexRequest {
  const questions: Question[] = asked.map((entry) => ({
    header: entry.header,
    question: entry.question,
    options: (entry.options ?? []).map(({ label, description }) => ({ label, ...(description && description !== label ? { description } : {}) })),
    multiSelect: false,
  }))
  const reply = (answers: Answers) => ({ answers: Object.fromEntries(asked.map((entry) => [entry.id, { answers: answers?.[entry.question] !== undefined ? [answers[entry.question]] : [] }])) })
  return { item: { type: "question", id: `question:${requestId}`, requestId, questions }, reply, dismissed: reply(undefined) }
}

/** An MCP server's question, as Codex passes it on. `url` mode sends the user to a page, which Comet does not do. */
interface Elicitation {
  readonly serverName: string
  readonly mode: string
  readonly message?: string
  readonly requestedSchema?: { readonly properties?: Readonly<Record<string, { readonly default?: unknown }>>; readonly required?: readonly string[] }
}

/**
 * An MCP server's question. Codex asks before it calls an MCP tool. Comet approves a call of its own tools
 * itself: the user chose the thread's permission mode, and work handed to another agent runs no broader
 * than it. With `accept`, it approves every question. A question that sends the user to a page is
 * cancelled, since Comet opens none. An MCP server's question has no item of its own, so the request's own id names it.
 */
function elicitationRequest(asked: Elicitation, rpcId: RequestId, accept: boolean): CodexRequest | AnsweredRequest {
  if (asked.mode === "url") return { answer: elicitationReply(asked, "cancel") }
  if (accept || asked.serverName === SERVER_NAME) return { answer: elicitationReply(asked, "allow") }
  const message = asked.message?.trim() || `Allow ${asked.serverName} to run a tool`
  return asking(permission(`elicitation:${rpcId}`, asked.serverName, "permission", textStart(message, MAX_DETAIL), undefined), (answer) => elicitationReply(asked, answer))
}

/**
 * Codex's reply for an answer. Accepting fills each field of the form with its default, which is how a
 * plain approval answers, and allowing for the session asks Codex to keep the approval. A form with a
 * required field that has no default is cancelled, after T3 Code: Comet cannot fill it, and a decline
 * reads as the user's refusal, which Codex may keep.
 */
function elicitationReply(asked: Elicitation, answer: PermissionAnswer) {
  if (answer === "decline" || answer === "cancel") return { action: answer, content: null, _meta: null }
  const defaults = Object.entries(asked.requestedSchema?.properties ?? {}).flatMap(([field, { default: value }]) => (value === undefined || value === null ? [] : [[field, value] as const]))
  const filled = new Set(defaults.map(([field]) => field))
  if (asked.requestedSchema?.required?.some((field) => !filled.has(field))) return elicitationReply(asked, "cancel")
  return { action: "accept", content: Object.fromEntries(defaults), _meta: answer === "allow-session" ? { persist: "session" } : null }
}
