import type { FromPlugin, Offers, ToPlugin, ViewKind } from "@desk/plugin/host"
import { panelInstanceId, type CoreMessage, type PanelParams, type PluginContributions, type DrawnView, type UiValue } from "@desk/protocol"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { deskHome } from "../data-files"
import { loginShellPath } from "../shell"
import { bundlePlugin } from "./bundle"
import { pluginsOn } from "./config"

type Send = (message: CoreMessage) => void

/** The files a plugin folder may start from. */
const ENTRIES = ["index.tsx", "index.ts"]

interface PluginHooks {
  readonly broadcast: Send
  /** A plugin asked to open a tab's thread for a key. */
  readonly openThread: (tabId: string, thread: { key: string; title?: string; prompt?: string }) => void
  /** A plugin asked to open a panel instance in a tab. */
  readonly openPanel: (tabId: string, panel: string, params: PanelParams) => void
  /** A panel asked to close itself. */
  readonly closePanel: (tabId: string, id: string) => void
}

interface Running {
  readonly worker: Worker
  readonly offers: Offers
  /** Draws waiting for the plugin's answer, by tab and key. Two asks for one view share one draw, because the plugin answers once. */
  readonly drawing: Map<string, { readonly view: Promise<DrawnView>; readonly resolve: (view: DrawnView) => void; readonly reject: (error: Error) => void }>
}

/** What the plugins on in a project offer, by kind, each under its full id, `<plugin>.<name>`. */
type ProjectOffers = { readonly [K in keyof Offers]: readonly (Omit<Offers[K][number], "name"> & { readonly id: string })[] }

const pluginsFolder = () => join(deskHome(), "plugins")

const drawKey = (tabId: string, key: string) => `${tabId}\n${key}`

/** A contribution's id splits into its plugin and its name in the plugin, at the first dot. An instance id splits the same way. */
function splitId(id: string): { plugin: string; name: string } {
  const dot = id.indexOf(".")
  if (dot < 1) throw new Error(`Plugin views are named <plugin>.<name>, not ${id}.`)
  return { plugin: id.slice(0, dot), name: id.slice(dot + 1) }
}

/**
 * The plugins in `~/.desk/plugins`, each in a worker of its own, so a slow plugin never stalls a session
 * or a terminal. A plugin starts the first time a project it is on is read, and stays up after. One
 * worker serves every tab.
 */
export class Plugins {
  private running = new Map<string, Promise<Running>>()

  constructor(private readonly hooks: PluginHooks) {}

  /** What the plugins on in `project` offer. A plugin that fails to start is left out, and the user is told. */
  async offers(project: string): Promise<ProjectOffers> {
    const started = await Promise.all(
      pluginsOn(project).map((plugin) =>
        this.start(plugin).then(
          (running) => ({ plugin, offers: running.offers }),
          (error: Error) => {
            this.hooks.broadcast({ type: "error", message: `The ${plugin} plugin could not start: ${error.message}` })
            return undefined
          },
        ),
      ),
    )
    const all = started.filter((found) => found !== undefined)
    // TypeScript loses which kind it maps across the union, so the result is named again.
    const named = <K extends keyof Offers>(kind: K) =>
      all.flatMap(({ plugin, offers }) => (offers[kind] as readonly { name: string }[]).map(({ name, ...rest }) => ({ ...rest, id: `${plugin}.${name}` }))) as unknown as ProjectOffers[K]
    return { sidebars: named("sidebars"), panels: named("panels"), cards: named("cards"), setups: named("setups"), commands: named("commands") }
  }

  /** One contribution of a plugin on in `project`. Anything else is refused, so a plugin's views and commands run only where it is on. */
  async find<K extends keyof Offers>(project: string, kind: K, id: string): Promise<ProjectOffers[K][number]> {
    const found = (await this.offers(project))[kind].find((offered) => offered.id === id)
    if (!found) throw new Error(`No plugin on in this project offers ${id}.`)
    return found
  }

  /** What the user can start from the palette in `project`: panels that need no parameters, setups and commands. */
  async contributions(project: string): Promise<PluginContributions> {
    const offered = await this.offers(project)
    return {
      // The host gives every panel without parameters a title.
      panels: offered.panels.flatMap(({ id, title, params }) => (params.length === 0 ? [{ id, title: title! }] : [])),
      setups: offered.setups.map(({ id, title }) => ({ id, title })),
      commands: offered.commands,
    }
  }

  /**
   * Draws a view for a tab, or names the one drawn before. A panel is drawn once per set of
   * parameters, and its view's id is its instance id.
   */
  async draw(tabId: string, project: string, kind: ViewKind, id: string, params: PanelParams = {}): Promise<DrawnView> {
    const { plugin, name } = splitId(id)
    const running = await this.start(plugin)
    const key = kind === "panel" ? panelInstanceId(id, params) : id
    const waiting = running.drawing.get(drawKey(tabId, key))
    if (waiting) return waiting.view
    const { promise, resolve, reject } = Promise.withResolvers<DrawnView>()
    running.drawing.set(drawKey(tabId, key), { view: promise, resolve, reject })
    this.post(running, { type: "draw", tabId, project, key, kind, name, ...(kind === "panel" ? { params } : {}) })
    return promise
  }

  /** Stops drawing a view, such as a closed panel. */
  undraw(tabId: string, key: string) {
    void this.running.get(splitId(key).plugin)?.then((running) => this.post(running, { type: "undraw", tabId, key }))
  }

  /** Tells every running plugin which panel instances a tab has open, for `isOpen`. */
  layout(tabId: string, open: readonly string[]) {
    for (const running of this.running.values()) void running.then((found) => this.post(found, { type: "layout", tabId, open }))
  }

  /** Runs a command of a plugin on in `project`, for a tab. */
  async command(tabId: string, project: string, id: string, input?: string) {
    await this.find(project, "commands", id)
    const { plugin, name } = splitId(id)
    this.post(await this.start(plugin), { type: "command", tabId, project, name, ...(input !== undefined ? { input } : {}) })
  }

  /** Runs a handler one of a plugin's nodes holds. */
  async event(plugin: string, handler: number, args: readonly UiValue[]) {
    const running = await this.running.get(plugin)
    if (!running) throw new Error(`The plugin ${plugin} is not running.`)
    this.post(running, { type: "event", handler, args })
  }

  /** A closed tab's views and plugin state go. */
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
      running.catch(() => this.running.delete(plugin))
    }
    return running
  }

  private async launch(plugin: string): Promise<Running> {
    const folder = join(pluginsFolder(), plugin)
    const entry = ENTRIES.map((file) => join(folder, file)).find(existsSync)
    if (!entry) throw new Error(`Desk found no plugin at ${folder}. A plugin starts from index.tsx or index.ts.`)
    const worker = new Worker(await bundlePlugin(plugin, entry), { env: { ...process.env, PATH: await loginShellPath() } })
    return new Promise<Running>((resolve, reject) => {
      let running: Running | undefined
      worker.onmessage = (event: MessageEvent<FromPlugin>) => {
        const message = event.data
        if (message.type === "ready") {
          running = { worker, offers: message.offers, drawing: new Map() }
          resolve(running)
        } else if (message.type === "failed") {
          worker.terminate()
          reject(new Error(message.message))
        } else if (running) this.receive(plugin, running, message)
      }
      worker.onerror = (event) => {
        this.running.delete(plugin)
        if (!running) return reject(new Error(event.message))
        for (const waiting of running.drawing.values()) waiting.reject(new Error(event.message))
        this.hooks.broadcast({ type: "error", message: `The ${plugin} plugin stopped: ${event.message}` })
      }
    })
  }

  private receive(plugin: string, running: Running, message: FromPlugin) {
    if (message.type === "ops") this.hooks.broadcast({ type: "plugin.ops", plugin, ops: message.ops })
    else if (message.type === "snapshot") this.hooks.broadcast({ type: "plugin.ops", plugin, ops: message.ops, reset: true })
    else if (message.type === "drawn" || message.type === "undrawn") {
      const key = drawKey(message.tabId, message.key)
      const waiting = running.drawing.get(key)
      running.drawing.delete(key)
      if (message.type === "drawn") waiting?.resolve({ id: message.key, title: message.title, plugin, root: message.root })
      else waiting?.reject(new Error(`${plugin}: ${message.message}`))
    } else if (message.type === "thread") {
      const { tabId, key, title, prompt } = message
      this.hooks.openThread(tabId, { key, ...(title ? { title } : {}), ...(prompt ? { prompt } : {}) })
    } else if (message.type === "open") this.hooks.openPanel(message.tabId, message.panel, message.params ?? {})
    else if (message.type === "close") this.hooks.closePanel(message.tabId, message.id)
    else if (message.type === "toast") this.hooks.broadcast({ type: "notice", message: message.message })
    else if (message.type === "error") this.hooks.broadcast({ type: "error", message: `${plugin}: ${message.message}` })
  }

  private post(running: Running, message: ToPlugin) {
    running.worker.postMessage(message)
  }
}
