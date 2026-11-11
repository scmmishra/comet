import type { Tool } from "./mcp"

/** The name agents know Desk's tools under, such as `mcp__desk__delegate` in Claude Code. */
export const SERVER_NAME = "desk"

/**
 * What every session is told about the tools. An agent's own subagents are cheaper and share its context,
 * so the tools are for work another agent should do.
 */
export const INSTRUCTIONS = [
  "Desk, the app you run in, can hand a task to another coding agent on this Mac, such as Claude Code, Codex or Antigravity.",
  `Use the \`${SERVER_NAME}\` tools for that when the user asks for another agent or one of its models, or asks for a second opinion from one. Use your own subagent tool for work your own models can do.`,
  "Call `list_agents` once before the first `delegate`, to see which agents are ready and what their models are called. If the agent or model the user asked for is not there, say so. Do not pick another one unasked.",
  "`delegate` runs the task to its end and returns the other agent's final message. The other agent works in the same folder, and sees only the task you write, not this conversation. So write a task that stands on its own: the goal, the files that matter, and what to report back.",
].join("\n")

export const LIST_AGENTS: Tool = {
  name: "list_agents",
  description: "Lists the coding agents Desk can hand a task to, whether each is ready, and each one's models and effort levels. Call it once before the first `delegate`.",
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

/** A task in a few words: the start of its first line. */
export const firstLine = (text: string) => text.trim().split("\n")[0]!.slice(0, 80)

/**
 * What a call of one of Desk's tools was given, in short, for its row in a thread: the agent and the
 * task's first words. Undefined for a tool that is not Desk's.
 */
export function deskToolSummary(tool: string, input: unknown): string | undefined {
  if (tool === LIST_AGENTS.name) return ""
  if (tool !== DELEGATE.name) return undefined
  const given = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  return `${String(given.agent ?? "another agent")}: ${firstLine(typeof given.title === "string" && given.title.trim() ? given.title : String(given.task ?? ""))}`
}

/** A call of one of Desk's tools in a few words, from its summary, whichever agent made it. */
export function deskToolLabel(tool: string, summary: string, done: boolean): string {
  if (tool === LIST_AGENTS.name) return done ? "Listed the agents" : "Listing the agents"
  return `${done ? "Handed a task to" : "Handing a task to"} ${summary}`
}
