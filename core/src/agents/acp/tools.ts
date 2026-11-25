import type { StepKind, TextEdit, ThreadItem } from "@comet/protocol"
import { commandLabel, cutOutput, PLAN_UPDATED, relativeTo, tool } from "../steps"
import type { ToolCall, ToolKind } from "./protocol"

type ToolItem = Extract<ThreadItem, { type: "tool" }>

const EDIT_VERBS = { edit: "Edited", delete: "Deleted", move: "Moved" } as const

/**
 * Where an agent keeps what a tool call ran and printed, and which of its calls update its plan. ACP has no
 * field for any of them, so each agent puts the first two in its own `rawInput` and `rawOutput`, or in the
 * call's content, and names its plan's tool in its own way.
 */
export interface ToolReader {
  /** The shell command an execute call runs. */
  command(call: ToolCall): string | undefined
  /** What the call printed or answered. */
  output(call: ToolCall): string | undefined
  /** Whether the call updates the agent's plan. */
  updatesPlan?(call: ToolCall): boolean
}

/** How an agent that follows ACP's own fields reports a call: the command in `rawInput.command`, the output as text content. */
export const acpToolReader: ToolReader = {
  command: (call) => stringField(call.rawInput, "command"),
  output(call) {
    const text = (call.content ?? []).flatMap((entry) => (entry.type === "content" && entry.content.type === "text" ? [entry.content.text] : []))
    if (text.length) return text.join("\n")
    return typeof call.rawOutput === "string" ? call.rawOutput : undefined
  },
}

/** A string field of a raw input or output, when it is an object that has one. */
export function stringField(raw: unknown, key: string): string | undefined {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * A tool call as the thread draws it, from everything the agent reported about it so far. ACP's kind
 * picks the tool's name and step kind, after the names Claude Code's tools show under.
 */
export function toolItem(dir: string, call: ToolCall, reader: ToolReader): ToolItem {
  const command = reader.command(call)
  const kind: ToolKind = call.kind ?? (command ? "execute" : "other")
  const title = call.title?.trim() || kind
  const path = filePath(call)
  const target = path ? relativeTo(dir, path) : title
  const result = call.status === "completed" || call.status === "failed" ? { output: cutOutput(reader.output(call) ?? ""), isError: call.status === "failed" } : undefined
  const step = (name: string, stepKind: StepKind, summary: string, label: string, extra: Pick<ToolItem, "file" | "edits"> = {}) =>
    tool({ type: "tool", id: call.toolCallId, name, summary, ...extra, ...(result ? { result } : {}) }, stepKind, label)
  if (reader.updatesPlan?.(call)) return step(title, "other", title, PLAN_UPDATED)
  switch (kind) {
    case "execute":
      return step("Bash", "command", command ?? title, commandLabel(command ?? title, result))
    case "edit":
    case "delete":
    case "move": {
      const edits = diffEdits(call)
      return step("Edit", "edit", target, `${EDIT_VERBS[kind]} ${target}`, { ...(path ? { file: target } : {}), ...(edits.length ? { edits } : {}) })
    }
    case "read":
      return step("Read", "read", target, `Read ${target}`)
    case "search":
      return step("Search", "search", title, `Searched ${title}`)
    case "fetch":
      return step("Fetch", "web", title, `Fetched ${title}`)
    default:
      return step(title, "other", title, title)
  }
}

/** The file a call works on: the first place it reports, else the first file it changed. */
function filePath(call: ToolCall): string | undefined {
  return call.locations?.[0]?.path ?? call.content?.find((entry) => entry.type === "diff")?.path
}

/** The before and after text of each file the call changed. A new file has no before. */
function diffEdits(call: ToolCall): TextEdit[] {
  return (call.content ?? []).flatMap((entry) => (entry.type === "diff" ? [{ before: entry.oldText ?? "", after: entry.newText }] : []))
}
