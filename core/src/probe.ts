import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"

const PROBE_TIMEOUT_MS = 20_000

/**
 * Asks Claude Code about the account the way T3 Code does: a query whose prompt never yields, so
 * nothing reaches the model. `read` runs once the query has started. A failure or a timeout gives
 * undefined, because what a probe reads is extra information.
 */
export async function probe<T>(dir: string, read: (running: Query) => Promise<T>): Promise<T | undefined> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS)
  try {
    const running = query({
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
      })(),
      // A probe must leave nothing behind: no saved session, no hooks run, no MCP servers started.
      options: { cwd: dir, abortController: abort, persistSession: false, settings: { disableAllHooks: true }, mcpServers: {}, strictMcpConfig: true },
    })
    await running.initializationResult()
    return await read(running)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    abort.abort()
  }
}
