import { firstLine } from "../../text"
import { THREAD_LIMIT, type AgentThreads, type Rewound } from "../agent"
import { historyItems, messageId } from "./history"
import type { CodexThread } from "./protocol"
import type { AppServer } from "./server"

/** The conversations Codex saved, which it keeps in `~/.codex` and lists by project folder. */
export function codexThreads(server: AppServer): AgentThreads {
  const read = async (threadId: string) => (await server.request<{ thread: CodexThread }>("thread/read", { threadId, includeTurns: true })).thread

  /** The turn a user message opened. Codex keeps the id Desk gave the message, so Desk finds its turn by it. */
  const turnOf = async (threadId: string, message: string) => {
    const turns = (await read(threadId)).turns
    const index = turns.findIndex((turn) => turn.items.some((item) => item.type === "userMessage" && messageId(item) === message))
    if (index < 0) throw new Error("Codex has no such message in the thread.")
    return { turns, index }
  }

  return {
    async list(dir) {
      const listed = await server.request<{ data: CodexThread[] }>("thread/list", { cwd: dir, limit: THREAD_LIMIT, sortKey: "updated_at" }).catch(() => ({ data: [] }))
      return listed.data.map((thread) => ({
        id: thread.id,
        title: thread.name ?? firstLine(thread.preview),
        ...(thread.gitInfo?.branch ? { branch: thread.gitInfo.branch } : {}),
        updatedAt: thread.updatedAt * 1000,
      }))
    },

    history: async (dir, threadId) => historyItems(dir, (await read(threadId)).turns),

    /** Codex reports how full the context is only during a turn, so a thread at rest has no reading until its next reply. */
    context: async () => undefined,

    rename: async (_dir, threadId, title) => void (await server.request("thread/name/set", { threadId, name: title })),

    /** Codex copies the thread through the turn of `messageId`, which it keeps. */
    async fork(_dir, threadId, { title, messageId: message }) {
      const lastTurnId = message ? await turnOf(threadId, message).then(({ turns, index }) => turns[index]!.id) : undefined
      const { thread } = await server.request<{ thread: { id: string } }>("thread/fork", { threadId, ...(lastTurnId ? { lastTurnId } : {}), excludeTurns: true })
      await server.request("thread/name/set", { threadId: thread.id, name: title })
      return thread.id
    },

    delete: async (_dir, threadId) => void (await server.request("thread/delete", { threadId })),

    /**
     * Codex cuts the thread before the turn of `messageId` at once, so the session resumes at the end. Codex
     * reverts only a thread it has loaded, so the thread is resumed first. A rewind to the first message
     * leaves nothing, so the thread is left as it is and the tab starts a new one.
     */
    async rewind(dir, threadId, message): Promise<Rewound> {
      const { turns, index } = await turnOf(threadId, message)
      if (index === 0) return { empty: true }
      await server.request("thread/resume", { threadId, cwd: dir, excludeTurns: true })
      await server.request("thread/revert", { threadId, beforeTurnId: turns[index]!.id })
      return { empty: false }
    },
  }
}
