import type { Query } from "@anthropic-ai/claude-agent-sdk"
import type { ContextReading } from "@desk/protocol"

/** How full a running query's context is. "summary" answers from the last response, without asking the API to count tokens. */
export async function readContext(running: Query): Promise<ContextReading> {
  const usage = await running.getContextUsage({ detail: "summary" })
  return { percent: usage.percentage, tokens: usage.totalTokens, maxTokens: usage.maxTokens }
}
