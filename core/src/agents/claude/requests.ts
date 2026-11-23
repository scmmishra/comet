import type { PermissionAnswer, PermissionKind, Question, ThreadItem } from "@comet/protocol"
import type { CanUseTool, PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk"
import { stripVTControlCharacters } from "node:util"
import { textStart } from "../../text"

/**
 * What Comet shows for Claude Code's permission requests, and how the user's answers go back, after
 * T3 Code. A tool call that needs approval becomes a `permission` item. An AskUserQuestion call
 * becomes a `question` item, and its answers go back as the tool's input.
 */

type PermissionItem = Extract<ThreadItem, { type: "permission" }>
type QuestionItem = Extract<ThreadItem, { type: "question" }>
type RequestOptions = Parameters<CanUseTool>[2]

/** The tool that asks the user questions, whose request is answered with answers instead of an approval. */
export const ASK_USER_QUESTION = "AskUserQuestion"

/** Claude Code's tools by what approving them lets Claude do, as T3 Code sorts them. Others are plain permissions. */
const KINDS: Record<string, PermissionKind> = {
  agent: "command",
  bash: "command",
  monitor: "command",
  sendmessage: "command",
  task: "command",
  taskstop: "command",
  todowrite: "command",
  toolsearch: "command",
  webfetch: "command",
  websearch: "command",
  edit: "file-change",
  multiedit: "file-change",
  notebookedit: "file-change",
  write: "file-change",
  glob: "file-read",
  grep: "file-read",
  ls: "file-read",
  read: "file-read",
}

/** The longest a request's summary of its input runs, as in T3 Code. */
const SUMMARY_LENGTH = 400

export function permissionItem(tool: string, input: Record<string, unknown>, options: RequestOptions): PermissionItem {
  const command = typeof input.command === "string" && input.command.trim() ? input.command : undefined
  // The user approves the command itself. Claude Code's sentences only describe it.
  const detail = command ?? options.title ?? options.description ?? options.decisionReason ?? summary(tool, input)
  // Claude Code's reason may carry the terminal escapes of its own prompt.
  const reason = stripVTControlCharacters(options.decisionReason ?? "").trim()
  return {
    type: "permission",
    id: `permission:${options.toolUseID}`,
    requestId: options.toolUseID,
    tool,
    kind: KINDS[tool.toLowerCase()] ?? "permission",
    detail,
    ...(reason && reason !== detail ? { reason } : {}),
    allowSession: !options.suppressAlwaysAllowRule,
  }
}

/** A request with no command or Claude Code sentence: the tool and its path, else its input as JSON. */
function summary(tool: string, input: Record<string, unknown>): string {
  const path = ["file_path", "path", "filename"].map((key) => input[key]).find((value) => typeof value === "string")
  const text = typeof path === "string" ? path : JSON.stringify(input)
  return `${tool}: ${text.length > SUMMARY_LENGTH ? `${textStart(text, SUMMARY_LENGTH - 3)}...` : text}`
}

/**
 * What Claude Code gets for an answer. Allowing for the session takes Claude Code's own suggestions as
 * session rules, else allows the tool for the session. Cancelling also stops the turn.
 */
export function permissionResult(answer: PermissionAnswer, tool: string, input: Record<string, unknown>, suggestions: readonly PermissionUpdate[] | undefined): PermissionResult {
  if (answer === "allow") return { behavior: "allow", updatedInput: input }
  if (answer === "allow-session") return { behavior: "allow", updatedInput: input, updatedPermissions: sessionRules(tool, suggestions) }
  if (answer === "cancel") return { behavior: "deny", message: "The user cancelled this tool call.", interrupt: true }
  return { behavior: "deny", message: "The user declined this tool call." }
}

function sessionRules(tool: string, suggestions: readonly PermissionUpdate[] | undefined): PermissionUpdate[] {
  const rules = (suggestions ?? []).map((suggestion) => ({ ...suggestion, destination: "session" as const }))
  return rules.length ? rules : [{ type: "addRules", rules: [{ toolName: tool }], behavior: "allow", destination: "session" }]
}

/** An AskUserQuestion call's questions. Ones with no text are left out, and a question with no header is numbered. */
export function questionItem(input: Record<string, unknown>, requestId: string): QuestionItem {
  const raw = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : []
  const questions = raw.flatMap((entry, index): Question[] => {
    const question = typeof entry?.question === "string" ? entry.question.trim() : ""
    if (!question) return []
    const header = typeof entry.header === "string" && entry.header.trim() ? entry.header.trim() : `Question ${index + 1}`
    const options = (Array.isArray(entry.options) ? (entry.options as Record<string, unknown>[]) : []).flatMap((option) => {
      const label = typeof option?.label === "string" ? option.label.trim() : ""
      const description = typeof option?.description === "string" ? option.description.trim() : ""
      return label ? [{ label, ...(description && description !== label ? { description } : {}) }] : []
    })
    return [{ header, question, options, multiSelect: entry.multiSelect === true }]
  })
  return { type: "question", id: `question:${requestId}`, requestId, questions }
}

/**
 * What Claude Code gets for answered questions: the call goes ahead with the answers added to its input,
 * which is how AskUserQuestion takes them. A dismissal declines the call.
 */
export function questionResult(input: Record<string, unknown>, answers: Readonly<Record<string, string>> | undefined): PermissionResult {
  if (!answers) return { behavior: "deny", message: "The user dismissed the questions without answering." }
  return { behavior: "allow", updatedInput: { ...input, answers } }
}
