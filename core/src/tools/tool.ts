import type { Tool, ToolResult } from "./mcp"

/** One of Comet's tools: what MCP lists, and how its call reads as a row in a thread, whichever agent made it. */
export interface CometTool extends Tool {
  /** What a call was given, in short, such as the file it opens. */
  summary(input: Record<string, unknown>): string
  /** A call in a few words, from its summary. `done` says the call has answered. */
  label(summary: string, done: boolean): string
}

/** The tools one feature offers one session: what the model is told about them, and how a call runs. */
export interface ToolGroup {
  readonly instructions: string
  readonly tools: readonly CometTool[]
  /** Runs a call of one of `tools`. `signal` aborts when the agent gives up on the call. */
  call(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>
}

/** The input a call names a field of, as a record, whatever the agent sent. */
export const given = (input: unknown): Record<string, unknown> => (typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {})
