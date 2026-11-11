import type { Step, StepKind } from "@desk/protocol"

/** A step as the mapper makes it, before it is named. */
export type BareStep = Step extends infer T ? (T extends Step ? Omit<T, "kind" | "label"> : never) : never
type Tool = Extract<Step, { type: "tool" }>
type Thought = Extract<Step, { type: "thinking" }>

/** Words that set up a command rather than run it, so a label names the program after them. */
const SETUP = /^(cd|pushd|popd|export|source|\.|set|unset|alias)$/
/** Words that run the command after them, such as `sudo npm test`. */
const WRAPPERS = new Set(["sudo", "env", "time", "nice", "nohup", "exec", "command"])

/** Tool output beyond this many characters is cut. The thread shows a summary, not a log. */
const MAX_TOOL_OUTPUT = 4000

/** A tool's output as the thread keeps it, cut where it runs long. */
export const cutOutput = (text: string) => (text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…` : text)

/** A path as the thread shows it: relative to the project when it is inside it. */
export const relativeTo = (dir: string, path: string) => (path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path)

/** A label is one line, whatever its target holds, so a long command never spills over the rows below. */
const oneLine = (label: string) => label.replace(/\s+/g, " ").trim()

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

/**
 * The program a shell command runs, after T3 Code: `cd app && npm test` runs npm, and
 * `. ./env.sh; python3 - <<EOF` runs python3. It skips setup such as `cd` and `export`, variables set
 * before the program, and wrappers such as `sudo`. A command of setup alone names its first word.
 */
function commandProgram(command: string): string {
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
function thoughtLine(text: string): string {
  const heading = /^\s*\*\*(.+?)\*\*/.exec(text)
  if (heading) return heading[1]!.trim()
  const sentence = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim())
  return (sentence ? sentence[0] : text).replace(/\s+/g, " ").trim()
}
