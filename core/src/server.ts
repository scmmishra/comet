import { PROTOCOL_VERSION, type ClientMessage, type CoreMessage, type PlanUsage, type ThreadEvent } from "@desk/protocol"
import type { ServerWebSocket } from "bun"
import pkg from "../package.json"
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk"
import { Session } from "./session"
import { loadSpaceState, saveSpaceState, type SavedTab, type SpaceState } from "./space-state"
import { openInEditor, resolveSpaceFile } from "./files"
import { readSpace } from "./space"
import { changesSince, snapshot } from "./checkpoints"
import { Terminals } from "./terminals"
import { historyEvents } from "./thread"
import { applyRateLimit, probeUsage } from "./usage"

const USAGE_PROBE_INTERVAL_MS = 60_000

export interface CoreServer {
  readonly port: number
  stop(): void
}

export interface CoreOptions {
  readonly token: string
  /** The repo the window shows. Sessions run here. */
  readonly dir: string
}

/**
 * Starts the core's WebSocket server on loopback. Only a client that presents the token may connect,
 * because any local process can reach a loopback port.
 */
export function startCore({ token, dir }: CoreOptions): CoreServer {
  const clients = new Set<ServerWebSocket>()
  const sessions = new Map<string, Session>()
  const terminals = new Terminals(dir, {
    output: (id, data) => broadcast({ type: "terminal.output", id, data }),
    exit: (id, code) => broadcast({ type: "terminal.exit", id, code }),
  })
  let saved = loadSpaceState(dir)
  // Plan usage: probed at most once a minute, and kept current by sessions' rate-limit events.
  let usage: PlanUsage | undefined
  let probedAt = 0
  const refreshUsage = async () => {
    if (Date.now() - probedAt >= USAGE_PROBE_INTERVAL_MS) {
      probedAt = Date.now()
      usage = (await probeUsage(dir)) ?? usage
    }
    broadcast({ type: "usage", usage })
  }
  const persist = (next: SpaceState) => {
    saved = next
    saveSpaceState(dir, saved)
  }
  const updateTab = (tabId: string, change: Partial<SavedTab>) =>
    persist({ ...saved, tabs: saved.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...change } : tab)) })
  const broadcast = (message: CoreMessage) => {
    const data = JSON.stringify(message)
    for (const client of clients) client.send(data)
  }

  const session = (id: string) => {
    let found = sessions.get(id)
    if (!found) {
      const emit = (event: ThreadEvent) => {
        if (event.kind === "context") updateTab(id, { context: { percent: event.percent, tokens: event.tokens, maxTokens: event.maxTokens } })
        broadcast({ type: "session.event", sessionId: id, event })
      }
      found = new Session(dir, emit, {
        resume: saved.tabs.find((tab) => tab.id === id)?.sessionId,
        onSessionId: (sessionId) => updateTab(id, { sessionId }),
        onRateLimit: (info) => {
          usage = applyRateLimit(usage, info)
          broadcast({ type: "usage", usage })
        },
      })
      sessions.set(id, found)
    }
    return found
  }

  /** A thread's first message snapshots the repo first, so Review can show what the thread changed. */
  const startTurn = async (tabId: string, text: string) => {
    if (!saved.tabs.find((tab) => tab.id === tabId)?.baseline) {
      const baseline = await snapshot(dir)
      if (baseline) updateTab(tabId, { baseline })
    }
    session(tabId).send(text)
  }

  const handle = (ws: ServerWebSocket, message: ClientMessage) => {
    switch (message.type) {
      case "ping":
        return send(ws, { type: "pong", id: message.id })
      case "file.open": {
        const file = resolveSpaceFile(dir, message.path)
        if (!file) return send(ws, { type: "error", message: `Desk can only open files inside the space: ${message.path}` })
        return openInEditor(file, message.line)
      }
      case "tabs.save":
        // The app owns order, titles and panel terminals. The core keeps each tab's Claude session.
        persist({
          tabs: message.tabs.map((tab) => {
            const { sessionId, context, baseline } = saved.tabs.find((found) => found.id === tab.id) ?? {}
            return { ...tab, sessionId, context, baseline }
          }),
          active: message.active,
        })
        // A closed tab or panel terminal drops out of the list, so its shell ends here.
        return terminals.retain(new Set(message.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.id))))
      case "terminal.open":
        return terminals.open(message.id, message.cols, message.rows)
      case "terminal.input":
        return terminals.input(message.id, message.data)
      case "terminal.resize":
        return terminals.resize(message.id, message.cols, message.rows)
      case "usage.get":
        return void refreshUsage()
      case "space.get":
        return void readSpace(dir).then((space) => send(ws, { type: "space", space }))
      case "session.send":
        return void startTurn(message.sessionId, message.text)
      case "review.get": {
        const baseline = saved.tabs.find((tab) => tab.id === message.sessionId)?.baseline
        if (!baseline) return send(ws, { type: "review", sessionId: message.sessionId, files: [] })
        return void changesSince(dir, baseline).then((files) => send(ws, { type: "review", sessionId: message.sessionId, files }))
      }
      case "session.interrupt":
        return void sessions.get(message.sessionId)?.interrupt()
      case "session.close":
        sessions.get(message.sessionId)?.close()
        return void sessions.delete(message.sessionId)
      case "permission.answer":
        return sessions.get(message.sessionId)?.answerPermission(message.id, message.allow)
      default:
        return send(ws, { type: "error", message: `Unknown message type: ${(message as { type: unknown }).type}` })
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.searchParams.get("token") !== token) return new Response("Forbidden", { status: 403 })
      if (server.upgrade(request)) return undefined
      return new Response("Expected a WebSocket", { status: 426 })
    },
    websocket: {
      open(ws) {
        clients.add(ws)
        send(ws, { type: "hello", protocol: PROTOCOL_VERSION, core: pkg.version, bun: Bun.version })
        void sendSavedTabs(ws, dir, saved)
      },
      close(ws) {
        clients.delete(ws)
      },
      message(ws, raw) {
        let message: ClientMessage
        try {
          message = JSON.parse(String(raw))
        } catch {
          return send(ws, { type: "error", message: "The message is not valid JSON." })
        }
        handle(ws, message)
      },
    },
  })

  return {
    port: server.port!,
    stop() {
      for (const found of sessions.values()) found.close()
      terminals.closeAll()
      server.stop(true)
    },
  }
}

/** Sends the saved tabs, then each tab's conversation read back from Claude's transcript. */
async function sendSavedTabs(ws: ServerWebSocket, dir: string, saved: SpaceState) {
  send(ws, { type: "tabs", tabs: saved.tabs.map(({ id, title, terminals, panelActive }) => ({ id, title, terminals, panelActive })), active: saved.active })
  for (const tab of saved.tabs) {
    if (!tab.sessionId) continue
    const messages = await getSessionMessages(tab.sessionId, { dir }).catch(() => [])
    const events: ThreadEvent[] = historyEvents(messages)
    if (tab.context) events.push({ kind: "context", ...tab.context })
    send(ws, { type: "session.history", sessionId: tab.id, events })
  }
}

function send(ws: ServerWebSocket, message: CoreMessage) {
  ws.send(JSON.stringify(message))
}
