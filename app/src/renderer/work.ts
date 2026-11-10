import type { ThreadItem } from "@desk/protocol"
import type { IconName } from "./icons"

/** One step of Claude's work in a turn: a thought or a tool call. */
export type Step = Extract<ThreadItem, { type: "thinking" | "tool" }>
type Tool = Extract<Step, { type: "tool" }>

export type StepKind = "thought" | "command" | "edit" | "read" | "search" | "web" | "other"

const KIND_BY_TOOL: Record<string, StepKind> = {
  Bash: "command",
  BashOutput: "command",
  KillShell: "command",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Read: "read",
  Grep: "search",
  Glob: "search",
  WebSearch: "web",
  WebFetch: "web",
}

export const ICON_BY_KIND: Record<StepKind, IconName> = {
  thought: "outline-brain",
  command: "outline-console",
  edit: "edit",
  read: "outline-eye",
  search: "magnifying-glass",
  web: "globe",
  other: "code-slash",
}

export const isStep = (item: ThreadItem): item is Step => item.type === "thinking" || item.type === "tool"

export const stepKind = (step: Step): StepKind => (step.type === "thinking" ? "thought" : (KIND_BY_TOOL[step.name] ?? "other"))

/**
 * A step in a few words, after T3 Code: "Ran npm test", "Read core/src/main.ts", or the thought's first
 * line. A command still running reads "Running", and one that failed reads "Failed".
 */
export function stepLabel(step: Step): string {
  // A label is one line, whatever its target holds, so a long command never spills over the rows below.
  return label(step).replace(/\s+/g, " ").trim()
}

function label(step: Step): string {
  if (step.type === "thinking") return step.text ? thoughtLine(step.text) : "Thought"
  const target = step.file ?? step.summary
  switch (step.name) {
    case "Bash":
      return `${!step.result ? "Running" : step.result.isError ? "Failed" : "Ran"} ${commandProgram(step.summary)}`
    case "Read":
      return `Read ${target}`
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Edited ${target}`
    case "Write":
      return `Wrote ${target}`
    case "Grep":
      return `Searched ${target}`
    case "Glob":
      return `Searched files ${target}`
    case "WebSearch":
      return `Searched the web for ${target}`
    case "WebFetch":
      return `Fetched ${target}`
    case "TodoWrite":
      return "Updated the plan"
    case "AskUserQuestion":
      return step.result ? "Asked a question" : "Asking a question"
    case "Task":
    case "Agent":
      return `Started an agent: ${target}`
    default:
      return `${step.name} ${target}`.trim()
  }
}

/** Words that set up a command rather than run it, so a label names the program after them. */
const SETUP = /^(cd|pushd|popd|export|source|\.|set|unset|alias)$/
/** Words that run the command after them, such as `sudo npm test`. */
const WRAPPERS = new Set(["sudo", "env", "time", "nice", "nohup", "exec", "command"])

/**
 * The program a shell command runs, after T3 Code: `cd app && npm test` runs npm, and
 * `. ./env.sh; python3 - <<EOF` runs python3. It skips setup such as `cd` and `export`, variables set
 * before the program, and wrappers such as `sudo`. A command of setup alone names its first word.
 */
export function commandProgram(command: string): string {
  const segments = command.split(/\n|&&|\|\||;|\|/).map((segment) => segment.trim()).filter(Boolean)
  for (const segment of segments) {
    const words = segment.split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
    while (words.length > 1 && WRAPPERS.has(words[0]!)) words.shift()
    const first = words[0]
    if (first && !SETUP.test(first)) return first.split("/").at(-1)!
  }
  return segments[0]?.split(/\s+/)[0] ?? "a command"
}

/** A thought in one line: its leading **heading** if it has one, else its first sentence. */
export function thoughtLine(text: string): string {
  const heading = /^\s*\*\*(.+?)\*\*/.exec(text)
  if (heading) return heading[1]!.trim()
  const sentence = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim())
  return (sentence ? sentence[0] : text).replace(/\s+/g, " ").trim()
}

/** Which kinds a group summary names first, when it has more than it can name. */
const PRIORITY: StepKind[] = ["command", "edit", "read", "search", "web", "other"]
/** A group summary names this many kinds, and counts the rest as other actions. */
const NAMED_KINDS = 2

const phrase = (kind: StepKind, count: number): string => {
  const n = (one: string, many: string) => (count === 1 ? one : many.replace("N", String(count)))
  switch (kind) {
    case "command":
      return n("ran a command", "ran N commands")
    case "edit":
      return n("changed a file", "changed N files")
    case "read":
      return n("read a file", "read N files")
    case "search":
      return n("searched code once", "searched code N times")
    case "web":
      return n("searched the web once", "searched the web N times")
    default:
      return n("used a tool", "used N tools")
  }
}

/**
 * A group of steps in one line, after T3 Code: "Read 3 files and ran 2 commands". Files read or changed
 * count once each. Thoughts are not counted. It names the two kinds that matter most, in the order they
 * came, and counts the rest as other actions. A group of thoughts alone reads "Thought".
 */
export function groupSummary(steps: readonly Step[]): string {
  const tools = steps.filter((step): step is Tool => step.type === "tool")
  if (!tools.length) return steps.length > 1 ? `Thought (×${steps.length})` : "Thought"
  const byKind = new Map<StepKind, Tool[]>()
  for (const tool of tools) byKind.set(stepKind(tool), [...(byKind.get(stepKind(tool)) ?? []), tool])
  const count = (kind: StepKind, found: Tool[]) => (kind === "read" || kind === "edit" ? new Set(found.map((tool) => tool.file ?? tool.summary)).size : found.length)
  const named = [...byKind.keys()].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b)).slice(0, NAMED_KINDS)
  const parts = [...byKind.entries()].filter(([kind]) => named.includes(kind)).map(([kind, found]) => phrase(kind, count(kind, found)))
  const others = [...byKind.entries()].filter(([kind]) => !named.includes(kind)).reduce((sum, [, found]) => sum + found.length, 0)
  if (others) parts.push(others === 1 ? "performed 1 other action" : `performed ${others} other actions`)
  const joined = parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}
