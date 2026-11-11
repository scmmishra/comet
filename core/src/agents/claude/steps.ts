import type { Step, StepKind } from "@desk/protocol"
import { commandLabel, tool, type BareStep } from "../../steps"

type Tool = Extract<Step, { type: "tool" }>
type BareTool = Extract<BareStep, { type: "tool" }>

/** What each of Claude Code's tools does, which picks its icon. Others are plain tools. */
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

/** A call of one of Claude Code's tools in a few words, after T3 Code: "Ran npm test", "Read core/src/main.ts". */
function label(step: BareTool): string {
  const target = step.file ?? step.summary
  switch (step.name) {
    case "Bash":
      return commandLabel(step.summary, step.result)
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

/** A call of one of Claude Code's tools as a step, with its kind and label. */
export const toolStep = (step: BareTool): Tool => tool(step, KIND_BY_TOOL[step.name] ?? "other", label(step))
