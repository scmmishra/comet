import type { Step, StepKind } from "@desk/protocol"
import { deskToolLabel, SERVER_NAME } from "../../delegate/tools"
import { commandLabel, tool, type BareStep } from "../../steps"
import { ASK_USER_QUESTION } from "./requests"

type Tool = Extract<Step, { type: "tool" }>
type BareTool = Extract<BareStep, { type: "tool" }>

/** How Claude Code names a tool of Desk's own MCP server, such as `mcp__desk__delegate`. */
export const DESK_TOOL = `mcp__${SERVER_NAME}__`

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
    case ASK_USER_QUESTION:
      return step.result ? "Asked a question" : "Asking a question"
    case "Task":
    case "Agent":
      return `Started an agent: ${target}`
    default: {
      const desk = deskTool(step.name)
      return desk ? deskToolLabel(desk, step.summary, !!step.result) : `${step.name} ${target}`.trim()
    }
  }
}

/** The tool of Desk's that a tool name stands for, or undefined for any other tool. */
export const deskTool = (name: string) => (name.startsWith(DESK_TOOL) ? name.slice(DESK_TOOL.length) : undefined)

/** A call of one of Claude Code's tools as a step, with its kind and label. */
export const toolStep = (step: BareTool): Tool => tool(step, KIND_BY_TOOL[step.name] ?? "other", label(step))
