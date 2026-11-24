import type { TurnOutcome } from "@comet/plugin"
import type { FromPlugin, Offers, ToPlugin, ViewRequest, ViewResult } from "@comet/plugin/host"
import { contributionId, splitContributionId, type CoreMessage, type PanelParams, type PluginContributions, type ProjectSetup, type UiValue } from "@comet/protocol"
import { errorMessage } from "../errors"
import { isProjectFolder } from "../project-path"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { cometHome } from "../data-files"
import { bundlePlugin } from "./bundle"
import { checkPlugin, readManifest } from "./manifest"
import { pluginSettingValues } from "./settings"
import { pluginProjects, pluginsOn } from "./config"
import type { PluginRun } from "./runs"

type Send = (message: CoreMessage) => void

/** The files a plugin folder may start from. */
const ENTRIES = ["index.tsx", "index.ts"]

/** A thread a plugin opens under a key: the key, a title for its tab, and the prompt a new thread starts with. */
export interface KeyedThread {
  readonly key: string
  readonly title?: string
  readonly prompt?: string
}

interface PluginHooks {
  readonly broadcast: Send
  /** A plugin asked to open a tab's thread for a key. */
  readonly openThread: (tabId: string, thread: KeyedThread) => void
  /** A plugin asked to run a prompt on a tab's agent. It throws when the run cannot start. */
  readonly run: (tabId: string, prompt: string) => PluginRun
  /** A plugin asked to open a panel instance in a tab. */
  readonly openPanel: (tabId: string, panel: string, params: PanelParams) => void
  /** A panel asked to close itself. */
  readonly closePanel: (tabId: string, id: string) => void
  /** A running plugin stopped. The tabs that showed its views lay out again without it. */
  readonly stopped: (plugin: string) => void
}

interface Running {
  readonly worker: Worker
  readonly offers: Offers
  /** `show` asks waiting for the plugin's answer, by sequence number. */
  readonly showing: Map<number, { readonly resolve: (views: readonly ViewResult[]) => void; readonly reject: (error: Error) => void }>
  /** The runs the plugin started that have not ended, by the id the plugin gave each. */
  readonly runs: Map<number, { readonly tabId: string; readonly run: PluginRun }>
}

/** What the plugins on in a project offer, by kind, each under its full id, `<plugin>.<name>`. */
type ProjectOffers = { readonly [K in keyof Offers]: readonly (Omit<Offers[K][number], "name"> & { readonly id: string })[] }

const pluginsFolder = () => join(cometHome(), "plugins")

/** A full thread key as `plugin` named it, without its prefix, or undefined for no key or another plugin's. */
const ownKey = (plugin: string, threadKey: string | undefined) => {
  if (!threadKey) return undefined
  const { plugin: owner, name } = splitContributionId(threadKey)
  return owner === plugin ? name : undefined
}

/**
 * The plugins in `~/.comet/plugins`, each in a worker of its own, so a slow plugin never stalls a session
 * or a terminal. A plugin starts the first time a project it is on is read, and stays up after. One
 * worker serves every tab. A plugin that fails to start or stops is reported once and stays off until
 * the plugins reload, which is also when an edited plugin takes effect.
 */
export class Plugins {
  private running = new Map<string, Promise<Running>>()
  private failed = new Map<string, Error>()
  /** The last `visible` message each plugin was sent, as JSON, so an unchanged screen sends nothing. */
  private visibleSent = new Map<string, string>()
  private seq = 0
  /** Counts reloads. A worker from before the last reload is ignored while it shuts down. */
  private generation = 0

  constructor(private readonly hooks: PluginHooks) {}

  /** What the plugins on in `project` offer. A plugin that failed is left out. */
  async offers(project: string): Promise<ProjectOffers> {
    const started = await Promise.all(
      pluginsOn(project).map((plugin) =>
        this.start(plugin).then(
          (running) => ({ plugin, offers: running.offers }),
          () => undefined,
        ),
      ),
    )
    const all = started.filter((found) => found !== undefined)
    // TypeScript loses which kind it maps across the union, so the result is named again.
    const named = <K extends keyof Offers>(kind: K) =>
      all.flatMap(({ plugin, offers }) => (offers[kind] as readonly { name: string }[]).map(({ name, ...rest }) => ({ ...rest, id: contributionId(plugin, name) }))) as unknown as ProjectOffers[K]
    return { sidebars: named("sidebars"), panels: named("panels"), cards: named("cards"), setups: named("setups"), commands: named("commands") }
  }

  /** One contribution of a plugin on in `project`. Anything else is refused, so a plugin's views and commands run only where it is on. */
  async find<K extends keyof Offers>(project: string, kind: K, id: string): Promise<ProjectOffers[K][number]> {
    const found = (await this.offers(project))[kind].find((offered) => offered.id === id)
    if (found) return found
    const failure = this.failed.get(splitContributionId(id).plugin)
    throw failure ? new Error(`${id} is not available: ${failure.message}`) : new Error(`No plugin on in this project offers ${id}.`)
  }

  /**
   * Tells every running plugin which of its views a tab shows, which panel instances are open there,
   * and which of its threads the tab shows. Each draws what it lacks and disposes the rest. Answers the
   * views drawn, by key.
   */
  async show(tabId: string, project: string, views: readonly ViewRequest[], open: readonly string[], threadKey?: string): Promise<Map<string, ViewResult>> {
    const byPlugin = new Map<string, ViewRequest[]>()
    for (const view of views) {
      const { plugin } = splitContributionId(view.key)
      byPlugin.set(plugin, [...(byPlugin.get(plugin) ?? []), view])
    }
    const answers = await Promise.all(
      [...this.running.keys()].map(async (plugin) => {
        const running = await this.running.get(plugin)!.catch(() => undefined)
        if (!running) return []
        const seq = ++this.seq
        const { promise, resolve, reject } = Promise.withResolvers<readonly ViewResult[]>()
        running.showing.set(seq, { resolve, reject })
        const thread = ownKey(plugin, threadKey)
        this.post(running, { type: "show", seq, tabId, project, views: byPlugin.get(plugin) ?? [], open, ...(thread ? { thread } : {}) })
        return promise.catch((error: Error) => (byPlugin.get(plugin) ?? []).map((view) => ({ key: view.key, error: error.message })))
      }),
    )
    return new Map(answers.flat().map((result) => [result.key, result]))
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
   * The setups of every project with plugins on, so the palette can open one in any project. The active
   * project's come first. A setup from a plugin on everywhere shows once, for the active project.
   */
  async setups(active: string): Promise<ProjectSetup[]> {
    const projects = [active, ...pluginProjects().filter((project) => project !== active && isProjectFolder(project))]
    const seen = new Set<string>()
    const found: ProjectSetup[] = []
    for (const project of projects) {
      for (const { id, title } of (await this.offers(project)).setups) {
        if (seen.has(id)) continue
        seen.add(id)
        found.push({ project, id, title })
      }
    }
    return found
  }

  /** Runs a command of a plugin on in `project`, for a tab. */
  async command(tabId: string, project: string, id: string, input?: string) {
    await this.find(project, "commands", id)
    const { plugin, name } = splitContributionId(id)
    this.post(await this.start(plugin), { type: "command", tabId, project, name, ...(input !== undefined ? { input } : {}) })
  }

  /** Runs a handler one of a plugin's nodes holds. */
  async event(plugin: string, handler: number, args: readonly UiValue[]) {
    const running = await this.running.get(plugin)
    if (!running) throw new Error(`The plugin ${plugin} is not running.`)
    this.post(running, { type: "event", handler, args })
  }

  /**
   * Tells every running plugin which of its views are on screen: `keys` in tab `tabId`, or none without
   * a tab. A plugin hears only of its own views, and only when they change.
   */
  visible(tabId: string | undefined, keys: readonly string[]) {
    for (const [plugin, running] of this.running) {
      const mine = keys.filter((key) => splitContributionId(key).plugin === plugin)
      const message: ToPlugin = { type: "visible", ...(tabId && mine.length ? { tabId } : {}), keys: mine }
      const json = JSON.stringify(message)
      if (this.visibleSent.get(plugin) === json) continue
      this.visibleSent.set(plugin, json)
      void running.then((found) => this.post(found, message)).catch(() => undefined)
    }
  }

  /** Tells the plugin that owns a thread's key that a turn ended in it. A key no running plugin owns is ignored. */
  turnEnded(tabId: string, threadKey: string, outcome: TurnOutcome) {
    const { plugin, name } = splitContributionId(threadKey)
    void this.running.get(plugin)?.then((found) => this.post(found, { type: "turnEnd", tabId, key: name, outcome })).catch(() => undefined)
  }

  /** Tells every running plugin which of its threads a tab now shows, if any, so its views can follow. */
  threadShown(tabId: string, threadKey: string | undefined) {
    for (const [plugin, running] of this.running) {
      const key = ownKey(plugin, threadKey)
      void running.then((found) => this.post(found, { type: "threadShown", tabId, ...(key ? { key } : {}) })).catch(() => undefined)
    }
  }

  /** A closed tab's views and plugin state go. */
  dropTab(tabId: string) {
    this.each((found) => {
      this.post(found, { type: "drop", tabId })
      for (const { tabId: runIn, run } of found.runs.values()) if (runIn === tabId) run.stop()
    })
  }

  /** Sends every running plugin's whole UI again, for a client that just connected. */
  resend() {
    this.each((found) => this.post(found, { type: "snapshot" }))
  }

  stop() {
    this.each((found) => {
      closeRuns(found)
      found.worker.terminate()
    })
  }

  /** Does something with every plugin that runs. One that failed to start has nothing to hear. */
  private each(act: (running: Running) => void) {
    for (const running of this.running.values()) void running.then(act, () => undefined)
  }

  /**
   * Stops every plugin and forgets those that failed, so each starts again from its files the next time
   * a project asks for it. The app drops each plugin's nodes, since the new worker numbers its own.
   */
  reload() {
    const stopping = [...this.running]
    this.generation++
    this.running.clear()
    this.failed.clear()
    this.visibleSent.clear()
    for (const [plugin, running] of stopping) {
      this.hooks.broadcast({ type: "plugin.ops", plugin, ops: [], reset: true })
      void running.then((found) => {
        // The tabs lay out again with the new worker, so what waited on the old one draws nothing.
        for (const waiting of found.showing.values()) waiting.resolve([])
        closeRuns(found)
        found.worker.terminate()
      }, () => undefined)
    }
  }

  /** The user changed a plugin's settings. A running plugin hears them all, as they are now. */
  async settingsChanged(plugin: string) {
    const running = await this.running.get(plugin)?.catch(() => undefined)
    if (!running) return
    const settings = readManifest(join(pluginsFolder(), plugin))?.settings ?? []
    this.post(running, { type: "settings", settings: pluginSettingValues(plugin, settings) })
  }

  private start(plugin: string): Promise<Running> {
    const failure = this.failed.get(plugin)
    if (failure) return Promise.reject(failure)
    let running = this.running.get(plugin)
    if (!running) {
      running = this.launch(plugin)
      this.running.set(plugin, running)
      const started = running
      // A start the plugins reloaded past is not this plugin's failure.
      running.catch((error: Error) => this.running.get(plugin) === started && this.fail(plugin, error, "could not start"))
    }
    return running
  }

  /** Turns a plugin off until the plugins reload, and tells the user once. */
  private fail(plugin: string, error: Error, what: string) {
    this.running.delete(plugin)
    this.visibleSent.delete(plugin)
    this.failed.set(plugin, error)
    this.hooks.broadcast({ type: "error", message: `The ${plugin} plugin ${what}`, detail: error.message })
  }

  private async launch(plugin: string): Promise<Running> {
    const folder = join(pluginsFolder(), plugin)
    const entry = ENTRIES.map((file) => join(folder, file)).find(existsSync)
    if (!entry) throw new Error(`Comet found no plugin at ${folder}. A plugin starts from index.tsx or index.ts.`)
    const settings = checkPlugin(folder, plugin)?.settings ?? []
    // A Bun Worker starts with the environment the process started with, not what the core set since,
    // so it would lack the login shell's PATH. It gets a copy, so a plugin finds the user's tools, such as
    // a CLI in ~/.local/bin. A copy, not a shared one, keeps a plugin's changes out of the agents' sessions.
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
    const generation = this.generation
    const worker = new Worker(await bundlePlugin(plugin, entry), { env })
    // Setup waits for this, so it can read the plugin's settings.
    worker.postMessage({ type: "init", settings: pluginSettingValues(plugin, settings) } satisfies ToPlugin)
    const stale = () => generation !== this.generation
    return new Promise<Running>((resolve, reject) => {
      let running: Running | undefined
      worker.onmessage = (event: MessageEvent<FromPlugin>) => {
        const message = event.data
        if (stale() && message.type !== "ready" && message.type !== "failed") return
        if (message.type === "ready") {
          running = { worker, offers: message.offers, showing: new Map(), runs: new Map() }
          resolve(running)
        } else if (message.type === "failed") {
          worker.terminate()
          reject(new Error(message.message))
        } else if (running) this.receive(plugin, running, message)
      }
      worker.onerror = (event) => {
        worker.terminate()
        if (!running) return reject(new Error(event.message))
        if (stale()) return
        const error = new Error(event.message)
        for (const waiting of running.showing.values()) waiting.reject(error)
        closeRuns(running)
        this.fail(plugin, error, "stopped")
        // The app's copy of a stopped plugin's nodes draws nothing anyone can use.
        this.hooks.broadcast({ type: "plugin.ops", plugin, ops: [], reset: true })
        this.hooks.stopped(plugin)
      }
    })
  }

  private receive(plugin: string, running: Running, message: FromPlugin) {
    if (message.type === "ops") this.hooks.broadcast({ type: "plugin.ops", plugin, ops: message.ops })
    else if (message.type === "snapshot") this.hooks.broadcast({ type: "plugin.ops", plugin, ops: message.ops, reset: true })
    else if (message.type === "shown") {
      running.showing.get(message.seq)?.resolve(message.views)
      running.showing.delete(message.seq)
    } else if (message.type === "thread") {
      const { tabId, key, title, prompt } = message
      // A thread key belongs to its plugin, so two plugins in one project never share a thread.
      this.hooks.openThread(tabId, { key: contributionId(plugin, key), ...(title ? { title } : {}), ...(prompt ? { prompt } : {}) })
    } else if (message.type === "run") this.run(running, message.id, message.tabId, message.prompt)
    else if (message.type === "stopRun") running.runs.get(message.id)?.run.stop()
    else if (message.type === "open") this.hooks.openPanel(message.tabId, message.panel, message.params ?? {})
    else if (message.type === "close") this.hooks.closePanel(message.tabId, message.id)
    else if (message.type === "toast") this.hooks.broadcast({ type: "notice", message: message.message })
    else if (message.type === "error") this.hooks.broadcast({ type: "error", message: `Something in the ${plugin} plugin failed`, detail: message.message })
  }

  /** Starts a run a plugin asked for, and answers it once the run ends. */
  private run(running: Running, id: number, tabId: string, prompt: string) {
    let run: PluginRun
    try {
      run = this.hooks.run(tabId, prompt)
    } catch (error) {
      return this.post(running, { type: "ran", id, error: errorMessage(error) })
    }
    running.runs.set(id, { tabId, run })
    void run.done
      .then(
        (reply): ToPlugin => ({ type: "ran", id, reply }),
        (error): ToPlugin => ({ type: "ran", id, error: errorMessage(error) }),
      )
      // A run closed with its plugin has no one left to answer.
      .then((answer) => running.runs.delete(id) && this.post(running, answer))
  }

  private post(running: Running, message: ToPlugin) {
    running.worker.postMessage(message)
  }
}

/** Ends a stopping plugin's runs at once. */
function closeRuns(running: Running) {
  for (const { run } of running.runs.values()) run.close()
  running.runs.clear()
}
