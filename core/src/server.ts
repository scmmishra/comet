import type { ClientMessage, CoreMessage, ProjectPart, ProjectParts } from "@desk/protocol"
import type { ServerWebSocket } from "bun"
import { discoverCommands } from "./command-sources"
import { Commands } from "./commands"
import { openInEditor, projectFile } from "./files"
import { checkImages } from "./images"
import { readMcpServers, toggleMcpServer } from "./mcp"
import { Models } from "./models"
import { recentThreads } from "./past-threads"
import { Layouts } from "./plugins/layouts"
import { Plugins } from "./plugins/plugins"
import { searchFiles } from "./project-files"
import { findIconFiles, iconFile } from "./project-icons"
import { isProjectFolder, requireProjectFolder } from "./project-path"
import { loadSettings, saveSettings, updateSettings } from "./settings"
import { readSkills } from "./skills"
import { readSpace } from "./space"
import { Usage } from "./usage"
import { Window } from "./window"

type Send = (message: CoreMessage) => void

export interface CoreServer {
  readonly port: number
  stop(): void
}

/**
 * Starts the core's WebSocket server on loopback. Only a client that presents the token may connect,
 * because any local process can reach a loopback port. One core serves every project the window's
 * tabs work in.
 */
export function startCore({ token }: { readonly token: string }): CoreServer {
  const clients = new Set<ServerWebSocket>()
  const broadcast: Send = (message) => {
    const data = JSON.stringify(message)
    for (const client of clients) client.send(data)
  }
  const project = <K extends ProjectPart>(dir: string, part: K, value: ProjectParts[K]) => ({ type: "project", project: dir, part, value }) as CoreMessage

  let settings = loadSettings()
  const models = new Models(broadcast)
  const usage = new Usage(broadcast)
  const report = (error: unknown) => broadcast({ type: "error", message: error instanceof Error ? error.message : String(error) })
  const plugins = new Plugins({
    broadcast,
    openThread: (tabId, thread) => void window.openKey(tabId, thread).catch(report),
    openPanel: (tabId, panel, params) => void layouts.openPanel(tabId, panel, params).catch(report),
    closePanel: (tabId, id) => void layouts.closePanel(tabId, id).catch(report),
    stopped: () => void layouts.resendAll().catch(report),
  })
  const window = new Window({
    broadcast,
    compactIdle: () => settings.claude.compactIdle,
    rateLimit: (info) => usage.rateLimit(info),
    tabClosed: (tabId) => {
      plugins.dropTab(tabId)
      layouts.dropTab(tabId)
    },
  })
  const layouts = new Layouts(plugins, window, broadcast)
  // Each project's commands, made the first time the project is named. They run as long as the core.
  const commands = new Map<string, Commands>()
  const commandsOf = (dir: string) => {
    let found = commands.get(dir)
    if (!found) {
      found = new Commands(dir, (list) => broadcast(project(dir, "commands", list)))
      commands.set(dir, found)
    }
    return found
  }

  /** How each part of a project is read. Each answers the client that asked. */
  const readers: { [K in ProjectPart]: (dir: string, reply: (value: ProjectParts[K]) => void) => unknown } = {
    space: (dir, reply) => readSpace(dir).then(reply),
    commands: (dir, reply) => reply(commandsOf(dir).list()),
    commandSources: (dir, reply) => discoverCommands(dir, new Set(commandsOf(dir).list().map((command) => command.command))).then(reply),
    threads: (dir, reply) => recentThreads(dir, window.openThreads(dir)).then(reply),
    icons: (dir, reply) => findIconFiles(dir).then(reply),
    mcp: (dir, reply) => readMcpServers(dir, reply),
    skills: (dir, reply) => readSkills(dir).then(reply),
    plugins: (dir, reply) => plugins.contributions(dir).then(reply),
  }
  const read = <K extends ProjectPart>(dir: string, part: K, reply: Send) => readers[part](dir, (value) => reply(project(dir, part, value)))

  /** Runs one message. A failure, sync or async, reaches the client as an error. */
  const handle = async (message: ClientMessage, reply: Send) => {
    // Every message about a project's data names its folder. It is checked here, once.
    if ("project" in message) requireProjectFolder(message.project)
    switch (message.type) {
      case "settings.update":
        settings = updateSettings(settings, message.change)
        saveSettings(settings)
        return broadcast({ type: "settings", settings })
      case "project.get":
        return read(message.project, message.part, reply)
      case "mcp.toggle":
        return toggleMcpServer(message.project, message.name, message.enabled, (servers) => reply(project(message.project, "mcp", servers)))
      case "file.open": {
        const file = projectFile(message.project, message.path)
        if (!file) throw new Error(`Desk can only open files inside the project: ${message.path}`)
        return openInEditor(file, message.line)
      }
      case "commands.save":
        return commandsOf(message.project).save(message.name, message.processes, message.replacing)
      case "commands.remove":
        return commandsOf(message.project).remove(message.ids)
      case "commands.run":
        return commandsOf(message.project).run(message.ids)
      case "commands.stop":
        return commandsOf(message.project).stop(message.ids)
      case "models.get":
        return models.get(reply)
      case "usage.get":
        return usage.refresh()
      case "tabs.save":
        return window.save(message.tabs, message.active)
      case "tab.reopen":
        return window.reopenTab(reply)
      case "session.send":
        return window.send(message.tabId, message.text, checkImages(message.images ?? []), message.followUp)
      case "queue.send":
        return window.sendQueued(message.tabId, message.id)
      case "queue.remove":
        return window.removeQueued(message.tabId, message.id)
      case "queue.resume":
        return window.resumeQueue(message.tabId)
      case "files.search":
        return reply({ type: "files.found", project: message.project, query: message.query, paths: await searchFiles(message.project, message.query) })
      case "setups.get":
        return reply({ type: "setups", setups: await plugins.setups(message.project) })
      case "thread.clear":
        return window.clearThread(message.tabId)
      case "session.interrupt":
        return window.interrupt(message.tabId)
      case "tasks.stop":
        return window.stopTasks(message.tabId, message.ids)
      case "permission.answer":
        return window.answerPermission(message.tabId, message.requestId, message.allow)
      case "thread.resume":
        return window.resume(message.tabId, message.threadId, reply)
      case "review.get":
        return reply({ type: "review", tabId: message.tabId, scope: message.scope, files: await window.review(message.tabId, message.scope) })
      case "layout.get":
        return layouts.send(message.tabId)
      case "panel.open":
        return layouts.openPanel(message.tabId, message.panel, message.params)
      case "panel.close":
        return layouts.closePanel(message.tabId, message.id)
      case "setup.open":
        return layouts.openSetup(message.tabId, message.setup)
      case "plugin.command":
        return plugins.command(message.tabId, window.projectOf(message.tabId), message.command, message.input)
      case "plugin.event":
        return plugins.event(message.plugin, message.handler, message.args)
      case "terminal.open":
        return window.openTerminal(message.id, message.cols, message.rows)
      case "terminal.input":
        return window.terminalInput(message.id, message.data)
      case "terminal.resize":
        return window.resizeTerminal(message.id, message.cols, message.rows)
      default:
        throw new Error(`Unknown message type: ${(message as { type: unknown }).type}`)
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.searchParams.get("token") !== token) return new Response("Forbidden", { status: 403 })
      // A project's icon, for its avatar. Only an image inside a project folder is served.
      if (url.pathname === "/project-icon") {
        const dir = url.searchParams.get("dir") ?? ""
        const icon = isProjectFolder(dir) ? iconFile(dir, url.searchParams.get("path") ?? "") : undefined
        return icon ? new Response(Bun.file(icon.path), { headers: { "content-type": icon.type, "cache-control": "no-cache" } }) : new Response("Not found", { status: 404 })
      }
      if (server.upgrade(request)) return undefined
      return new Response("Expected a WebSocket", { status: 426 })
    },
    websocket: {
      open(ws) {
        clients.add(ws)
        const reply: Send = (message) => ws.send(JSON.stringify(message))
        reply({ type: "settings", settings })
        plugins.resend()
        void window.greet(reply)
      },
      close(ws) {
        clients.delete(ws)
      },
      message(ws, raw) {
        const reply: Send = (message) => ws.send(JSON.stringify(message))
        let message: ClientMessage
        try {
          message = JSON.parse(String(raw))
        } catch {
          return reply({ type: "error", message: "The message is not valid JSON." })
        }
        handle(message, reply).catch((error) => reply({ type: "error", message: error instanceof Error ? error.message : String(error) }))
      },
    },
  })

  return {
    port: server.port!,
    stop() {
      window.stop()
      plugins.stop()
      for (const found of commands.values()) found.stopAll()
      server.stop(true)
    },
  }
}
