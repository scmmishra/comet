import { DELEGATE, LIST_AGENTS } from "../delegate/tools"
import { SHOW } from "../visuals/show"
import { MOVE_TO_WORKTREE } from "./move"
import { given, type CometTool } from "./tool"

/** Every tool Comet offers, whichever sessions get it, so a thread names a call of any of them. */
const TOOLS: readonly CometTool[] = [LIST_AGENTS, DELEGATE, MOVE_TO_WORKTREE, SHOW]

/** What a call of one of Comet's tools was given, in short, for its row in a thread. Undefined for a tool that is not Comet's. */
export function cometToolSummary(tool: string, input: unknown): string | undefined {
  return TOOLS.find((found) => found.name === tool)?.summary(given(input))
}

/** A call of one of Comet's tools in a few words, from its summary, whichever agent made it. */
export function cometToolLabel(tool: string, summary: string, done: boolean): string {
  return TOOLS.find((found) => found.name === tool)?.label(summary, done) ?? `${tool} ${summary}`.trim()
}
