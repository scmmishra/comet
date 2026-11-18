import type { PermissionAnswer, PermissionKind, ThreadItem } from "@comet/protocol"
import type { PermissionOptionKind, PermissionRequest, PermissionResponse, ToolKind } from "./protocol"
import type { ToolReader } from "./tools"

/**
 * What Comet shows for an ACP agent's permission requests, and how the user's answers go back. A request
 * offers options of four kinds, and Comet's answers pick one of them. Some agents also ask multiple-choice
 * questions through the same request, which show as a `question` item.
 */

type PermissionItem = Extract<ThreadItem, { type: "permission" }>
type QuestionItem = Extract<ThreadItem, { type: "question" }>

/** The answer to a request the user did not answer, such as one open when the turn stops. */
export const CANCELLED: PermissionResponse = { outcome: { outcome: "cancelled" } }

/** What approving each kind of tool lets the agent do, as T3 Code sorts them. Others are plain permissions. */
const KINDS: Partial<Record<ToolKind, PermissionKind>> = {
  execute: "command",
  edit: "file-change",
  delete: "file-change",
  move: "file-change",
  read: "file-read",
  search: "file-read",
}

/** The option kinds each of Comet's answers takes, in the order it prefers them. */
const ANSWER_OPTIONS: Record<Exclude<PermissionAnswer, "cancel">, readonly PermissionOptionKind[]> = {
  allow: ["allow_once"],
  "allow-session": ["allow_always", "allow_once"],
  decline: ["reject_once"],
}

/** A request to approve a tool call. The user approves the command itself when there is one, else the file or the call's title. */
export function permissionItem(request: PermissionRequest, reader: ToolReader): PermissionItem {
  const call = request.toolCall
  const title = call.title?.trim() || "Run a tool"
  return {
    type: "permission",
    id: `permission:${call.toolCallId}`,
    requestId: call.toolCallId,
    tool: title,
    kind: (call.kind && KINDS[call.kind]) ?? "permission",
    detail: reader.command(call) ?? call.locations?.[0]?.path ?? title,
    allowSession: request.options.some((option) => option.kind === "allow_always"),
  }
}

/** The option an answer picks. An answer the request offers no option for is a cancel. */
export function permissionResponse(request: PermissionRequest, answer: PermissionAnswer): PermissionResponse {
  if (answer === "cancel") return CANCELLED
  for (const kind of ANSWER_OPTIONS[answer]) {
    const option = request.options.find((found) => found.kind === kind)
    if (option) return { outcome: { outcome: "selected", optionId: option.optionId } }
  }
  return CANCELLED
}

/** A request that asks one question, with the request's options as its choices. */
export function questionItem(request: PermissionRequest): QuestionItem {
  const call = request.toolCall
  return {
    type: "question",
    id: `question:${call.toolCallId}`,
    requestId: call.toolCallId,
    questions: [{ header: "Question", question: questionText(request), options: request.options.map((option) => ({ label: choiceLabel(option) })), multiSelect: false }],
  }
}

/** The option whose label the user chose. A dismissal, or an answer no option has, is a cancel. */
export function questionResponse(request: PermissionRequest, answers: Readonly<Record<string, string>> | undefined): PermissionResponse {
  const chosen = answers?.[questionText(request)]
  const option = request.options.find((found) => choiceLabel(found) === chosen)
  return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : CANCELLED
}

const questionText = (request: PermissionRequest) => request.toolCall.title?.trim() || "Choose an option."

const choiceLabel = (option: PermissionRequest["options"][number]) => option.name.trim() || option.optionId
