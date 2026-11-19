import type { ThreadEvent, ThreadItem } from "@comet/protocol"
import { thought, unfinishedResult } from "../steps"
import type { SessionUpdate, ToolCall } from "./protocol"
import { toolItem, type ToolReader } from "./tools"

/**
 * Turns an ACP session's updates into thread events. Text and thoughts arrive in chunks, so it keeps the
 * message and the thought being written, and finishes them when a thought or a tool call comes between,
 * or when the turn ends. It keeps each tool call, since an update carries only the fields that changed.
 */
export class UpdateMapper {
  private text?: { readonly id: string; text: string }
  private thinking?: { readonly id: string; text: string }
  private tools = new Map<string, ToolCall>()

  constructor(
    private readonly dir: string,
    private readonly reader: ToolReader,
  ) {}

  /** `at` stamps text that finishes. */
  map(update: SessionUpdate, at: number): ThreadEvent[] {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return update.content.type === "text" ? this.addText(update.content.text) : []
      case "agent_thought_chunk":
        return update.content.type === "text" ? [...this.endText(at), this.addThought(update.content.text)] : []
      case "tool_call":
      case "tool_call_update":
        return [...this.finish(at), item(this.updateTool(update))]
      case "usage_update":
        return update.size > 0 ? [{ kind: "context", reading: { percent: Math.round((update.used / update.size) * 100), tokens: update.used, maxTokens: update.size } }] : []
      default:
        return []
    }
  }

  /** Finishes the message and the thought being written, as the turn ends or something else comes between them. */
  finish(at: number): ThreadEvent[] {
    this.thinking = undefined
    return this.endText(at)
  }

  /** Takes back the text being written when `matches` says it is not the agent's reply. */
  dropText(matches: (text: string) => boolean): ThreadEvent[] {
    const text = this.text
    if (!text || !matches(text.text)) return []
    this.text = undefined
    return [{ kind: "items.remove", ids: [text.id] }]
  }

  /**
   * Ends each tool call still open as one that did not finish, in the error look, after T3 Code. With
   * `pendingOnly`, it ends only the calls the agent never started, since an agent that is still alive may
   * finish the rest.
   */
  endTools(pendingOnly: boolean): ThreadEvent[] {
    const open = [...this.tools.values()].filter((call) => (pendingOnly ? (call.status ?? "pending") === "pending" : call.status !== "completed" && call.status !== "failed"))
    return open.map((known) => {
      const call: ToolCall = { ...known, status: "failed" }
      this.tools.set(call.toolCallId, call)
      const found = toolItem(this.dir, call, this.reader)
      return item({ ...found, result: unfinishedResult("failed") })
    })
  }

  private endText(at: number): ThreadEvent[] {
    const text = this.text
    this.text = undefined
    return text ? [item({ type: "text", id: text.id, text: text.text, done: true, at })] : []
  }

  private addText(chunk: string): ThreadEvent[] {
    this.thinking = undefined
    if (this.text) {
      this.text.text += chunk
      return [{ kind: "text.delta", id: this.text.id, delta: chunk }]
    }
    this.text = { id: crypto.randomUUID(), text: chunk }
    return [item({ type: "text", id: this.text.id, text: chunk, done: false })]
  }

  /** A thought is sent whole each time it grows, so its label follows its first line. */
  private addThought(chunk: string): ThreadEvent {
    this.thinking ??= { id: crypto.randomUUID(), text: "" }
    this.thinking.text += chunk
    return item(thought(this.thinking.id, this.thinking.text))
  }

  private updateTool({ sessionUpdate: _, ...update }: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>): ThreadItem {
    const known = this.tools.get(update.toolCallId)
    const changed = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== null && value !== undefined))
    const call: ToolCall = { ...known, ...changed, toolCallId: update.toolCallId }
    this.tools.set(call.toolCallId, call)
    return toolItem(this.dir, call, this.reader)
  }
}

const item = (found: ThreadItem): ThreadEvent => ({ kind: "item", item: found })
