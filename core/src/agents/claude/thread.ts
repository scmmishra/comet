import type { SDKAPIRetryMessage, SDKAssistantMessage, SDKMessage, SDKMessageOrigin, SDKPartialAssistantMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk"
import { IMAGE_TYPES, type ImageAttachment, type TextEdit, type ThreadEvent, type ThreadItem } from "@desk/protocol"
import { cutOutput, relativeTo, thought } from "../steps"
import { deskToolSummary } from "../../delegate/tools"
import { resultId } from "../turn-items"
import { modelLabel } from "./models"
import { deskTool, toolStep } from "./steps"

/** What Claude Code writes into a transcript when the user stops a turn, with or without "for tool use". */
const INTERRUPTED = /^\[Request interrupted by user/
/**
 * How Claude Code opens the summary it writes when it compacts a thread. A stored transcript keeps the
 * summary as a user message, and the SDK drops the flag that marks it, so its opening tells it apart.
 */
const COMPACT_SUMMARY = /^This session is being continued from a previous conversation/

/**
 * The note Claude Code puts before a subagent's result, naming the tools it used. It is for the model that
 * started the subagent, so the result shows without it, after T3 Code.
 */
const TOOLS_USED_NOTE = /^\s*<tools-used-before-summary>[^<]*<\/tools-used-before-summary>\s*/

/** Inputs that say in short what a tool call does, in the order a summary prefers them. */
const SUMMARY_FIELDS = ["command", "file_path", "pattern", "path", "url", "query", "description", "skill"]

/** Why an API request failed, in a few words, for the retry notice. */
const RETRY_REASONS: Partial<Record<SDKAPIRetryMessage["error"], string>> = {
  rate_limit: "Rate limited",
  overloaded: "The API is overloaded",
  server_error: "The API had an error",
  authentication_failed: "Authentication failed",
  billing_error: "A billing problem",
}

type ToolItem = Extract<ThreadItem, { type: "tool" }>

/**
 * Turns Agent SDK messages into thread events for one project's thread. It keeps the text block being
 * streamed, so the full message that follows finishes it instead of adding a copy, and each tool call,
 * so its result can complete it.
 */
export class ThreadMapper {
  private streaming?: string
  private tools = new Map<string, ToolItem>()
  /** The id of the compaction running now, which its result and its boundary update. */
  private compacting?: string

  constructor(private readonly dir: string) {}

  /** `at` stamps finished text: now for a live message, its own time for a stored one. */
  map(message: SDKMessage, at?: number): ThreadEvent[] {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") return [{ kind: "init", model: modelLabel(message.model) }]
        // A command such as /context answers with text of its own, not a reply from Claude.
        if (message.subtype === "local_command_output") return [item({ type: "text", id: message.uuid, text: message.content, done: true, ...(at !== undefined ? { at } : {}) })]
        if (message.subtype === "status") return this.mapCompactionStatus(message)
        if (message.subtype === "compact_boundary") {
          const id = this.compacting ?? `compaction:${message.uuid}`
          this.compacting = undefined
          const { pre_tokens: preTokens, post_tokens: postTokens } = message.compact_metadata
          return [item({ type: "compaction", id, status: "done", preTokens, ...(postTokens ? { postTokens } : {}) })]
        }
        if (message.subtype === "api_retry") {
          return [{ kind: "retry", attempt: message.attempt, maxRetries: message.max_retries, delayMs: message.retry_delay_ms, error: retryReason(message.error, message.error_status) }]
        }
        return []
      case "stream_event":
        return this.mapStreamEvent(message.event, message.uuid, message.parent_tool_use_id)
      case "assistant":
        // A subagent's own steps stay inside its tool call.
        if (message.parent_tool_use_id) return []
        return this.mapAssistant(message.message.content, message.uuid, at).map(item)
      case "user": {
        if (message.parent_tool_use_id) return []
        // The tab works again until a turn Claude Code started itself ends.
        const opener = selfStartedText(message.message.content, message.origin)
        if (opener !== undefined) return [item({ type: "user", id: message.uuid ?? `opener-${at ?? Date.now()}`, text: opener, selfStarted: true, ...(at !== undefined ? { at } : {}) }), { kind: "status", busy: true }]
        return this.mapToolResults(message.message.content).map(item)
      }
      case "result":
        return [item({ type: "result", id: message.uuid, durationMs: message.duration_ms, isError: message.is_error })]
      default:
        return []
    }
  }

  /**
   * Claude Code says it is compacting, then how it went, after T3 Code. A compaction that worked ends at
   * its boundary, which carries the token counts. One that failed ends here.
   */
  private mapCompactionStatus(message: Extract<SDKMessage, { type: "system"; subtype: "status" }>): ThreadEvent[] {
    if (message.status === "compacting" && !this.compacting) {
      this.compacting = `compaction:${message.uuid}`
      return [item({ type: "compaction", id: this.compacting, status: "running" })]
    }
    if (message.compact_result === "failed" && this.compacting) {
      const id = this.compacting
      this.compacting = undefined
      return [item({ type: "compaction", id, status: "failed", ...(message.compact_error ? { error: message.compact_error } : {}) })]
    }
    return []
  }

  private mapStreamEvent(event: SDKPartialAssistantMessage["event"], uuid: string, parent: string | null): ThreadEvent[] {
    if (parent) return []
    if (event.type === "content_block_start" && event.content_block.type === "text") {
      this.streaming = uuid
      return [item({ type: "text", id: uuid, text: "", done: false })]
    }
    if (event.type === "content_block_delta" && event.delta.type === "text_delta" && this.streaming) {
      return [{ kind: "text.delta", id: this.streaming, delta: event.delta.text }]
    }
    return []
  }

  private mapAssistant(content: SDKAssistantMessage["message"]["content"], uuid: string, at: number | undefined): ThreadItem[] {
    return content.flatMap((block, index): ThreadItem[] => {
      if (block.type === "text") {
        const id = this.streaming ?? `${uuid}:${index}`
        this.streaming = undefined
        return [{ type: "text", id, text: block.text, done: true, ...(at !== undefined ? { at } : {}) }]
      }
      if (block.type === "thinking") {
        return [thought(`${uuid}:${index}`, block.thinking)]
      }
      if (block.type === "tool_use") {
        const tool = toolItem(this.dir, block.id, block.name, block.input as Record<string, unknown>)
        this.tools.set(tool.id, tool)
        return [tool]
      }
      return []
    })
  }

  /** Each result completes the tool call it answers. */
  private mapToolResults(content: unknown): ThreadItem[] {
    if (!Array.isArray(content)) return []
    return content.flatMap((block): ThreadItem[] => {
      const tool = block.type === "tool_result" ? this.tools.get(String(block.tool_use_id)) : undefined
      return tool ? [toolStep({ ...tool, result: { output: cutOutput(toolOutputText(block.content)), isError: Boolean(block.is_error) } })] : []
    })
  }

  /**
   * Rebuilds a thread from a stored transcript, so a restored tab shows its conversation. Each turn
   * ends with a result, timed from the user's message to the last reply, so restored turns fold the
   * way live ones do.
   */
  history(messages: readonly (SessionMessage & { readonly timestamp?: string; readonly origin?: SDKMessageOrigin })[]): ThreadItem[] {
    // A tool's result replaces its call in place, so the items keep their order.
    const items = new Map<string, ThreadItem>()
    const add = (found: ThreadItem) => items.set(found.id, found)
    let turn: { id: string; start: number; end?: number; stopped?: boolean } | undefined
    const closeTurn = () => {
      if (turn?.end !== undefined) add({ type: "result", id: resultId(turn.id), durationMs: turn.end - turn.start, isError: false, ...(turn.stopped ? { stopped: true } : {}) })
      turn = undefined
    }
    // A stored compaction is a bare system message, followed by Claude Code's summary as a user message.
    let boundary: string | undefined
    for (const stored of messages) {
      if (stored.parent_tool_use_id) continue
      const at = stored.timestamp ? Date.parse(stored.timestamp) : undefined
      if (stored.type === "system") {
        boundary = stored.uuid
        continue
      }
      if (stored.type === "assistant") {
        if (turn && at !== undefined) turn.end = at
        this.mapAssistant((stored.message as SDKAssistantMessage["message"]).content, stored.uuid, at).forEach(add)
      } else if (stored.type === "user") {
        const content = (stored.message as { content?: unknown }).content
        const opener = selfStartedText(content, stored.origin)
        if (opener !== undefined) {
          closeTurn()
          if (at !== undefined) turn = { id: stored.uuid, start: at }
          add({ type: "user", id: stored.uuid, text: opener, selfStarted: true, ...(at !== undefined ? { at } : {}) })
          continue
        }
        const text = userText(content)
        if (text === undefined) {
          this.mapToolResults(content).forEach(add)
          continue
        }
        // The summary is Claude's context, not the user's words. The compaction shows in its place.
        if (COMPACT_SUMMARY.test(text)) {
          add({ type: "compaction", id: `compaction:${boundary ?? stored.uuid}`, status: "done" })
          boundary = undefined
          continue
        }
        // Claude Code records a stopped turn as a message of its own. The turn shows as stopped instead.
        if (INTERRUPTED.test(text)) {
          if (turn) turn.stopped = true
          continue
        }
        closeTurn()
        if (at !== undefined) turn = { id: stored.uuid, start: at }
        const images = userImages(content)
        add({ type: "user", id: stored.uuid, text, ...(images.length ? { images } : {}), ...(at !== undefined ? { at } : {}) })
      }
    }
    closeTurn()
    return [...items.values()]
  }
}

const item = (found: ThreadItem): ThreadEvent => ({ kind: "item", item: found })

/** A tool call as the thread draws it. A call that edits a file carries the file and its edits. */
export function toolItem(dir: string, id: string, name: string, input: Record<string, unknown>): ToolItem {
  const edits = toolEdits(name, input)
  const field = SUMMARY_FIELDS.find((found) => typeof input[found] === "string")
  const desk = deskTool(name)
  const summary = (desk && deskToolSummary(desk, input)) ?? (field ? relativeTo(dir, String(input[field])) : JSON.stringify(input))
  return toolStep({
    type: "tool",
    id,
    name,
    summary,
    ...(edits ? { file: relativeTo(dir, String(input.file_path ?? "")), edits } : {}),
  })
}

/** The edits of an Edit, MultiEdit or Write call, as Claude Code names their inputs. Other tools make none. */
function toolEdits(name: string, input: Record<string, unknown>): TextEdit[] | undefined {
  if (name === "Edit") return [{ before: String(input.old_string ?? ""), after: String(input.new_string ?? "") }]
  if (name === "Write") return [{ before: "", after: String(input.content ?? "") }]
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.map((edit: Record<string, unknown>) => ({ before: String(edit.old_string ?? ""), after: String(edit.new_string ?? "") }))
  }
  return undefined
}

function toolOutputText(content: unknown): string {
  if (typeof content === "string") return content.replace(TOOLS_USED_NOTE, "")
  if (Array.isArray(content)) return content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n").replace(TOOLS_USED_NOTE, "")
  return ""
}

/** The images the user sent, as base64. Claude Code stores pasted images in the transcript this way. */
function userImages(content: unknown): ImageAttachment[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block) =>
    block.type === "image" && block.source?.type === "base64" && IMAGE_TYPES.includes(block.source.media_type) ? [{ mediaType: block.source.media_type, data: block.source.data }] : [],
  )
}

/**
 * The opening line of a turn Claude Code starts itself, or undefined for any other message. Claude Code
 * starts one when a background task finishes, and when a subagent or another session sends it a message,
 * after T3 Code. A sent message holds the sender's whole report, so the opener names the sender instead.
 */
function selfStartedText(content: unknown, origin: SDKMessageOrigin | undefined): string | undefined {
  if (origin?.kind === "peer") return origin.senderTaskId ? "A subagent reported back." : "Another Claude session sent a message."
  return taskSummary(content)
}

/** The summary of a background task that finished, from the notice Claude Code adds to the conversation. */
function taskSummary(content: unknown): string | undefined {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n") : ""
  if (!text.trimStart().startsWith("<task-notification>")) return undefined
  return /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]?.trim() || "A background task finished."
}

function retryReason(error: SDKAPIRetryMessage["error"], status: number | null): string {
  return RETRY_REASONS[error] ?? (status ? `The API answered ${status}` : "The request failed")
}

/**
 * The text the user typed, without any images, or undefined for a tool result. Claude Code also
 * stores messages it writes itself, such as command output and reminders. They start with a tag and stay hidden.
 */
function userText(content: unknown): string | undefined {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content) && !content.some((block) => block.type === "tool_result")
        ? content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n")
        : undefined
  if (text === undefined) return undefined
  return text.trimStart().startsWith("<") ? undefined : text
}
