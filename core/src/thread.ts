import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk"
import type { ThreadEvent } from "@desk/protocol"

/** Tool output beyond this many characters is cut. The thread shows a summary, not a log. */
const MAX_TOOL_OUTPUT = 4000

/**
 * Turns Agent SDK messages into thread events. It keeps one piece of state: the text block being
 * streamed, so the full assistant message that follows can finish it instead of adding a copy.
 */
export class ThreadMapper {
  private streaming?: string

  /** `at` stamps finished text: now for a live message, its own time for a stored one. */
  map(message: SDKMessage, at?: number): ThreadEvent[] {
    switch (message.type) {
      case "system":
        return message.subtype === "init" ? [{ kind: "init", model: message.model }] : []
      case "stream_event":
        return this.mapStreamEvent(message.event, message.uuid, message.parent_tool_use_id)
      case "assistant":
        // A subagent's own steps stay inside its tool call.
        if (message.parent_tool_use_id) return []
        return this.mapAssistant(message.message.content, message.uuid, at)
      case "user":
        if (message.parent_tool_use_id) return []
        return mapToolResults(message.message.content)
      case "result":
        return [
          {
            kind: "result",
            id: message.uuid,
            durationMs: message.duration_ms,
            costUsd: message.total_cost_usd,
            isError: message.is_error,
          },
        ]
      default:
        return []
    }
  }

  private mapStreamEvent(event: SDKPartialAssistantMessage["event"], uuid: string, parent: string | null): ThreadEvent[] {
    if (parent) return []
    if (event.type === "content_block_start" && event.content_block.type === "text") {
      this.streaming = uuid
      return [{ kind: "text", id: uuid, text: "", done: false }]
    }
    if (event.type === "content_block_delta" && event.delta.type === "text_delta" && this.streaming) {
      return [{ kind: "text.delta", id: this.streaming, delta: event.delta.text }]
    }
    return []
  }

  private mapAssistant(content: SDKAssistantMessage["message"]["content"], uuid: string, at: number | undefined): ThreadEvent[] {
    const events: ThreadEvent[] = []
    content.forEach((block, index) => {
      if (block.type === "text") {
        const id = this.streaming ?? `${uuid}:${index}`
        this.streaming = undefined
        events.push({ kind: "text", id, text: block.text, done: true, ...(at !== undefined ? { at } : {}) })
      } else if (block.type === "thinking") {
        events.push({ kind: "thinking", id: `${uuid}:${index}` })
      } else if (block.type === "tool_use") {
        events.push({ kind: "tool", id: block.id, name: block.name, input: block.input as Record<string, unknown> })
      }
    })
    return events
  }
}

function mapToolResults(content: unknown): ThreadEvent[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((block) => block.type === "tool_result")
    .map((block) => ({
      kind: "tool.result" as const,
      id: String(block.tool_use_id),
      output: truncate(toolOutputText(block.content)),
      isError: Boolean(block.is_error),
    }))
}

function toolOutputText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
  return ""
}

function truncate(text: string) {
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…` : text
}

/** One message of a stored transcript, as the SDK's getSessionMessages returns it. */
export interface StoredMessage {
  readonly type: "user" | "assistant" | "system"
  readonly uuid: string
  readonly message: unknown
  readonly parent_tool_use_id: string | null
  /** When it was written. The SDK returns it but leaves it out of its type. */
  readonly timestamp?: string
}

/**
 * Rebuilds a thread from a stored transcript, so a restored tab shows its conversation. Each turn
 * ends with a result, timed from the user's message to the last reply, so restored turns fold the
 * way live ones do.
 */
export function historyEvents(messages: readonly StoredMessage[]): ThreadEvent[] {
  const mapper = new ThreadMapper()
  const events: ThreadEvent[] = []
  let turn: { id: string; start: number; end?: number } | undefined
  const closeTurn = () => {
    if (turn?.end !== undefined) events.push({ kind: "result", id: `result:${turn.id}`, durationMs: turn.end - turn.start, isError: false })
    turn = undefined
  }
  for (const stored of messages) {
    if (stored.parent_tool_use_id) continue
    const at = stored.timestamp ? Date.parse(stored.timestamp) : undefined
    if (stored.type === "assistant") {
      if (turn && at !== undefined) turn.end = at
      events.push(...mapper.map({ type: "assistant", uuid: stored.uuid, parent_tool_use_id: null, message: stored.message } as SDKMessage, at))
    } else if (stored.type === "user") {
      const content = (stored.message as { content?: unknown }).content
      const text = userText(content)
      if (text === undefined) {
        events.push(...mapToolResults(content))
        continue
      }
      closeTurn()
      if (at !== undefined) turn = { id: stored.uuid, start: at }
      events.push({ kind: "user", id: stored.uuid, text, ...(at !== undefined ? { at } : {}) })
    }
  }
  closeTurn()
  return events
}

/**
 * The text the user typed, or undefined for a tool result. Claude Code also stores messages it
 * writes itself, such as command output and reminders. They start with a tag and stay hidden.
 */
function userText(content: unknown): string | undefined {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content) && content.every((block) => block.type === "text")
        ? content.map((block) => block.text).join("\n")
        : undefined
  if (text === undefined) return undefined
  return text.trimStart().startsWith("<") ? undefined : text
}
