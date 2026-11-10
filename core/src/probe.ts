import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { claudeCodePath } from "./claude-code"

const PROBE_TIMEOUT_MS = 20_000

interface ProbeOptions {
  /** A thread to load first, to read about it. */
  readonly thread?: string
  /** Starts the project's MCP servers, as a session would, to read or change them. Probes skip them otherwise. */
  readonly loadMcp?: boolean
}

/**
 * Asks Claude Code about the account the way T3 Code does: a query whose prompt never yields, so
 * nothing reaches the model. `read` runs once the query has started. A failure or a timeout gives
 * undefined, because what a probe reads is extra information.
 */
export async function probe<T>(dir: string, read: (running: Query) => Promise<T>, options: ProbeOptions = {}): Promise<T | undefined> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS)
  try {
    const running = query({
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
      })(),
      // A probe must leave nothing behind: no saved session, no hooks run, and no MCP servers started unless asked.
      // `resume` loads a thread to read about it. Without persistSession, nothing is written to it.
      options: {
        // The probe asks the same Claude Code the sessions run.
        pathToClaudeCodeExecutable: await claudeCodePath(),
        cwd: dir,
        abortController: abort,
        persistSession: false,
        settings: { disableAllHooks: true },
        ...(options.loadMcp ? {} : { mcpServers: {}, strictMcpConfig: true }),
        ...(options.thread ? { resume: options.thread } : {}),
      },
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
