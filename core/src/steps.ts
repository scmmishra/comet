import type { Step, StepKind } from "@desk/protocol"

/** A step as the mapper makes it, before it is named. */
export type BareStep = Step extends infer T ? (T extends Step ? Omit<T, "kind" | "label"> : never) : never
type Tool = Extract<Step, { type: "tool" }>
type Thought = Extract<Step, { type: "thinking" }>

/** A label is one line, whatever its target holds, so a long command never spills over the rows below. */
export const oneLine = (label: string) => label.replace(/\s+/g, " ").trim()

/** A thought as a step, labelled by its first line. Every agent's thinking reads the same way. */
export function thought(id: string, text?: string): Thought {
  const words = text?.trim()
  return { type: "thinking", id, ...(words ? { text: words } : {}), kind: "thought", label: words ? oneLine(thoughtLine(words)) : "Thought" }
}

/** A tool call as a step. Each agent says what kind its tool is and labels it in its own words. */
export function tool(step: Extract<BareStep, { type: "tool" }>, kind: StepKind, label: string): Tool {
  return { ...step, kind, label: oneLine(label) }
}

/** A command's label: the program it runs, and whether it is running, ran or failed. */
export const commandLabel = (command: string, result: Tool["result"]) => `${!result ? "Running" : result.isError ? "Failed" : "Ran"} ${commandProgram(command)}`

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
  for (const tool of tools) byKind.set(tool.kind, [...(byKind.get(tool.kind) ?? []), tool])
  const count = (kind: StepKind, found: Tool[]) => (kind === "read" || kind === "edit" ? new Set(found.map((tool) => tool.file ?? tool.summary)).size : found.length)
  const named = [...byKind.keys()].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b)).slice(0, NAMED_KINDS)
  const parts = [...byKind.entries()].filter(([kind]) => named.includes(kind)).map(([kind, found]) => phrase(kind, count(kind, found)))
  const others = [...byKind.entries()].filter(([kind]) => !named.includes(kind)).reduce((sum, [, found]) => sum + found.length, 0)
  if (others) parts.push(others === 1 ? "performed 1 other action" : `performed ${others} other actions`)
  const joined = parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}
