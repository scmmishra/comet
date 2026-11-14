import { REVIEW_SCOPES, type ClientMessage, type CoreMessage, type ProjectPart, type ProjectParts } from "@desk/protocol"
import { Agents } from "./agents/registry"
import { discoverCommands } from "./command-sources"
import { Commands } from "./commands"
import { Delegations } from "./delegate/delegations"
import { serveMcp } from "./delegate/mcp"
import { Clients } from "./clients"
import { errorMessage } from "./errors"
import { openableFile, openInEditor, readForView } from "./files"
import { checkImages } from "./images"
import { startPlugins } from "./plugins"
import { searchFiles } from "./project-files"
import { findIconFiles, iconFile } from "./project-icons"
import { isProjectFolder, requireProjectFolder } from "./project-path"
import { loadSettings, saveSettings, updateSettings } from "./settings"
import { readSpace } from "./space"
import { Window } from "./window"

type Send = (message: CoreMessage) => void

/** Where agents reach Desk's own tools, over MCP. */
const MCP_PATH = "/mcp"

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
  const clients = new Clients()
  const broadcast = clients.broadcast
  const project = <K extends ProjectPart>(dir: string, part: K, value: ProjectParts[K]) => ({ type: "project", project: dir, part, value }) as CoreMessage

  let settings = loadSettings()
  const agents = new Agents(broadcast, { compactIdle: () => settings.threads.compactIdle })
  const report = (error: unknown) => broadcast({ type: "error", message: errorMessage(error) })
  // An agent reaches Desk's tools at the server's own port, which is known once it listens.
  let toolsUrl = ""
  const delegations = new Delegations(agents, () => toolsUrl)
  const window = new Window({
    broadcast,
    agents,
    delegations,
    tabClosed: (tabId) => {
      clients.forget(tabId)
      ui.dropTab(tabId)
    },
    turnEnded: (tabId, threadKey, outcome) => plugins.turnEnded(tabId, threadKey, outcome),
    // Every client shows the project's branch and changes, so each reads the Space card again.
    spaceStale: (dir) => void Promise.resolve(read(dir, "space", broadcast)).catch(report),
    threadShown: (tabId, threadKey) => plugins.threadShown(tabId, threadKey),
  })
  const ui = startPlugins({ broadcast, openThread: (tabId, thread) => void window.openKey(tabId, thread).catch(report), store: window, report })
  const { plugins, layouts } = ui
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

  const requireFile = (dir: string, path: string) => {
    const file = openableFile(dir, path)
    if (!file) throw new Error(`Desk can only open a file that exists: ${path}`)
    return file
  }

  /** How each part of a project is read. Each answers the client that asked. */
  const readers: { [K in ProjectPart]: (dir: string, reply: (value: ProjectParts[K]) => void) => unknown } = {
    space: (dir, reply) => readSpace(dir).then(reply),
    commands: (dir, reply) => reply(commandsOf(dir).list()),
    commandSources: (dir, reply) => discoverCommands(dir, new Set(commandsOf(dir).list().map((command) => command.command))).then(reply),
    threads: (dir, reply) => window.recentThreads(dir).then(reply),
    icons: (dir, reply) => findIconFiles(dir).then(reply),
    skills: (dir, reply) => agents.commands(dir).then(reply),
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
      case "mcp.get":
        return agents.mcp(message.agent).read(message.project, (servers) => reply({ type: "mcp", project: message.project, agent: message.agent, servers }))
      case "mcp.toggle":
        return agents.mcp(message.agent).toggle(message.project, message.name, message.enabled, (servers) => reply({ type: "mcp", project: message.project, agent: message.agent, servers }))
      case "file.open":
        return openInEditor(requireFile(message.project, message.path), message.line)
      case "file.read":
        return reply({ type: "file", project: message.project, path: message.path, file: readForView(requireFile(message.project, message.path)) })
      case "commands.save":
        return commandsOf(message.project).save(message.name, message.processes, message.replacing)
      case "commands.remove":
        return commandsOf(message.project).remove(message.ids)
      case "commands.run":
        return commandsOf(message.project).run(message.ids)
      case "commands.stop":
        return commandsOf(message.project).stop(message.ids)
      case "agents.get":
        return agents.send(reply)
      case "usage.get":
        return agents.refreshUsage()
      case "agent.update":
        return agents.run(message.agent, "update")
      case "agent.install":
        return agents.run(message.agent, "install")
      case "agent.signIn":
        return agents.run(message.agent, "signIn")
      case "agent.cancel":
        return agents.cancel(message.agent)
      case "tabs.save":
        window.save(message.tabs, message.active)
        return layouts.sendVisible()
      case "window.focus":
        return layouts.windowFocus(message.focused)
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
      case "thread.rename":
        return window.renameThread(message.tabId, message.title)
      case "thread.fork":
        return window.forkThread(message.tabId, reply, message.messageId)
      case "thread.rewind":
        return window.rewindThread(message.tabId, message.messageId, message.restoreFiles)
      case "thread.delete":
        return window.deleteThread(message.tabId)
      case "session.interrupt":
        return window.interrupt(message.tabId)
      case "session.forceStop":
        return window.forceStop(message.tabId)
      case "branch.restore":
        // Every client shows the project's branch, so each reads the Space card again.
        return read(await window.restoreBranch(message.tabId), "space", broadcast)
      case "tasks.stop":
        return window.stopTasks(message.tabId, message.ids)
      case "permission.answer":
        return window.answerPermission(message.tabId, message.requestId, message.answer)
      case "question.answer":
        return window.answerQuestion(message.tabId, message.requestId, message.answers)
      case "thread.resume":
        return window.resume(message.tabId, message.agent, message.threadId, reply)
      case "review.get":
        if (!REVIEW_SCOPES.includes(message.scope)) throw new Error(`Review has no scope called “${message.scope}”.`)
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
      case "plugins.reload":
        return ui.reload()
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
      // An agent's session calls Desk's tools here, under the token Desk gave that session. A call runs
      // another agent's whole task, so it may stay open far longer than Bun lets an idle request.
      if (url.pathname === MCP_PATH) {
        server.timeout(request, 0)
        return serveMcp(request, (authorization) => delegations.toolsFor(authorization))
      }
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
        const reply = clients.replyTo(ws)
        reply({ type: "settings", settings })
        plugins.resend()
        void window.greet(reply)
      },
      close(ws) {
        clients.remove(ws)
      },
      message(ws, raw) {
        const reply = clients.replyTo(ws)
        let message: ClientMessage
        try {
          message = JSON.parse(String(raw))
        } catch {
          return reply({ type: "error", message: "The message is not valid JSON." })
        }
        handle(message, reply).catch((error) => reply({ type: "error", message: errorMessage(error) }))
      },
    },
  })

  toolsUrl = `http://127.0.0.1:${server.port}${MCP_PATH}`

  return {
    port: server.port!,
    stop() {
      window.stop()
      agents.close()
      plugins.stop()
      for (const found of commands.values()) found.stopAll()
      server.stop(true)
    },
  }
}
