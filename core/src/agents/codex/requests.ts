import type { PermissionAnswer, PermissionKind, Question, ThreadItem } from "@desk/protocol"
import type { RequestId } from "../json-rpc"
import { answerable, ELICITATION, elicitationItem, elicitationReply, type Elicitation } from "./elicitation"
import { scriptOfWords, shellScript } from "./shell"

/**
 * What Desk shows for Codex's requests, and how the user's answers go back, after T3 Code. An approval
 * becomes a `permission` item, and a question for the user a `question` item.
 */

type PermissionItem = Extract<ThreadItem, { type: "permission" }>
type QuestionItem = Extract<ThreadItem, { type: "question" }>
type Answers = Readonly<Record<string, string>> | undefined

/**
 * A request waiting for the user: the item that shows it, Codex's reply for each answer, and the reply
 * for a request nobody answered, such as when the tab closes. That reply declines.
 */
export type OpenRequest =
  | { readonly item: PermissionItem; readonly reply: (answer: PermissionAnswer) => unknown; readonly dismissed: unknown }
  | { readonly item: QuestionItem; readonly reply: (answers: Answers) => unknown; readonly dismissed: unknown }

/** Whether a request asks for approval, rather than asking questions. */
export const asksApproval = (request: OpenRequest): request is Extract<OpenRequest, { item: PermissionItem }> => request.item.type === "permission"

/** Codex's decision for each answer, in the approvals of its current protocol. */
const DECISIONS: Record<PermissionAnswer, string> = { allow: "accept", "allow-session": "acceptForSession", decline: "decline", cancel: "cancel" }
/** Codex's decision for each answer, in its older approvals. */
const REVIEW_DECISIONS: Record<PermissionAnswer, unknown> = { allow: "approved", "allow-session": "approved_for_session", decline: { denied: { rejection: "The user declined." } }, cancel: "abort" }

const decide = (answer: PermissionAnswer) => ({ decision: DECISIONS[answer] })
const review = (answer: PermissionAnswer) => ({ decision: REVIEW_DECISIONS[answer] })

type Params = Record<string, unknown> & { readonly itemId?: string; readonly reason?: string | null }

/**
 * The request Codex asks with `method`, or undefined for one Desk does not handle. `rpcId` is the id
 * Codex gave the request. `files` gives the paths of a file change Codex has already reported, by its item id.
 */
export function openRequest(method: string, params: Params, rpcId: RequestId, files: (itemId: string) => readonly string[] | undefined): OpenRequest | undefined {
  switch (method) {
    case "item/commandExecution/requestApproval": {
      const command = typeof params.command === "string" ? shellScript(params.command) : ""
      return asking(permission(String(params.approvalId ?? params.itemId), "Bash", "command", command || "Run a command", params.reason), decide)
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
    case ELICITATION: {
      const asked = params as unknown as Elicitation
      if (!answerable(asked)) return undefined
      // An MCP server's question has no item of its own, so the request's own id names it.
      return asking(elicitationItem(asked, `elicitation:${rpcId}`), (answer) => elicitationReply(asked, answer))
    }
    default:
      return undefined
  }
}

const asking = (item: PermissionItem, reply: (answer: PermissionAnswer) => unknown): OpenRequest => ({ item, reply, dismissed: reply("decline") })

function permission(requestId: string, tool: string, kind: PermissionKind, detail: string, reason: string | null | undefined): PermissionItem {
  const why = reason?.trim()
  return { type: "permission", id: `permission:${requestId}`, requestId, tool, kind, detail, ...(why && why !== detail ? { reason: why } : {}), allowSession: true }
}

/** Extra access Codex asks for beyond its sandbox: the network, and folders to read or write. */
interface Permissions {
  readonly network: { readonly enabled: boolean | null } | null
  readonly fileSystem: { readonly read: readonly string[] | null; readonly write: readonly string[] | null } | null
}

/** Allowing grants what Codex asked for, for the turn or the session. A refusal grants nothing. */
function permissionsRequest(params: Params & { permissions: Permissions }): OpenRequest {
  const { network, fileSystem } = params.permissions
  const asked = [
    network?.enabled ? "network access" : undefined,
    fileSystem?.write?.length ? `writing to ${fileSystem.write.join(", ")}` : undefined,
    fileSystem?.read?.length ? `reading ${fileSystem.read.join(", ")}` : undefined,
  ].filter(Boolean)
  const detail = asked.length ? `Allow ${asked.join(" and ")}` : "Allow more access"
  return asking(permission(String(params.itemId), "Permissions", "permission", detail, params.reason), (answer) => {
    const allowed = answer === "allow" || answer === "allow-session"
    return { permissions: allowed ? granted(params.permissions) : {}, scope: answer === "allow-session" ? "session" : "turn" }
  })
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
 * Codex's questions. Desk answers by question text, and Codex by question id, so the reply maps one to
 * the other. A dismissal answers every question with nothing.
 */
function questionRequest(requestId: string, asked: readonly CodexQuestion[]): OpenRequest {
  const questions: Question[] = asked.map((entry) => ({
    header: entry.header,
    question: entry.question,
    options: (entry.options ?? []).map(({ label, description }) => ({ label, ...(description && description !== label ? { description } : {}) })),
    multiSelect: false,
  }))
  const reply = (answers: Answers) => ({ answers: Object.fromEntries(asked.map((entry) => [entry.id, { answers: answers?.[entry.question] !== undefined ? [answers[entry.question]] : [] }])) })
  return { item: { type: "question", id: `question:${requestId}`, requestId, questions }, reply, dismissed: reply(undefined) }
}
