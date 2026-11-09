import { PROTOCOL_VERSION, type ClientMessage, type CoreMessage, type ModelOption, type PlanUsage, type ThreadEvent } from "@desk/protocol"
import type { ServerWebSocket } from "bun"
import pkg from "../package.json"
import { discoverCommands } from "./command-sources"
import { sameRunSettings, Session } from "./session"
import { loadSettings, saveSettings, updateSettings } from "./settings"
import { isProjectFolder, Spaces } from "./spaces"
import { loadWindowState, saveWindowState, type SavedTab, type WindowState } from "./window-state"
import { openInEditor, resolveSpaceFile } from "./files"
import { readSpace } from "./space"
import { changesSince, snapshot } from "./checkpoints"
import { recentThreads, threadContext, threadHistory } from "./past-threads"
import { applyRateLimit, probeUsage } from "./usage"
import { probeModels } from "./models"

const USAGE_PROBE_INTERVAL_MS = 60_000

export interface CoreServer {
  readonly port: number
  stop(): void
}

export interface CoreOptions {
  readonly token: string
  /** The folder a new tab opens in when the window has none. Model and usage reads also run here. */
  readonly dir: string
}

/**
 * Starts the core's WebSocket server on loopback. Only a client that presents the token may connect,
 * because any local process can reach a loopback port. One core serves every project the window's
 * tabs work in.
 */
export function startCore({ token, dir }: CoreOptions): CoreServer {
  const clients = new Set<ServerWebSocket>()
  // Claude sessions, keyed by tab. Each runs in its tab's project.
  const sessions = new Map<string, Session>()
  const spaces = new Spaces({
    terminalOutput: (id, data) => broadcast({ type: "terminal.output", id, data }),
    terminalExit: (id, code) => broadcast({ type: "terminal.exit", id, code }),
    commandsChanged: (project, commands) => broadcast({ type: "commands", project, commands }),
  })
  let saved = loadWindowState(dir)
  let settings = loadSettings()
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
  // The model list rarely changes, so it is read once, on the first ask. A failed read is tried again on the next.
  let models: readonly ModelOption[] | undefined
  let probingModels = false
  const sendModels = (ws: ServerWebSocket) => {
    if (models) send(ws, { type: "models", models })
    if (models || probingModels) return
    probingModels = true
    void probeModels(dir, (found) => {
      models = found
      broadcast({ type: "models", models })
    }).finally(() => (probingModels = false))
  }
  const persist = (next: WindowState) => {
    saved = next
    saveWindowState(saved)
  }
  const savedTab = (tabId: string) => saved.tabs.find((tab) => tab.id === tabId)
  const updateTab = (tabId: string, change: Partial<SavedTab>) =>
    persist({ ...saved, tabs: saved.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...change } : tab)) })
  const broadcast = (message: CoreMessage) => {
    const data = JSON.stringify(message)
    for (const client of clients) client.send(data)
  }
  // A thread with no context reading gets one now, so its ring shows before its next reply.
  const fillContext = (tabId: string, threadId: string) => {
    const project = savedTab(tabId)?.project
    if (!project) return
    void threadContext(project, threadId).then((context) => {
      // The tab may have moved to another thread, or taken a live reading, while the probe ran.
      const tab = savedTab(tabId)
      if (!context || tab?.sessionId !== threadId || tab.context) return
      updateTab(tabId, { context })
      broadcast({ type: "session.event", sessionId: tabId, event: { kind: "context", ...context } })
    })
  }

  const closeSession = (tabId: string) => {
    sessions.get(tabId)?.close()
    sessions.delete(tabId)
  }

  const session = (tab: SavedTab) => {
    let found = sessions.get(tab.id)
    if (!found) {
      const emit = (event: ThreadEvent) => {
        if (event.kind === "context") updateTab(tab.id, { context: { percent: event.percent, tokens: event.tokens, maxTokens: event.maxTokens } })
        broadcast({ type: "session.event", sessionId: tab.id, event })
      }
      found = new Session(tab.project, emit, {
        resume: tab.sessionId,
        settings: tab,
        onSessionId: (sessionId) => updateTab(tab.id, { sessionId }),
        onRateLimit: (info) => {
          usage = applyRateLimit(usage, info)
          broadcast({ type: "usage", usage })
        },
      })
      sessions.set(tab.id, found)
    }
    return found
  }

  /** A thread's first message snapshots the project first, so Review can show what the thread changed. */
  const startTurn = async (tabId: string, text: string) => {
    const tab = savedTab(tabId)
    if (!tab) throw new Error("Desk could not find the tab to send the message from.")
    if (!tab.baseline) {
      const baseline = await snapshot(tab.project)
      if (baseline) updateTab(tabId, { baseline })
    }
    session(savedTab(tabId)!).send(text)
  }

  /** Each project's shells are the terminals its tabs list. Any other shell ends. */
  const retainTerminals = () => {
    for (const space of spaces.all()) {
      space.terminals.retain(new Set(saved.tabs.filter((tab) => tab.project === space.dir).flatMap((tab) => tab.terminals.map((terminal) => terminal.id))))
    }
  }

  const handle = (ws: ServerWebSocket, message: ClientMessage) => {
    switch (message.type) {
      case "ping":
        return send(ws, { type: "pong", id: message.id })
      case "settings.get":
        return send(ws, { type: "settings", settings })
      case "settings.update":
        settings = updateSettings(settings, message)
        saveSettings(settings)
        return broadcast({ type: "settings", settings })
      case "file.open": {
        const file = resolveSpaceFile(message.project, message.path)
        if (!file) return send(ws, { type: "error", message: `Desk can only open files inside the project: ${message.path}` })
        return openInEditor(file, message.line)
      }
      case "tabs.save": {
        const bad = message.tabs.find((tab) => !isProjectFolder(tab.project))
        if (bad) return send(ws, { type: "error", message: `Desk cannot open ${bad.project}: it is not a folder.` })
        // The app owns order, titles, projects, panel terminals and run settings. The core keeps each tab's Claude session.
        const before = new Map(saved.tabs.map((tab) => [tab.id, tab]))
        persist({
          tabs: message.tabs.map((tab) => {
            const { sessionId, context, baseline } = before.get(tab.id) ?? {}
            return { ...tab, sessionId, context, baseline }
          }),
          active: message.active,
        })
        for (const tab of message.tabs) {
          const old = before.get(tab.id)
          // A tab that moved to another project starts its session there. Only a tab with no thread can move.
          if (old && old.project !== tab.project) closeSession(tab.id)
          // Changed run settings apply to a running thread from its next reply.
          else if (!old || !sameRunSettings(old, tab))
            sessions.get(tab.id)?.configure(tab).catch((error) => send(ws, { type: "error", message: `Desk could not change how the thread runs: ${error instanceof Error ? error.message : error}` }))
        }
        // A closed tab or panel terminal drops out of the list, so its shell ends here.
        return retainTerminals()
      }
      case "terminal.open": {
        // A new terminal starts in the project of the tab that lists it.
        const project = saved.tabs.find((tab) => tab.terminals.some((terminal) => terminal.id === message.id))?.project
        const space = spaces.withTerminal(message.id) ?? (project ? spaces.get(project) : undefined)
        if (!space) return send(ws, { type: "error", message: "Desk could not find the tab this terminal belongs to." })
        return space.terminals.open(message.id, message.cols, message.rows)
      }
      case "terminal.input":
        return spaces.withTerminal(message.id)?.terminals.input(message.id, message.data)
      case "terminal.resize":
        return spaces.withTerminal(message.id)?.terminals.resize(message.id, message.cols, message.rows)
      case "commands.get":
        return send(ws, { type: "commands", project: message.project, commands: spaces.get(message.project).commands.list() })
      case "commands.discover":
        return void discoverCommands(message.project).then((sources) => send(ws, { type: "commands.found", project: message.project, sources }))
      case "commands.save":
        return spaces.get(message.project).commands.save(message.name, message.processes, message.replacing)
      case "commands.remove":
        return spaces.get(message.project).commands.remove(message.ids)
      case "command.run":
        return spaces.get(message.project).commands.run(message.id)
      case "command.stop":
        return spaces.get(message.project).commands.stop(message.id)
      case "group.run":
        return spaces.get(message.project).commands.runGroup(message.group)
      case "group.stop":
        return spaces.get(message.project).commands.stopGroup(message.group)
      case "models.get":
        return sendModels(ws)
      case "usage.get":
        return void refreshUsage()
      case "space.get":
        return void readSpace(message.project).then((space) => send(ws, { type: "space", project: message.project, space }))
      case "session.send":
        return void startTurn(message.sessionId, message.text).catch((error) => send(ws, { type: "error", message: error instanceof Error ? error.message : String(error) }))
      case "review.get": {
        const tab = savedTab(message.sessionId)
        if (!tab?.baseline) return send(ws, { type: "review", sessionId: message.sessionId, files: [] })
        return void changesSince(tab.project, tab.baseline).then((files) => send(ws, { type: "review", sessionId: message.sessionId, files }))
      }
      case "session.interrupt":
        return void sessions.get(message.sessionId)?.interrupt()
      case "threads.get": {
        const tabs = new Map(saved.tabs.flatMap((tab) => (tab.sessionId && tab.project === message.project ? [[tab.sessionId, tab.id] as const] : [])))
        return void recentThreads(message.project, tabs).then((threads) => send(ws, { type: "threads", project: message.project, threads }))
      }
      case "thread.resume": {
        // The tab may hold a session that never sent a message. The resumed thread replaces it.
        closeSession(message.sessionId)
        updateTab(message.sessionId, { sessionId: message.threadId, baseline: undefined, context: undefined })
        const tab = savedTab(message.sessionId)
        if (!tab) return send(ws, { type: "error", message: "Desk could not find the tab to resume the thread in." })
        fillContext(tab.id, message.threadId)
        return void threadHistory(tab.project, tab).then((events) => send(ws, { type: "session.history", sessionId: tab.id, events }))
      }
      case "session.close":
        return closeSession(message.sessionId)
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
        send(ws, { type: "hello", protocol: PROTOCOL_VERSION, core: pkg.version, bun: Bun.version, project: dir })
        send(ws, { type: "settings", settings })
        void sendSavedTabs(ws, saved)
        for (const tab of saved.tabs) if (tab.sessionId && !tab.context) fillContext(tab.id, tab.sessionId)
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
        // A project the app names may not be a folder, and a command draft may be incomplete. Both report back.
        try {
          handle(ws, message)
        } catch (error) {
          send(ws, { type: "error", message: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  })

  return {
    port: server.port!,
    stop() {
      for (const found of sessions.values()) found.close()
      spaces.stop()
      server.stop(true)
    },
  }
}

/** Sends the saved tabs, then each tab's conversation read back from Claude's transcript. */
async function sendSavedTabs(ws: ServerWebSocket, saved: WindowState) {
  send(ws, {
    type: "tabs",
    tabs: saved.tabs.map(({ id, title, project, terminals, panelActive, model, effort, fast, permissionMode }) => ({ id, title, project, terminals, panelActive, model, effort, fast, permissionMode })),
    active: saved.active,
  })
  for (const tab of saved.tabs) {
    if (tab.sessionId) send(ws, { type: "session.history", sessionId: tab.id, events: await threadHistory(tab.project, tab) })
  }
}

function send(ws: ServerWebSocket, message: CoreMessage) {
  ws.send(JSON.stringify(message))
}
