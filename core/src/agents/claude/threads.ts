import { deleteSession, forkSession, getSessionMessages, listSessions, renameSession } from "@anthropic-ai/claude-agent-sdk"
import { THREAD_LIMIT, type AgentThreads, type Rewound } from "../agent"
import { readContext } from "./context"
import { probe } from "./probe"
import { ThreadMapper } from "./thread"
import { Transcript } from "./transcript"

/** The conversations Claude Code saved, which it keeps as one transcript per session under the project. */
export const claudeThreads: AgentThreads = {
  async list(dir) {
    // Listing reads only each transcript's head and tail.
    const sessions = await listSessions({ dir, limit: THREAD_LIMIT }).catch(() => [])
    return sessions.map((session) => ({
      id: session.sessionId,
      title: session.summary,
      ...(session.gitBranch ? { branch: session.gitBranch } : {}),
      updatedAt: session.lastModified,
    }))
  },

  // System messages mark where Claude Code compacted the thread.
  async history(dir, threadId) {
    return new ThreadMapper(dir).history(await getSessionMessages(threadId, { dir, includeSystemMessages: true }))
  },

  /**
   * Read by loading the thread in a probe. The probe starts no MCP servers, so their tool definitions are
   * missing from this reading. The next reply's reading replaces it.
   */
  context: (dir, threadId) => probe(dir, readContext, { thread: threadId }),

  /** Claude Code keeps the name in the transcript, so `claude --resume` shows it too. */
  rename: (dir, threadId, title) => renameSession(threadId, title, { dir }),

  async fork(dir, threadId, { title, messageId }) {
    const end = messageId ? (await Transcript.read(dir, threadId)).turnEnd(messageId) : undefined
    return (await forkSession(threadId, { dir, title, ...(end ? { upToMessageId: end } : {}) })).sessionId
  },

  delete: (dir, threadId) => deleteSession(threadId, { dir }),

  /** The transcript keeps the rewound messages until the next turn runs, so the session resumes at the last message it keeps. */
  async rewind(dir, threadId, messageId): Promise<Rewound> {
    const resumeAt = (await Transcript.read(dir, threadId)).before(messageId)
    return resumeAt ? { empty: false, resumeAt } : { empty: true }
  },
}
