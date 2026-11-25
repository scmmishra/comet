import type { Step, StepKind } from "@comet/protocol"
import { SERVER_NAME } from "../../tools/mcp"
import { cometToolLabel } from "../../tools/rows"
import { commandLabel, PLAN_UPDATED, tool, type BareStep } from "../steps"
import { ASK_USER_QUESTION } from "./requests"

type Tool = Extract<Step, { type: "tool" }>
type BareTool = Extract<BareStep, { type: "tool" }>

/** How Claude Code names a tool of Comet's own MCP server, such as `mcp__comet__delegate`. */
export const COMET_TOOL = `mcp__${SERVER_NAME}__`

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
      return PLAN_UPDATED
    case ASK_USER_QUESTION:
      return step.result ? "Asked a question" : "Asking a question"
    case "Task":
    case "Agent":
      return `Started an agent: ${target}`
    default: {
      const comet = cometTool(step.name)
      return comet ? cometToolLabel(comet, step.summary, !!step.result) : `${step.name} ${target}`.trim()
    }
  }
}

/** The tool of Comet's that a tool name stands for, or undefined for any other tool. */
export const cometTool = (name: string) => (name.startsWith(COMET_TOOL) ? name.slice(COMET_TOOL.length) : undefined)

/** A call of one of Claude Code's tools as a step, with its kind and label. */
export const toolStep = (step: BareTool): Tool => tool(step, KIND_BY_TOOL[step.name] ?? "other", label(step))
