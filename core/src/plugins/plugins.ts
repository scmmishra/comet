import type { FromPlugin, ToPlugin } from "@desk/plugin/host"
import type { CoreMessage, UiValue } from "@desk/protocol"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { deskHome } from "../data-files"
import { loginShellPath } from "../shell"
import { bundlePlugin } from "./bundle"

type Send = (message: CoreMessage) => void

/** The files a plugin folder may start from. */
const ENTRIES = ["index.tsx", "index.ts"]

interface PluginHooks {
  readonly broadcast: Send
  /** A plugin asked to open a tab's thread for a key. */
  readonly openThread: (tabId: string, thread: { key: string; title?: string; prompt?: string }) => void
}

interface Running {
  readonly worker: Worker
  /** Answers to `open`, by tab and panel. */
  readonly opening: Map<string, (root: number) => void>
}

const pluginsFolder = () => join(deskHome(), "plugins")

/**
 * The plugins in `~/.desk/plugins`, each in a worker of its own, so a slow plugin never stalls a session
 * or a terminal. A plugin starts the first time a tab shows one of its panels, and stays up after.
 */
export class Plugins {
  private running = new Map<string, Promise<Running>>()

  constructor(private readonly hooks: PluginHooks) {}

  /** Draws `panel`, named `<plugin>.<panel>`, for a tab, and gives the node it starts at. */
  async open(tabId: string, project: string, panel: string): Promise<{ plugin: string; root: number }> {
    const dot = panel.indexOf(".")
    if (dot < 1) throw new Error(`A panel is named <plugin>.<panel>, not ${panel}.`)
    const plugin = panel.slice(0, dot)
    const name = panel.slice(dot + 1)
    const running = await this.start(plugin)
    const root = await new Promise<number>((resolve) => {
      running.opening.set(`${tabId}\n${name}`, resolve)
      this.post(running, { type: "open", tabId, project, panel: name })
    })
    return { plugin, root }
  }

  /** Runs a handler one of a plugin's nodes holds. */
  async event(plugin: string, handler: number, args: readonly UiValue[]) {
    const running = await this.running.get(plugin)
    if (!running) throw new Error(`The plugin ${plugin} is not running.`)
    this.post(running, { type: "event", handler, args })
  }

  /** A closed tab's panels and plugin state go. */
  dropTab(tabId: string) {
    for (const running of this.running.values()) void running.then((found) => this.post(found, { type: "drop", tabId }))
  }

  /** Sends every running plugin's whole UI again, for a client that just connected. */
  resend() {
    for (const running of this.running.values()) void running.then((found) => this.post(found, { type: "snapshot" }))
  }

  stop() {
    for (const running of this.running.values()) void running.then((found) => found.worker.terminate())
  }

  private start(plugin: string): Promise<Running> {
    let running = this.running.get(plugin)
    if (!running) {
      running = this.launch(plugin)
      this.running.set(plugin, running)
      // A plugin that fails to start is tried again the next time a panel asks for it.
      running.catch(() => this.running.delete(plugin))
    }
    return running
  }

  private async launch(plugin: string): Promise<Running> {
    const folder = join(pluginsFolder(), plugin)
    const entry = ENTRIES.map((file) => join(folder, file)).find(existsSync)
    if (!entry) throw new Error(`Desk found no plugin at ${folder}. A plugin starts from index.tsx.`)
    // The bundle starts from a small module that hands the plugin to the host, so both share one renderer.
    const hostEntry = join(deskHome(), "cache", "plugins", `${plugin}.entry.ts`)
    mkdirSync(join(hostEntry, ".."), { recursive: true })
    await Bun.write(hostEntry, `import { startHost } from "@desk/plugin/host"\nimport plugin from ${JSON.stringify(entry)}\nstartHost(plugin)\n`)
    const worker = new Worker(await bundlePlugin(plugin, hostEntry), { env: { ...process.env, PATH: await loginShellPath() } })
    const running: Running = { worker, opening: new Map() }
    worker.onmessage = (event: MessageEvent<FromPlugin>) => this.receive(plugin, running, event.data)
    worker.onerror = (event) => {
      this.running.delete(plugin)
      this.hooks.broadcast({ type: "error", message: `The ${plugin} plugin stopped: ${event.message}` })
    }
    return running
  }

  private receive(plugin: string, running: Running, message: FromPlugin) {
    if (message.type === "ops") this.hooks.broadcast({ type: "plugin.ops", plugin, ops: message.ops })
    else if (message.type === "snapshot") this.hooks.broadcast({ type: "plugin.ops", plugin, ops: message.ops, reset: true })
    else if (message.type === "opened") {
      const key = `${message.tabId}\n${message.panel}`
      running.opening.get(key)?.(message.root)
      running.opening.delete(key)
    } else if (message.type === "thread") {
      const { tabId, key, title, prompt } = message
      this.hooks.openThread(tabId, { key, ...(title ? { title } : {}), ...(prompt ? { prompt } : {}) })
    }
    else if (message.type === "toast") this.hooks.broadcast({ type: "error", message: message.message })
    else if (message.type === "error") this.hooks.broadcast({ type: "error", message: `${plugin}: ${message.message}` })
  }

  private post(running: Running, message: ToPlugin) {
    running.worker.postMessage(message)
  }
}
