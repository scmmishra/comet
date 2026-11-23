import type { ThreadItem } from "@comet/protocol"
import { SERVER_NAME } from "../../tools/mcp"
import { cometToolLabel, cometToolSummary } from "../../tools/rows"
import { visualItem } from "../../visuals/show"
import { firstLine, textStart } from "../../text"
import { commandLabel, cutOutput, relativeTo, thought, tool } from "../steps"
import { fileEdits } from "./diff"
import type { CodexItem, CodexTurn, FileUpdate } from "./protocol"
import { shellScript } from "./shell"

/** A tool call's arguments beyond this many characters are cut in its summary. */
const MAX_SUMMARY = 200
/** The collab tool that starts one of Codex's own agents. Its other tools, such as waiting for one, are not shown. */
const SPAWN_AGENT = "spawnAgent"

type ToolItem = Extract<ThreadItem, { type: "tool" }>

/**
 * A Codex item as thread items. `done` says the item has completed, and `at` stamps finished text. A
 * file change becomes one item per file. A user message makes none, since the session or the history
 * adds the user's messages itself. Items Comet does not show, such as plans, make none.
 */
export function threadItems(dir: string, item: CodexItem, done: boolean, at?: number): ThreadItem[] {
  switch (item.type) {
    case "agentMessage":
      return [{ type: "text", id: item.id, text: item.text, done, ...(done && at !== undefined ? { at } : {}) }]
    case "reasoning":
      return [thought(item.id, (item.summary.length ? item.summary : item.content).join("\n\n"))]
    case "commandExecution": {
      const summary = shellScript(item.command)
      const failed = item.status === "failed" || item.status === "declined" || (item.exitCode !== null && item.exitCode !== 0)
      const result = done ? { output: cutOutput(item.aggregatedOutput ?? ""), isError: failed } : undefined
      return [tool({ type: "tool", id: item.id, name: "Bash", summary, ...(result ? { result } : {}) }, "command", commandLabel(summary, result))]
    }
    case "fileChange":
      return item.changes.map((change, index) => fileItem(dir, `${item.id}:${index}`, change, done ? item.status !== "completed" : undefined))
    case "mcpToolCall": {
      // A visual draws in place of its call, and its result adds nothing to it.
      const visual = item.server === SERVER_NAME ? visualItem(item.id, item.tool, item.arguments) : undefined
      if (visual) return [visual]
      const result = done ? (item.error ? { output: item.error.message, isError: true } : { output: cutOutput(contentText(item.result?.content ?? [])), isError: item.status === "failed" }) : undefined
      const name = `${item.server}.${item.tool}`
      // A tool of Comet's own reads the same in every agent's thread.
      const comet = item.server === SERVER_NAME ? cometToolSummary(item.tool, item.arguments) : undefined
      const summary = comet ?? argumentsSummary(item.arguments)
      return [tool({ type: "tool", id: item.id, name, summary, ...(result ? { result } : {}) }, "other", comet === undefined ? `${name} ${summary}` : cometToolLabel(item.tool, summary, done))]
    }
    case "webSearch":
      return [tool({ type: "tool", id: item.id, name: "WebSearch", summary: item.query, ...finished(done, false) }, "web", `Searched the web for ${item.query}`)]
    case "contextCompaction":
      return [{ type: "compaction", id: item.id, status: done ? "done" : "running" }]
    case "collabAgentToolCall":
      if (item.tool !== SPAWN_AGENT) return []
      return [tool({ type: "tool", id: item.id, name: "Agent", summary: firstLine(item.prompt ?? ""), ...finished(done, item.status === "failed") }, "other", `Started an agent: ${firstLine(item.prompt ?? "")}`)]
    case "subAgentActivity":
      if (item.kind !== "started") return []
      return [tool({ type: "tool", id: item.id, name: "Agent", summary: agentName(item.agentPath), ...finished(done, false) }, "other", `Started an agent: ${agentName(item.agentPath)}`)]
    case "imageGeneration": {
      const prompt = firstLine(item.revisedPrompt ?? "")
      const failed = item.failure !== null || item.status === "failed"
      // The output holds where the image went, since a step shows no image.
      const result = done ? { output: failed ? imageFailure(item.failure) : (item.savedPath ?? ""), isError: failed } : undefined
      return [tool({ type: "tool", id: item.id, name: "ImageGeneration", summary: prompt, ...(result ? { result } : {}) }, "other", prompt ? `Generated an image: ${prompt}` : "Generated an image")]
    }
    default:
      return []
  }
}

/** Whether Codex may start the item and never complete it, so the thread shows it running after its turn ended. */
export const mayStayOpen = (item: CodexItem) => item.type === "webSearch" || item.type === "contextCompaction"

/**
 * An item the turn left open, as it shows once the turn ended. A search that did not finish has no result
 * to show, so its step says so. It is an error when the turn failed or the user stopped it, after T3 Code.
 */
export function unfinishedItems(dir: string, item: CodexItem, turn: CodexTurn["status"]): ThreadItem[] {
  if (item.type === "contextCompaction") return [{ type: "compaction", id: item.id, status: turn === "failed" ? "failed" : "stopped" }]
  return threadItems(dir, item, true).map((found) =>
    found.type === "tool"
      ? tool({ ...found, result: { output: "The search did not finish.", isError: turn !== "completed", ...(turn === "interrupted" ? { stopped: true } : {}) } }, "web", `Did not finish searching the web for ${found.summary}`)
      : found,
  )
}

/** One file of a patch, with its path relative to the project. */
function fileItem(dir: string, id: string, change: FileUpdate, isError: boolean | undefined): ToolItem {
  const file = relativeTo(dir, change.path)
  const verb = change.kind.type === "add" ? "Wrote" : change.kind.type === "delete" ? "Deleted" : "Edited"
  const result = isError === undefined ? {} : { result: { output: "", isError } }
  return tool({ type: "tool", id, name: "Edit", summary: file, file, edits: fileEdits(change), ...result }, "edit", `${verb} ${file}`)
}

/** The paths a patch changes, relative to the project, for the request that asks to apply it. */
export const changedPaths = (dir: string, changes: readonly { readonly path: string }[]) => changes.map((change) => relativeTo(dir, change.path))

/** A result with no output, for a call whose output Comet does not show. A call still running has none. */
const finished = (done: boolean, isError: boolean) => (done ? { result: { output: "", isError } } : {})

/** Why Codex made no image. Codex names one reason, a used-up limit. */
const imageFailure = (failure: { readonly type: string } | null) => (failure?.type === "usageLimitExceeded" ? "The image generation limit is used up." : "Codex could not generate the image.")

/** The last part of a subagent's path, such as "say_hello" from "/root/say_hello". */
const agentName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path

function argumentsSummary(args: unknown): string {
  const text = args === null || args === undefined ? "" : JSON.stringify(args)
  return text.length > MAX_SUMMARY ? `${textStart(text, MAX_SUMMARY - 1)}…` : text
}

/** An MCP result's text. Content that is not text shows as its type. */
function contentText(content: readonly unknown[]): string {
  return content.map((part) => (isText(part) ? part.text : `[${(part as { type?: string })?.type ?? "content"}]`)).join("\n")
}

const isText = (part: unknown): part is { type: "text"; text: string } => (part as { type?: unknown })?.type === "text" && typeof (part as { text?: unknown }).text === "string"
