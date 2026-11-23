import { basename } from "node:path"
import type { CometTool, ToolGroup } from "./tool"

/** What a session whose thread can move into a worktree is told. */
const MOVE_INSTRUCTIONS =
  "When the user asks you to work in a git worktree, make it with `git worktree add` if it does not exist, then call `move_to_worktree` with its path. Comet then runs your next turns in it and shows its changes. A worktree you make for another use, such as a baseline to compare against, needs no move."

export const MOVE_TO_WORKTREE: CometTool = {
  name: "move_to_worktree",
  description:
    "Moves this thread into another checkout of this repo, such as a git worktree. Comet moves it when this turn ends, and the next turn runs there. Until then, run commands in the worktree by its path. Give the main checkout's path to move back.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "The absolute path of the worktree." } },
    required: ["path"],
    additionalProperties: false,
  },
  summary: (input) => basename(String(input.path ?? "")),
  label: (summary, done) => `${done ? "Moved to" : "Moving to"} ${summary}`,
}

/**
 * The tool that moves a session's thread, for an agent whose threads can move. `moveTo` notes the move for
 * when the turn ends and returns the folder the thread moves to.
 */
export const moveTools = (moveTo: (dir: string) => string): ToolGroup => ({
  instructions: MOVE_INSTRUCTIONS,
  tools: [MOVE_TO_WORKTREE],
  call: async (_, input) => ({ text: `Comet moves this thread to ${moveTo(String(input.path ?? ""))} when this turn ends.` }),
})
