import { firstLine, textStart } from "../text"
import { SERVER_NAME } from "../tools/mcp"
import type { CometTool } from "../tools/tool"

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

export const LIST_AGENTS: CometTool = {
  name: "list_agents",
  description: "Lists the coding agents Comet can hand a task to, whether each is ready, and each one's models and effort levels. Call it once before the first `delegate`.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  summary: () => "",
  label: (_, done) => (done ? "Listed the agents" : "Listing the agents"),
}

export const DELEGATE: CometTool = {
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
  // The agent and the task's first words.
  summary: (input) => `${String(input.agent ?? "another agent")}: ${taskWords(typeof input.title === "string" && input.title.trim() ? input.title : String(input.task ?? ""))}`,
  label: (summary, done) => `${done ? "Handed a task to" : "Handing a task to"} ${summary}`,
}

/** A task in a few words: the start of its first line. */
export const taskWords = (text: string) => textStart(firstLine(text), 80)
