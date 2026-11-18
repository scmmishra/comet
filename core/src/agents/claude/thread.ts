import type { SDKAPIRetryMessage, SDKAssistantMessage, SDKMessage, SDKMessageOrigin, SDKPartialAssistantMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk"
import { IMAGE_TYPES, type ImageAttachment, type TextEdit, type ThreadEvent, type ThreadItem } from "@comet/protocol"
import { cutOutput, relativeTo, thought, unfinishedResult } from "../steps"
import { cometToolSummary } from "../../delegate/tools"
import { visualItem } from "../../visuals/show"
import { resultId } from "../turn-items"
import { modelLabel } from "./models"
import { cometTool, toolStep } from "./steps"

/** What Claude Code writes into a transcript when the user stops a turn, with or without "for tool use". */
const INTERRUPTED = /^\[Request interrupted by user/
/**
 * How Claude Code opens the summary it writes when it compacts a thread. A stored transcript keeps the
 * summary as a user message, and the SDK drops the flag that marks it, so its opening tells it apart.
 */
const COMPACT_SUMMARY = /^This session is being continued from a previous conversation/
/** The opener of a turn Claude Code starts itself when no finished background task says why. */
const SELF_STARTED = "Claude Code started a turn on its own."

/**
 * The note Claude Code puts before a subagent's result, naming the tools it used. It is for the model that
 * started the subagent, so the result shows without it, after T3 Code.
 */
const TOOLS_USED_NOTE = /^\s*<tools-used-before-summary>[^<]*<\/tools-used-before-summary>\s*/
/**
 * The frame Claude Code puts around a subagent's report for the model that started it, after T3 Code. A line
 * opens it, each line of the report is indented by two spaces, and a usage block and the subagent's id follow.
 */
const HAND_BACK_FRAME = /^\[Subagent hand-back\] The text below is the final report of a subagent [^\n]* The report follows:\n/
const USAGE_TRAILER = /(?:^|\n)<usage>[^<]*<\/usage>\s*$/
const AGENT_ID_TRAILER = /(?:^|\n)agentId: ([\w-]+) \(use SendMessage with to: '\1'[^\n]*\)\s*$/
const REPORT_INDENT = /^ {2}/gm

/** Inputs that say in short what a tool call does, in the order a summary prefers them. */
const SUMMARY_FIELDS = ["command", "file_path", "pattern", "path", "url", "query", "description", "skill"]

/**
 * Claude Code's plugin errors name paths and URLs of its own and are not bounded. The notice drops control and
 * bidi characters and cuts each message to this many characters.
 */
const PLUGIN_ERROR_LIMIT = 300
const UNSAFE_CHARACTERS = /[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu

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
 * streamed, so the full message that follows finishes it instead of adding a copy, and each tool call
 * until its result completes it.
 */
export class ThreadMapper {
  private streaming?: string
  /** The reply the latest top-level assistant message carried, or the one streaming now, which a steer can cut short. */
  private lastReply?: { readonly id: string; text: string; readonly at?: number }
  /** The tool calls that have no result yet, by id. */
  private tools = new Map<string, ToolItem>()
  /** The ids of the items each top-level message made, by the message's uuid, so a message that replaces it can take them out. */
  private madeBy = new Map<string, string[]>()
  /** The id of the compaction running now, which its result and its boundary update. */
  private compacting?: string
  /** The summary of the last background task that finished while no turn ran, for the turn it starts. */
  private wake?: string
  /** The plugin errors the last init showed, since each init carries them again. */
  private pluginErrors?: string
  /** Set from a retry notice until the next response starts, which ends it. */
  private retrying = false

  constructor(private readonly dir: string) {}

  /**
   * `at` stamps finished text: now for a live message, its own time for a stored one. `idle` says that no
   * turn runs, so a turn that starts now is one Claude Code started itself.
   */
  map(message: SDKMessage, at?: number, idle = false): ThreadEvent[] {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") return [{ kind: "init", model: modelLabel(message.model) }, ...this.selfStarted(message.uuid, at, idle), ...this.mapPluginErrors(message)]
        if (message.subtype === "task_notification") {
          if (idle) this.wake = message.summary
          return []
        }
        // A command such as /context answers with text of its own, not a reply from Claude.
        if (message.subtype === "local_command_output") return [item({ type: "text", id: message.uuid, text: message.content, done: true, ...(at !== undefined ? { at } : {}) })]
        if (message.subtype === "status") return this.mapCompactionStatus(message)
        if (message.subtype === "compact_boundary") {
          const id = this.compacting ?? `compaction:${message.uuid}`
          this.compacting = undefined
          const { pre_tokens: preTokens, post_tokens: postTokens } = message.compact_metadata
          return [item({ type: "compaction", id, status: "done", preTokens, ...(postTokens ? { postTokens } : {}) })]
        }
        if (message.subtype === "informational") return this.mapNotice(message)
        // The model declined, and Claude Code asked another model. What the first one said goes, and a line says why.
        if (message.subtype === "model_refusal_fallback") {
          return [...this.remove(message.retracted_message_uuids), item({ type: "notice", id: message.uuid, text: message.content, warning: true })]
        }
        if (message.subtype === "api_retry") {
          this.retrying = true
          return [{ kind: "retry", attempt: message.attempt, maxRetries: message.max_retries, delayMs: message.retry_delay_ms, error: retryReason(message.error, message.error_status) }]
        }
        return []
      case "stream_event":
        return this.mapStreamEvent(message.event, message.uuid, message.parent_tool_use_id)
      case "assistant":
        // A subagent's own steps stay inside its tool call.
        if (message.parent_tool_use_id) return []
        this.lastReply = undefined
        return [...this.remove(message.supersedes), ...this.made(message.uuid, this.mapAssistant(message.message.content, message.uuid, at)).map(item)]
      case "user": {
        if (message.parent_tool_use_id) return []
        return this.made(message.uuid, this.mapToolResults(message.message.content)).map(item)
      }
      case "result":
        this.lastReply = undefined
        this.retrying = false
        return [item({ type: "result", id: message.uuid, durationMs: message.duration_ms, isError: message.is_error })]
      default:
        return []
    }
  }

  /** Notes the items a message made, under its uuid. A tool result notes the call it completes. */
  private made(uuid: string | undefined, items: ThreadItem[]): ThreadItem[] {
    if (uuid && items.length) this.madeBy.set(uuid, items.map((found) => found.id))
    return items
  }

  /**
   * Takes out the items of messages a later one replaces. Claude Code replaces a response the model refused
   * once another model answers, and one whose tool call it could not parse once the model answers again.
   * A tool call goes with its result, since the call was never made. A message Comet does not know is skipped.
   */
  private remove(uuids: readonly string[] | undefined): ThreadEvent[] {
    const ids = new Set((uuids ?? []).flatMap((uuid) => this.madeBy.get(uuid) ?? []))
    for (const uuid of uuids ?? []) this.madeBy.delete(uuid)
    if (!ids.size) return []
    for (const id of ids) this.tools.delete(id)
    if (this.lastReply && ids.has(this.lastReply.id)) this.lastReply = undefined
    return [{ kind: "items.remove", ids: [...ids] }]
  }

  /**
   * The opener of a turn Claude Code starts itself, after T3 Code. It starts one when a background task
   * finishes, or when a subagent or another session sends it a message. For a background task, the live
   * stream sends the task's notification and the turn's init, but no user message. So any turn that starts
   * while no turn runs opens with this line, and the tab works again until it ends. The stored transcript
   * does carry the message, which `history` reads.
   */
  private selfStarted(uuid: string, at: number | undefined, idle: boolean): ThreadEvent[] {
    const summary = this.wake
    this.wake = undefined
    if (!idle) return []
    const opener = item({ type: "user", id: `self-started:${uuid}`, text: summary || SELF_STARTED, selfStarted: true, ...(at !== undefined ? { at } : {}) })
    return [opener, { kind: "status", busy: true }]
  }

  /**
   * A notice Claude Code shows the user, such as a hook's note, after T3 Code. Notes meant only for the
   * transcript stay out, and so does the summary a Stop hook leaves after every turn unless it stopped the turn.
   */
  private mapNotice(message: Extract<SDKMessage, { type: "system"; subtype: "informational" }>): ThreadEvent[] {
    if (message.level === "info") return []
    const stopHookSummary = message.level === "notice" && message.content.startsWith("Stop says: ") && !message.prevent_continuation
    if (stopHookSummary) return []
    return [item({ type: "notice", id: message.uuid, text: message.content, warning: message.level === "warning" || !!message.prevent_continuation })]
  }

  /**
   * The plugins that did not load, as one warning. Claude Code sends init at a session start, after a resume
   * and for a turn it starts itself, so a list that matches the last one shown adds nothing. An init without
   * errors lets a later failure show again.
   * A stored transcript has no init, so a reopened thread shows the warning once, at its first new turn.
   */
  private mapPluginErrors(message: Extract<SDKMessage, { type: "system"; subtype: "init" }>): ThreadEvent[] {
    const errors = message.plugin_errors
    if (!errors?.length) {
      this.pluginErrors = undefined
      return []
    }
    const lines = errors.map((error) => `${pluginText(error.plugin)}: ${pluginText(error.message)}`)
    const text = `${errors.length === 1 ? "A plugin" : "Plugins"} did not load.\n${lines.join("\n")}`
    if (text === this.pluginErrors) return []
    this.pluginErrors = text
    return [item({ type: "notice", id: `plugin-errors:${message.uuid}`, text, warning: true })]
  }

  /**
   * The latest reply, finished and marked as cut short, after T3 Code. A steer that lands while Claude streams
   * a reply ends it there, and it would otherwise read as complete, or as still streaming.
   */
  interruptedReply(at: number): ThreadItem | undefined {
    const reply = this.lastReply
    this.lastReply = undefined
    this.streaming = undefined
    if (!reply?.text.trim()) return undefined
    return { type: "text", id: reply.id, text: reply.text, done: true, interrupted: true, at: reply.at ?? at }
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
    // A retried request that recovers may open with a long tool input or thought, which shows nothing until
    // it ends. The response's start says the retry is over, so the status clears its notice, after T3 Code.
    if (event.type === "message_start" && this.retrying) {
      this.retrying = false
      return [{ kind: "status", busy: true }]
    }
    if (event.type === "content_block_start" && event.content_block.type === "text") {
      this.streaming = uuid
      this.lastReply = { id: uuid, text: "" }
      return [item({ type: "text", id: uuid, text: "", done: false })]
    }
    if (event.type === "content_block_delta" && event.delta.type === "text_delta" && this.streaming) {
      if (this.lastReply?.id === this.streaming) this.lastReply.text += event.delta.text
      return [{ kind: "text.delta", id: this.streaming, delta: event.delta.text }]
    }
    return []
  }

  private mapAssistant(content: SDKAssistantMessage["message"]["content"], uuid: string, at: number | undefined): ThreadItem[] {
    return content.flatMap((block, index): ThreadItem[] => {
      if (block.type === "text") {
        const id = this.streaming ?? `${uuid}:${index}`
        this.streaming = undefined
        this.lastReply = { id, text: block.text, ...(at !== undefined ? { at } : {}) }
        return [{ type: "text", id, text: block.text, done: true, ...(at !== undefined ? { at } : {}) }]
      }
      if (block.type === "thinking") {
        return [thought(`${uuid}:${index}`, block.thinking)]
      }
      if (block.type === "tool_use") {
        // A visual draws in place of its call, and its result adds nothing to it.
        const comet = cometTool(block.name)
        const visual = comet && visualItem(block.id, comet, block.input)
        if (visual) return [visual]
        const tool = toolItem(this.dir, block.id, block.name, block.input as Record<string, unknown>)
        this.tools.set(tool.id, tool)
        return [tool]
      }
      return []
    })
  }

  /** Each result completes the tool call it answers, which is then no longer open. */
  private mapToolResults(content: unknown): ThreadItem[] {
    if (!Array.isArray(content)) return []
    return content.flatMap((block): ThreadItem[] => {
      const tool = block.type === "tool_result" ? this.tools.get(String(block.tool_use_id)) : undefined
      if (!tool) return []
      this.tools.delete(tool.id)
      return [toolStep({ ...tool, result: { output: cutOutput(toolOutputText(block.content)), isError: Boolean(block.is_error) } })]
    })
  }

  /** Ends each tool call that has no result yet, for a turn that ended without them. */
  settleOpen(end: "failed" | "stopped"): ThreadItem[] {
    const settled = [...this.tools.values()].map((tool) => toolStep({ ...tool, result: unfinishedResult(end) }))
    this.tools.clear()
    return settled
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
  const comet = cometTool(name)
  const summary = (comet && cometToolSummary(comet, input)) ?? (field ? relativeTo(dir, String(input[field])) : JSON.stringify(input))
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
  if (typeof content === "string") return subagentReport(content)
  if (Array.isArray(content)) return subagentReport(content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n"))
  return ""
}

/** A subagent's report without the notes Claude Code adds for the model that started it. Other output stays as it is. */
function subagentReport(output: string): string {
  const text = output.replace(TOOLS_USED_NOTE, "")
  if (!HAND_BACK_FRAME.test(text)) return text
  return text.replace(HAND_BACK_FRAME, "").replace(USAGE_TRAILER, "").replace(AGENT_ID_TRAILER, "").replace(REPORT_INDENT, "")
}

/** The images the user sent, as base64. Claude Code stores pasted images in the transcript this way. */
function userImages(content: unknown): ImageAttachment[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block) =>
    block.type === "image" && block.source?.type === "base64" && IMAGE_TYPES.includes(block.source.media_type) ? [{ mediaType: block.source.media_type, data: block.source.data }] : [],
  )
}

/**
 * The opening line of a stored turn Claude Code started itself, or undefined for any other message. Claude
 * Code starts one when a background task finishes, and when a subagent or another session sends it a message,
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

function pluginText(text: string): string {
  const plain = text.replace(UNSAFE_CHARACTERS, " ").trim()
  return plain.length > PLUGIN_ERROR_LIMIT ? `${plain.slice(0, PLUGIN_ERROR_LIMIT)}...` : plain
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
