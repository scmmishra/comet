import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk"
import { IMAGE_TYPES, type ImageAttachment, type TextEdit, type ThreadEvent, type ThreadItem } from "@desk/protocol"

/** What Claude Code writes into a transcript when the user stops a turn, with or without "for tool use". */
const INTERRUPTED = /^\[Request interrupted by user/

/** Tool output beyond this many characters is cut. The thread shows a summary, not a log. */
const MAX_TOOL_OUTPUT = 4000
/** Inputs that say in short what a tool call does, in the order a summary prefers them. */
const SUMMARY_FIELDS = ["command", "file_path", "pattern", "path", "url", "query", "description"]

type ToolItem = Extract<ThreadItem, { type: "tool" }>

/**
 * Turns Agent SDK messages into thread events for one project's thread. It keeps the text block being
 * streamed, so the full message that follows finishes it instead of adding a copy, and each tool call,
 * so its result can complete it.
 */
export class ThreadMapper {
  private streaming?: string
  private tools = new Map<string, ToolItem>()

  constructor(private readonly dir: string) {}

  /** `at` stamps finished text: now for a live message, its own time for a stored one. */
  map(message: SDKMessage, at?: number): ThreadEvent[] {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") return [{ kind: "init", model: message.model }]
        // A command such as /context answers with text of its own, not a reply from Claude.
        if (message.subtype === "local_command_output") return [item({ type: "text", id: message.uuid, text: message.content, done: true, ...(at !== undefined ? { at } : {}) })]
        return []
      case "stream_event":
        return this.mapStreamEvent(message.event, message.uuid, message.parent_tool_use_id)
      case "assistant":
        // A subagent's own steps stay inside its tool call.
        if (message.parent_tool_use_id) return []
        return this.mapAssistant(message.message.content, message.uuid, at).map(item)
      case "user": {
        if (message.parent_tool_use_id) return []
        // A background task that finished starts a turn of Claude's own. The tab works again until it ends.
        const task = taskSummary(message.message.content)
        if (task !== undefined) return [item({ type: "user", id: message.uuid ?? `task-${at ?? Date.now()}`, text: task, fromTask: true, ...(at !== undefined ? { at } : {}) }), { kind: "status", busy: true }]
        return this.mapToolResults(message.message.content).map(item)
      }
      case "result":
        return [item({ type: "result", id: message.uuid, durationMs: message.duration_ms, isError: message.is_error })]
      default:
        return []
    }
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
        const text = block.thinking.trim()
        return [{ type: "thinking", id: `${uuid}:${index}`, ...(text ? { text } : {}) }]
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
      return tool ? [{ ...tool, result: { output: truncate(toolOutputText(block.content)), isError: Boolean(block.is_error) } }] : []
    })
  }

  /**
   * Rebuilds a thread from a stored transcript, so a restored tab shows its conversation. Each turn
   * ends with a result, timed from the user's message to the last reply, so restored turns fold the
   * way live ones do.
   */
  history(messages: readonly (SessionMessage & { readonly timestamp?: string })[]): ThreadItem[] {
    // A tool's result replaces its call in place, so the items keep their order.
    const items = new Map<string, ThreadItem>()
    const add = (found: ThreadItem) => items.set(found.id, found)
    let turn: { id: string; start: number; end?: number; stopped?: boolean } | undefined
    const closeTurn = () => {
      if (turn?.end !== undefined) add({ type: "result", id: `result:${turn.id}`, durationMs: turn.end - turn.start, isError: false, ...(turn.stopped ? { stopped: true } : {}) })
      turn = undefined
    }
    for (const stored of messages) {
      if (stored.parent_tool_use_id) continue
      const at = stored.timestamp ? Date.parse(stored.timestamp) : undefined
      if (stored.type === "assistant") {
        if (turn && at !== undefined) turn.end = at
        this.mapAssistant((stored.message as SDKAssistantMessage["message"]).content, stored.uuid, at).forEach(add)
      } else if (stored.type === "user") {
        const content = (stored.message as { content?: unknown }).content
        const task = taskSummary(content)
        if (task !== undefined) {
          closeTurn()
          if (at !== undefined) turn = { id: stored.uuid, start: at }
          add({ type: "user", id: stored.uuid, text: task, fromTask: true, ...(at !== undefined ? { at } : {}) })
          continue
        }
        const text = userText(content)
        if (text === undefined) {
          this.mapToolResults(content).forEach(add)
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
  const summary = SUMMARY_FIELDS.find((field) => typeof input[field] === "string")
  return {
    type: "tool",
    id,
    name,
    summary: summary ? relativeTo(dir, String(input[summary])) : JSON.stringify(input),
    ...(edits ? { file: relativeTo(dir, String(input.file_path ?? "")), edits } : {}),
  }
}

/** A tool call's input in full, for the user to judge before allowing it. A single field shows as its value. */
export function toolDetail(input: Record<string, unknown>): string {
  const fields = Object.values(input)
  return fields.length === 1 && typeof fields[0] === "string" ? fields[0] : JSON.stringify(input, null, 2)
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

const relativeTo = (dir: string, path: string) => (path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path)

function toolOutputText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
  return ""
}

function truncate(text: string) {
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…` : text
}

/** The images the user sent, as base64. Claude Code stores pasted images in the transcript this way. */
function userImages(content: unknown): ImageAttachment[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block) =>
    block.type === "image" && block.source?.type === "base64" && IMAGE_TYPES.includes(block.source.media_type) ? [{ mediaType: block.source.media_type, data: block.source.data }] : [],
  )
}

/**
 * The summary of a background task that finished, when Claude Code adds its notice to the conversation.
 * Claude Code then starts a turn on its own, so the notice opens that turn.
 */
function taskSummary(content: unknown): string | undefined {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n") : ""
  if (!text.trimStart().startsWith("<task-notification>")) return undefined
  return /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]?.trim() || "A background task finished."
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
