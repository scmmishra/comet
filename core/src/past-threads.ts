import { getSessionMessages, listSessions, type SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk"
import type { ThreadEvent, ThreadSummary } from "@desk/protocol"
import type { SavedTab } from "./space-state"
import { historyEvents } from "./thread"

const RECENT_LIMIT = 20

/** The space's newest threads that no tab has open. A failed read gives none, because the list is a convenience. */
export async function recentThreads(dir: string, open: ReadonlySet<string>): Promise<ThreadSummary[]> {
  const sessions = await listSessions({ dir, limit: RECENT_LIMIT + open.size }).catch(() => [])
  return threadSummaries(sessions, open).slice(0, RECENT_LIMIT)
}

export function threadSummaries(sessions: readonly SDKSessionInfo[], open: ReadonlySet<string>): ThreadSummary[] {
  return sessions
    .filter((session) => !open.has(session.sessionId))
    .map((session) => ({
      id: session.sessionId,
      title: session.summary,
      ...(session.gitBranch ? { branch: session.gitBranch } : {}),
      updatedAt: session.lastModified,
    }))
}

/** A tab's thread read back from Claude's transcript, with the last context reading Desk saved. */
export async function threadHistory(dir: string, tab: SavedTab): Promise<ThreadEvent[]> {
  if (!tab.sessionId) return []
  const events = historyEvents(await getSessionMessages(tab.sessionId, { dir }).catch(() => []))
  if (tab.context) events.push({ kind: "context", ...tab.context })
  return events
}
