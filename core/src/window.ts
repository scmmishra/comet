import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk"
import type { CoreMessage, FileChange, FollowUp, ImageAttachment, PluginLayout, QueuedMessage, TabInfo, ThreadEvent } from "@desk/protocol"
import { changesSince, snapshot } from "./checkpoints"
import { threadContext, threadHistory } from "./past-threads"
import { isProjectFolder, requireProjectFolder } from "./project-path"
import { sameRunSettings, Session } from "./session"
import { Terminals } from "./terminals"
import { loadWindowState, saveWindowState, type TabThread, type WindowState } from "./window-state"

type Send = (message: CoreMessage) => void

/** Enough recent folders to pick from. */
const MAX_RECENT = 20

interface WindowHooks {
  /** Sends to every client. */
  readonly broadcast: Send
  /** Whether to compact a large thread that sat idle, read at each ask. */
  readonly compactIdle: () => boolean
  readonly rateLimit: (info: SDKRateLimitInfo) => void
  /** A tab closed, so what runs for it can stop. */
  readonly tabClosed: (tabId: string) => void
}

/**
 * The window's tabs and what runs for them: each tab's Claude session and its panel terminals. The
 * app owns the tabs and sends them on every change. The core keeps each tab's thread: its session,
 * its baseline for Review and its last context reading. It also keeps each tab's plugin layout.
 */
export class Window {
  private state: WindowState = loadWindowState()
  private sessions = new Map<string, Session>()
  private terminals: Terminals

  constructor(private readonly hooks: WindowHooks) {
    this.terminals = new Terminals({
      output: (id, data) => hooks.broadcast({ type: "terminal.output", id, data }),
      exit: (id, code) => hooks.broadcast({ type: "terminal.exit", id, code }),
    })
  }

  /** Sends a client the window: its recent folders, then its tabs, then each tab's thread. */
  async greet(reply: Send) {
    reply({ type: "recent", projects: this.recent() })
    reply({ type: "tabs", tabs: this.state.tabs, active: this.state.active })
    for (const tab of this.state.tabs) {
      const thread = this.thread(tab.id)
      if (thread.queue?.length) reply({ type: "queue", tabId: tab.id, messages: thread.queue, held: !!thread.queueHeld })
      if (!thread.sessionId) continue
      reply({ type: "session.history", tabId: tab.id, items: await this.history(tab, thread.sessionId), context: thread.context })
      if (!thread.context) this.fillContext(tab.id, thread.sessionId)
    }
  }

  /**
   * Takes the app's tabs. A tab that opened a folder makes it the most recent. A tab that moved to
   * another project starts its session there. A tab that closed ends its session and its shells.
   */
  save(tabs: readonly TabInfo[], active: string | undefined) {
    const before = new Map(this.state.tabs.map((tab) => [tab.id, tab]))
    // Only a folder a tab opens now is checked, so a folder deleted under an older tab does not block every save.
    const opened = tabs.filter((tab) => before.get(tab.id)?.project !== tab.project).map((tab) => tab.project)
    for (const dir of opened) requireProjectFolder(dir)
    // A thread's transcript, baseline and Review belong to its folder, so only a tab with no thread can move.
    const moved = tabs.find((tab) => before.has(tab.id) && before.get(tab.id)!.project !== tab.project && this.thread(tab.id).sessionId)
    if (moved) throw new Error("A tab can change its project only before its thread starts.")
    const kept = <T>(byTab: Readonly<Record<string, T>>) => Object.fromEntries(tabs.flatMap((tab) => (byTab[tab.id] ? [[tab.id, byTab[tab.id]!]] : [])))
    this.persist({ tabs, active, threads: kept(this.state.threads), layouts: kept(this.state.layouts) })
    for (const tab of tabs) {
      const old = before.get(tab.id)
      if (old && old.project !== tab.project) this.closeSession(tab.id)
      else if (old && !sameRunSettings(old, tab))
        this.sessions
          .get(tab.id)
          ?.configure(tab)
          .catch((error) => this.hooks.broadcast({ type: "error", message: `Desk could not change how the thread runs: ${message(error)}` }))
    }
    for (const id of before.keys()) {
      if (tabs.some((tab) => tab.id === id)) continue
      this.closeSession(id)
      this.hooks.tabClosed(id)
    }
    if (opened.length) this.remember(opened)
    this.terminals.retain(new Set(tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.id))))
  }

  /**
   * Sends a message in a tab. A thread's first message snapshots the project first, so Review can show
   * what the thread changed. A plugin may move the tab to another thread during the snapshot. The message
   * then belongs to no thread the tab shows, so it is not sent.
   */
  async send(tabId: string, text: string, images: readonly ImageAttachment[] = [], followUp: FollowUp = "steer") {
    const running = this.sessions.get(tabId)
    if (running?.busy) {
      if (followUp === "steer") return running.steer(text, images)
      return this.setQueue(tabId, [...(this.thread(tabId).queue ?? []), { id: crypto.randomUUID(), text, ...(images.length ? { images } : {}) }])
    }
    const tab = this.tab(tabId)
    const key = this.thread(tabId).key
    if (!this.thread(tabId).baseline) {
      const baseline = await snapshot(tab.project)
      if (this.thread(tabId).key !== key) throw new Error(MOVED)
      if (baseline) this.updateThread(tabId, { baseline })
    }
    this.session(tab).send(text, images)
  }

  /** Continues a past thread in a tab. The tab may hold a session that never sent a message; the thread replaces it. */
  async resume(tabId: string, threadId: string, reply: Send) {
    const tab = this.tab(tabId)
    this.closeSession(tabId)
    this.setThread(tabId, { sessionId: threadId })
    reply({ type: "session.history", tabId, items: await this.history(tab, threadId) })
    this.fillContext(tabId, threadId)
  }

  /**
   * Shows the thread for `key` in a tab, as a plugin asked. A key that led to a thread before resumes
   * it. A new one starts empty and, given a prompt, sends it.
   */
  async openKey(tabId: string, thread: { readonly key: string; readonly title?: string; readonly prompt?: string }) {
    if (this.thread(tabId).key === thread.key) return
    const tab = this.tab(tabId)
    const sessionId = this.state.keys[threadKey(tab.project, thread.key)]
    this.closeSession(tabId)
    this.setThread(tabId, { key: thread.key, ...(sessionId ? { sessionId } : {}) })
    if (thread.title) this.hooks.broadcast({ type: "tab.title", tabId, title: thread.title })
    const items = sessionId ? await this.history(tab, sessionId) : []
    // Another key may have taken the tab while the transcript was read.
    if (this.thread(tabId).key !== thread.key) return
    this.hooks.broadcast({ type: "session.history", tabId, items })
    if (sessionId) this.fillContext(tabId, sessionId)
    // A newer key that took the tab during the send has its own prompt, so this one goes unsaid.
    else if (thread.prompt) await this.send(tabId, thread.prompt).catch((error: Error) => { if (error.message !== MOVED) throw error })
  }

  /** Sends a queued message now: into the running turn, or as a turn of its own. */
  async sendQueued(tabId: string, id: string) {
    const queued = this.thread(tabId).queue?.find((message) => message.id === id)
    if (!queued) return
    this.removeQueued(tabId, id)
    await this.send(tabId, queued.text, queued.images, "steer")
  }

  removeQueued(tabId: string, id: string) {
    this.setQueue(tabId, (this.thread(tabId).queue ?? []).filter((message) => message.id !== id))
  }

  /** Sends the queue again after a stop or an error paused it. */
  resumeQueue(tabId: string) {
    this.setQueue(tabId, this.thread(tabId).queue ?? [], false)
    this.sendNextQueued(tabId)
  }

  /** Starts the next queued message as its own turn, unless a turn runs or the queue is paused. */
  private sendNextQueued(tabId: string) {
    const thread = this.thread(tabId)
    const [next, ...rest] = thread.queue ?? []
    if (!next || thread.queueHeld || this.sessions.get(tabId)?.busy) return
    this.setQueue(tabId, rest)
    this.send(tabId, next.text, next.images).catch((error) => this.hooks.broadcast({ type: "error", message: `Desk could not send a queued message: ${message(error)}` }))
  }

  private setQueue(tabId: string, queue: readonly QueuedMessage[], held = this.thread(tabId).queueHeld ?? false) {
    this.updateThread(tabId, { queue, queueHeld: held && queue.length > 0 })
    this.hooks.broadcast({ type: "queue", tabId, messages: queue, held: held && queue.length > 0 })
  }

  interrupt(tabId: string) {
    return this.sessions.get(tabId)?.interrupt()
  }

  answerPermission(tabId: string, requestId: string, allow: boolean) {
    this.sessions.get(tabId)?.answerPermission(requestId, allow)
  }

  closeSession(tabId: string) {
    this.sessions.get(tabId)?.close()
    this.sessions.delete(tabId)
  }

  /** What a tab's thread changed since its first message. A baseline that `git gc` pruned shows nothing. */
  async review(tabId: string): Promise<FileChange[]> {
    const baseline = this.thread(tabId).baseline
    if (!baseline) return []
    return changesSince(this.tab(tabId).project, baseline).catch(() => [])
  }

  /** Which tab has each of a project's threads open, by Claude session id. */
  openThreads(project: string): ReadonlyMap<string, string> {
    return new Map(this.state.tabs.flatMap((tab) => (tab.project === project && this.thread(tab.id).sessionId ? [[this.thread(tab.id).sessionId!, tab.id] as const] : [])))
  }

  /** Starts a terminal in the project of the tab that lists it, or reattaches to it. */
  openTerminal(id: string, cols: number, rows: number) {
    const tab = this.state.tabs.find((found) => found.terminals.some((terminal) => terminal.id === id))
    if (!tab) throw new Error("Desk could not find the tab this terminal belongs to.")
    this.terminals.open(id, tab.project, cols, rows)
  }

  terminalInput(id: string, data: string) {
    this.terminals.input(id, data)
  }

  resizeTerminal(id: string, cols: number, rows: number) {
    this.terminals.resize(id, cols, rows)
  }

  /** The folder a saved tab works in. */
  projectOf(tabId: string): string {
    return this.tab(tabId).project
  }

  layout(tabId: string): PluginLayout | undefined {
    return this.state.layouts[tabId]
  }

  setLayout(tabId: string, layout: PluginLayout) {
    this.tab(tabId)
    this.persist({ layouts: { ...this.state.layouts, [tabId]: layout } })
  }

  stop() {
    for (const session of this.sessions.values()) session.close()
    this.terminals.closeAll()
  }

  private tab(tabId: string): TabInfo {
    const tab = this.state.tabs.find((found) => found.id === tabId)
    if (!tab) throw new Error("Desk could not find the tab.")
    return tab
  }

  /** Folders tabs have opened, most recent first. A folder that no longer exists is left out. */
  private recent() {
    return this.state.recent.filter(isProjectFolder)
  }

  private thread(tabId: string): TabThread {
    return this.state.threads[tabId] ?? {}
  }

  private session(tab: TabInfo) {
    let found = this.sessions.get(tab.id)
    if (!found) {
      // A closed session may still deliver a message. It no longer speaks for the tab, so it is ignored.
      const key = this.thread(tab.id).key
      const current = () => this.sessions.get(tab.id) === created
      // A turn the user stopped, or one that failed, pauses the queue. Any other end sends the next queued message.
      let pause = false
      const emit = (event: ThreadEvent) => {
        if (!current()) return
        if (event.kind === "context") this.updateThread(tab.id, { context: event.reading })
        this.hooks.broadcast({ type: "session.event", tabId: tab.id, event })
        if (event.kind === "item" && event.item.type === "result") pause = !!event.item.stopped || event.item.isError
        if (event.kind === "item" && event.item.type === "error") pause = true
        if (event.kind === "status" && !event.busy) {
          if (pause && this.thread(tab.id).queue?.length) this.setQueue(tab.id, this.thread(tab.id).queue!, true)
          else this.sendNextQueued(tab.id)
          pause = false
        }
      }
      found = new Session(tab.project, emit, {
        resume: this.thread(tab.id).sessionId,
        settings: tab,
        compactIdle: this.hooks.compactIdle,
        onSessionId: (sessionId) => {
          if (!current()) return
          this.updateThread(tab.id, { sessionId })
          if (key) this.persist({ keys: { ...this.state.keys, [threadKey(tab.project, key)]: sessionId } })
        },
        onRateLimit: this.hooks.rateLimit,
      })
      const created = found
      this.sessions.set(tab.id, created)
    }
    return found
  }

  /** A thread that cannot be read shows empty, and the user is told. */
  private history(tab: TabInfo, sessionId: string) {
    return threadHistory(tab.project, sessionId).catch((error) => {
      this.hooks.broadcast({ type: "error", message: `Desk could not read the thread in “${tab.title}”: ${message(error)}` })
      return []
    })
  }

  /** A thread with no context reading gets one now, so its ring shows before its next reply. */
  private fillContext(tabId: string, sessionId: string) {
    const tab = this.state.tabs.find((found) => found.id === tabId)
    if (!tab) return
    void threadContext(tab.project, sessionId).then((context) => {
      // The tab may have moved to another thread, or taken a live reading, while the probe ran.
      const thread = this.state.threads[tabId]
      if (!context || thread?.sessionId !== sessionId || thread.context) return
      this.updateThread(tabId, { context })
      this.hooks.broadcast({ type: "session.event", tabId, event: { kind: "context", reading: context } })
    })
  }

  /** Moves folders to the front of the recent list. */
  private remember(projects: readonly string[]) {
    this.persist({ recent: [...new Set([...projects, ...this.recent()])].slice(0, MAX_RECENT) })
    this.hooks.broadcast({ type: "recent", projects: this.state.recent })
  }

  private updateThread(tabId: string, change: Partial<TabThread>) {
    this.setThread(tabId, { ...this.thread(tabId), ...change })
  }

  private setThread(tabId: string, thread: TabThread) {
    this.persist({ threads: { ...this.state.threads, [tabId]: thread } })
  }

  private persist(change: Partial<WindowState>) {
    this.state = { ...this.state, ...change }
    saveWindowState(this.state)
  }
}

/** Thrown by `send` when a plugin moved the tab to another thread before the message went out. */
const MOVED = "The tab moved to another thread before the message was sent."

/** Keys belong to a project, so two projects' plugins can use the same key. The plugin names its own keys. */
const threadKey = (project: string, key: string) => `${project}\n${key}`

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
