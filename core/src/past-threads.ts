import { getSessionMessages, listSessions, type SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk"
import type { ThreadEvent, ThreadSummary } from "@desk/protocol"
import type { SavedTab } from "./space-state"
import { probe } from "./probe"
import { historyEvents } from "./thread"

/** Enough for thread search to reach back months. Listing reads only each transcript's head and tail. */
const THREAD_LIMIT = 200

/**
 * The space's newest threads. `tabs` maps a Claude session id to the tab that has it open. A failed
 * read gives none, because the list is a convenience.
 */
export async function recentThreads(dir: string, tabs: ReadonlyMap<string, string>): Promise<ThreadSummary[]> {
  return threadSummaries(await listSessions({ dir, limit: THREAD_LIMIT }).catch(() => []), tabs)
}

export function threadSummaries(sessions: readonly SDKSessionInfo[], tabs: ReadonlyMap<string, string>): ThreadSummary[] {
  return sessions.map((session) => {
    const tabId = tabs.get(session.sessionId)
    return {
      id: session.sessionId,
      title: session.summary,
      ...(session.gitBranch ? { branch: session.gitBranch } : {}),
      updatedAt: session.lastModified,
      ...(tabId ? { tabId } : {}),
    }
  })
}

/** A tab's thread read back from Claude's transcript, with the last context reading Desk saved. */
export async function threadHistory(dir: string, tab: SavedTab): Promise<ThreadEvent[]> {
  if (!tab.sessionId) return []
  const events = historyEvents(await getSessionMessages(tab.sessionId, { dir }).catch(() => []))
  if (tab.context) events.push({ kind: "context", ...tab.context })
  return events
}

/**
 * How full a thread's context is, read by loading it in a probe. A thread resumed in Desk has no
 * reading until its next reply, so this fills the gap. The probe starts no MCP servers, so their
 * tool definitions are missing from this reading. The next reply's reading replaces it.
 */
export async function threadContext(dir: string, threadId: string): Promise<SavedTab["context"]> {
  return probe(
    dir,
    async (running) => {
      const usage = await running.getContextUsage({ detail: "summary" })
      return { percent: usage.percentage, tokens: usage.totalTokens, maxTokens: usage.maxTokens }
    },
    threadId,
  )
}
