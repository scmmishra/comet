import { basename } from "node:path"
import { firstLine } from "../text"
import { SHOW } from "../visuals/show"
import type { Tool } from "./mcp"

/** The name agents know Comet's tools under, such as `mcp__comet__delegate` in Claude Code. */
export const SERVER_NAME = "comet"

/**
 * What every session is told about the tools. An agent's own subagents are cheaper and share its context,
 * so the tools are for work another agent should do.
 */
export const INSTRUCTIONS = [
  "Comet, the app you run in, can hand a task to another coding agent on this Mac, such as Claude Code, Codex or Antigravity.",
  `Use the \`${SERVER_NAME}\` tools for that when the user asks for another agent or one of its models, or asks for a second opinion from one. Use your own subagent tool for work your own models can do.`,
  "Call `list_agents` once before the first `delegate`, to see which agents are ready and what their models are called. If the agent or model the user asked for is not there, say so. Do not pick another one unasked.",
  "`delegate` runs the task to its end and returns the other agent's final message. The other agent works in the same folder, and sees only the task you write, not this conversation. So write a task that stands on its own: the goal, the files that matter, and what to report back.",
].join("\n")

export const LIST_AGENTS: Tool = {
  name: "list_agents",
  description: "Lists the coding agents Comet can hand a task to, whether each is ready, and each one's models and effort levels. Call it once before the first `delegate`.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}

export const DELEGATE: Tool = {
  name: "delegate",
  description:
    "Hands a task to another coding agent and waits for it to finish. Returns the agent's final message. The agent works in the same folder, with tools no broader than yours, and sees only `task`, not this conversation. It can run for many minutes.",
  inputSchema: {
    type: "object",
    properties: {
      agent: { type: "string", description: "The agent's id from `list_agents`, such as `codex`." },
      task: { type: "string", description: "What the agent should do, written to stand on its own: the goal, the files that matter, and what to report back." },
      model: { type: "string", description: "One of that agent's models from `list_agents`. Leave it out for the agent's default model." },
      effort: { type: "string", description: "One of that model's effort levels from `list_agents`. Leave it out for the model's default." },
      title: { type: "string", description: "A few words that name the task, shown to the user while it runs." },
    },
    required: ["agent", "task"],
    additionalProperties: false,
  },
}

/** What a session whose thread can move into a worktree is told, after `INSTRUCTIONS`. */
export const MOVE_INSTRUCTIONS =
  "When the user asks you to work in a git worktree, make it with `git worktree add` if it does not exist, then call `move_to_worktree` with its path. Comet then runs your next turns in it and shows its changes. A worktree you make for another use, such as a baseline to compare against, needs no move."

export const MOVE_TO_WORKTREE: Tool = {
  name: "move_to_worktree",
  description:
    "Moves this thread into another checkout of this repo, such as a git worktree. Comet moves it when this turn ends, and the next turn runs there. Until then, run commands in the worktree by its path. Give the main checkout's path to move back.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "The absolute path of the worktree." } },
    required: ["path"],
    additionalProperties: false,
  },
}

/** A task in a few words: the start of its first line. */
export const taskWords = (text: string) => firstLine(text).slice(0, 80)

/**
 * What a call of one of Comet's tools was given, in short, for its row in a thread: the agent and the
 * task's first words. Undefined for a tool that is not Comet's.
 */
export function cometToolSummary(tool: string, input: unknown): string | undefined {
  if (tool === LIST_AGENTS.name) return ""
  const given = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  if (tool === MOVE_TO_WORKTREE.name) return basename(String(given.path ?? ""))
  // A visual draws in place of its call. Only a call Comet could not draw shows as a row.
  if (tool === SHOW.name) return typeof given.title === "string" ? given.title : ""
  if (tool !== DELEGATE.name) return undefined
  return `${String(given.agent ?? "another agent")}: ${taskWords(typeof given.title === "string" && given.title.trim() ? given.title : String(given.task ?? ""))}`
}

/** A call of one of Comet's tools in a few words, from its summary, whichever agent made it. */
export function cometToolLabel(tool: string, summary: string, done: boolean): string {
  if (tool === LIST_AGENTS.name) return done ? "Listed the agents" : "Listing the agents"
  if (tool === MOVE_TO_WORKTREE.name) return `${done ? "Moved to" : "Moving to"} ${summary}`
  if (tool === SHOW.name) return `${done ? "Tried to show" : "Showing"} ${summary || "a visual"}`
  return `${done ? "Handed a task to" : "Handing a task to"} ${summary}`
}
