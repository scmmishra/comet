import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk"
import type { ContextReading, ThreadItem, ThreadSummary } from "@desk/protocol"
import { readContext } from "./context"
import { probe } from "./probe"
import { ThreadMapper } from "./thread"

/** Enough for thread search to reach back months. Listing reads only each transcript's head and tail. */
const THREAD_LIMIT = 200

/** A project's newest threads. `openIn` maps a Claude session id to the tab that has it open. A failed read gives none, because the list is a convenience. */
export async function recentThreads(dir: string, openIn: ReadonlyMap<string, string>): Promise<ThreadSummary[]> {
  const sessions = await listSessions({ dir, limit: THREAD_LIMIT }).catch(() => [])
  return sessions.map((session) => {
    const tabId = openIn.get(session.sessionId)
    return {
      id: session.sessionId,
      title: session.summary,
      ...(session.gitBranch ? { branch: session.gitBranch } : {}),
      updatedAt: session.lastModified,
      ...(tabId ? { tabId } : {}),
    }
  })
}

/** A thread read back from Claude's transcript. */
export async function threadHistory(dir: string, sessionId: string): Promise<ThreadItem[]> {
  // System messages mark where Claude Code compacted the thread.
  return new ThreadMapper(dir).history(await getSessionMessages(sessionId, { dir, includeSystemMessages: true }))
}

/**
 * How full a thread's context is, read by loading it in a probe. A thread resumed in Desk has no
 * reading until its next reply, so this fills the gap. The probe starts no MCP servers, so their
 * tool definitions are missing from this reading. The next reply's reading replaces it.
 */
export function threadContext(dir: string, threadId: string): Promise<ContextReading | undefined> {
  return probe(dir, readContext, { thread: threadId })
}
