import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk"
import { followUpFor, type ChangedFile, type CoreMessage, type FileChange, type FollowUp, type ImageAttachment, type PermissionAnswer, type PluginLayout, type QueuedMessage, type ReviewScope, type TabInfo, type ThreadEvent, type ThreadItem } from "@desk/protocol"
import { branchBase, capture, changesSince, checkpointChanges, headTree, keepCheckpoints } from "./checkpoints"
import { threadContext, threadHistory } from "./past-threads"
import { isProjectFolder, requireProjectFolder } from "./project-path"
import { sameRunSettings, Session } from "./session"
import { Terminals } from "./terminals"
import { loadWindowState, saveWindowState, type ClosedTab, type TabThread, type WindowState } from "./window-state"

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
 * its checkpoints for Review and its last context reading. It also keeps each tab's plugin layout.
 */
export class Window {
  private state: WindowState = loadWindowState()
  private sessions = new Map<string, Session>()
  /**
   * Sessions whose turn still runs in a thread a plugin switched the tab away from, by project and key.
   * One rejoins its tab when the thread comes back, and closes once its turn ends while away.
   */
  private readonly parked = new Map<string, { readonly tabId: string; readonly session: Session }>()
  private terminals: Terminals
  /** Each tab's last turn being ended. Review waits for it, so it reads the checkpoint the turn ends on. */
  private readonly turnEnds = new Map<string, Promise<void>>()

  constructor(private readonly hooks: WindowHooks) {
    this.terminals = new Terminals({
      output: (id, data) => hooks.broadcast({ type: "terminal.output", id, data }),
      exit: (id, code) => hooks.broadcast({ type: "terminal.exit", id, code }),
    })
    void this.releaseCheckpoints()
  }

  /**
   * Lets Git prune the checkpoints no saved thread names any more, such as those of a cleared thread. It
   * runs once at start, so it never races a checkpoint being taken. A project it cannot read is skipped.
   */
  private async releaseCheckpoints() {
    const threads = [...this.state.tabs.map((tab) => ({ project: tab.project, thread: this.state.threads[tab.id] })), ...this.state.closed.map((closed) => ({ project: closed.tab.project, thread: closed.thread }))]
    const kept = new Map<string, Set<string>>()
    for (const { project, thread } of threads) {
      const commits = kept.get(project) ?? new Set<string>()
      for (const commit of [thread?.threadStart, thread?.turnFrom, thread?.turnTo]) if (commit) commits.add(commit)
      kept.set(project, commits)
    }
    for (const [project, commits] of kept) await keepCheckpoints(project, commits).catch(() => undefined)
  }

  /** Sends a client the window: its recent folders, then its tabs, then each tab's thread. */
  async greet(reply: Send) {
    reply({ type: "recent", projects: this.recent() })
    reply({ type: "tabs", tabs: this.state.tabs, active: this.state.active })
    for (const tab of this.state.tabs) await this.sendThread(tab, reply)
  }

  /**
   * Reopens the tab closed last whose folder is still there, with its thread and layout, as ⌘⇧T asks.
   * Its terminals ended when it closed, so it comes back without them. The app adds it back and saves.
   */
  async reopenTab(reply: Send) {
    const closed = [...this.state.closed]
    let found: ClosedTab | undefined
    while ((found = closed.pop()) && !isProjectFolder(found.tab.project));
    this.persist({ closed })
    if (!found) return
    const tab: TabInfo = { ...found.tab, terminals: [], ...(found.tab.terminals.some((terminal) => terminal.id === found!.tab.panelActive) ? { panelActive: undefined } : {}) }
    this.persist({
      threads: found.thread ? { ...this.state.threads, [tab.id]: found.thread } : this.state.threads,
      layouts: found.layout ? { ...this.state.layouts, [tab.id]: found.layout } : this.state.layouts,
    })
    reply({ type: "tab.reopened", tab, index: found.index })
    await this.sendThread(tab, reply)
  }

  /** Sends a client a tab's queue and thread, read back from Claude's transcript. */
  private async sendThread(tab: TabInfo, reply: Send) {
    const thread = this.thread(tab.id)
    if (thread.queue?.length) reply({ type: "queue", tabId: tab.id, messages: thread.queue, held: !!thread.queueHeld })
    if (!thread.sessionId) return
    reply({ type: "session.history", tabId: tab.id, items: await this.history(tab, thread.sessionId), context: thread.context })
    if (!thread.context) this.fillContext(tab.id, thread.sessionId)
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
    // A closed tab is kept a while, with its thread and layout, so ⌘⇧T can bring it back.
    const closing = this.state.tabs.flatMap((tab, index): ClosedTab[] =>
      tabs.some((found) => found.id === tab.id) ? [] : [{ tab, index, ...(this.state.threads[tab.id] ? { thread: this.state.threads[tab.id] } : {}), ...(this.state.layouts[tab.id] ? { layout: this.state.layouts[tab.id] } : {}) }],
    )
    const closed = [...this.state.closed, ...closing].slice(-CLOSED_TABS)
    this.persist({ tabs, active, threads: kept(this.state.threads), layouts: kept(this.state.layouts), closed })
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
   * Sends a message in a tab. A thread's first turn takes a checkpoint of the project first, and later
   * turns start from where the turn before ended. A plugin may move the tab to another thread during the
   * checkpoint. The message then belongs to no thread the tab shows, so it is not sent.
   */
  async send(tabId: string, text: string, images: readonly ImageAttachment[] = [], followUp: FollowUp = "steer") {
    const running = this.sessions.get(tabId)
    if (running?.busy) {
      if (followUpFor(text, followUp) === "steer") return running.steer(text, images)
      return this.setQueue(tabId, [...(this.thread(tabId).queue ?? []), { id: crypto.randomUUID(), text, ...(images.length ? { images } : {}) }])
    }
    const tab = this.tab(tabId)
    if (!this.thread(tabId).threadStart) {
      const key = this.thread(tabId).key
      const threadStart = await capture(tab.project)
      if (this.thread(tabId).key !== key) throw new Error(MOVED)
      if (threadStart) this.updateThread(tabId, { threadStart })
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
    this.parkSession(tabId)
    this.setThread(tabId, { key: thread.key, ...(sessionId ? { sessionId } : {}) })
    if (thread.title) this.hooks.broadcast({ type: "tab.title", tabId, title: thread.title })
    const items = sessionId ? await this.history(tab, sessionId) : []
    // Another key may have taken the tab while the transcript was read.
    if (this.thread(tabId).key !== thread.key) return
    // A thread whose turn kept running while away rejoins the tab, and its turn shows from where it is.
    const back = this.parked.get(threadKey(tab.project, thread.key))
    if (back?.tabId === tabId) {
      this.parked.delete(threadKey(tab.project, thread.key))
      this.sessions.set(tabId, back.session)
    }
    // A transcript read mid-turn closes that turn with a result timed to its last reply. The turn is still running, so its result is left for the live one.
    const running = back?.session.busy ?? false
    const shown = running && items.at(-1)?.type === "result" ? items.slice(0, -1) : items
    this.hooks.broadcast({ type: "session.history", tabId, items: shown })
    if (running) this.hooks.broadcast({ type: "session.event", tabId, event: { kind: "status", busy: true } })
    if (sessionId) this.fillContext(tabId, sessionId)
    // A newer key that took the tab during the send has its own prompt, so this one goes unsaid.
    else if (thread.prompt) await this.send(tabId, thread.prompt).catch((error: Error) => { if (error.message !== MOVED) throw error })
  }

  /** Sends a queued message now: into the running turn, or as a turn of its own. */
  async sendQueued(tabId: string, id: string) {
    const queued = this.thread(tabId).queue?.find((message) => message.id === id)
    if (!queued) return
    this.removeQueued(tabId, id)
    // Send now is asked for outright, so even a slash command goes into the running turn.
    const running = this.sessions.get(tabId)
    if (running?.busy) return running.steer(queued.text, queued.images)
    await this.send(tabId, queued.text, queued.images)
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

  stopTasks(tabId: string, ids: readonly string[]) {
    return this.sessions.get(tabId)?.stopTasks(ids)
  }

  answerPermission(tabId: string, requestId: string, answer: PermissionAnswer) {
    this.sessions.get(tabId)?.answerPermission(requestId, answer)
  }

  answerQuestion(tabId: string, requestId: string, answers: Readonly<Record<string, string>> | undefined) {
    this.sessions.get(tabId)?.answerQuestion(requestId, answers)
  }

  /**
   * Moves a tab's session aside when a plugin switches the tab to another thread. A turn still running goes
   * on, out of sight, so switching conversations never stops Claude. An idle session closes.
   */
  private parkSession(tabId: string) {
    const running = this.sessions.get(tabId)
    const key = this.thread(tabId).key
    if (!running) return
    this.sessions.delete(tabId)
    if (running.busy && key) this.parked.set(threadKey(this.tab(tabId).project, key), { tabId, session: running })
    else running.close()
  }

  closeSession(tabId: string) {
    this.sessions.get(tabId)?.close()
    this.sessions.delete(tabId)
  }

  /** Starts a fresh session in a tab, as /clear asks. The tab keeps its plugin key and its queue, and its thread starts empty. */
  clearThread(tabId: string) {
    this.closeSession(tabId)
    const { key, queue, queueHeld } = this.thread(tabId)
    this.setThread(tabId, { ...(key ? { key } : {}), ...(queue ? { queue, queueHeld } : {}) })
    this.hooks.broadcast({ type: "session.history", tabId, items: [] })
  }

  /**
   * What changed in a tab's project in the span `scope` names. The thread and last-turn scopes compare
   * checkpoints, after T3 Code, so they show finished turns. A thread with no finished turn has none.
   */
  async review(tabId: string, scope: ReviewScope): Promise<FileChange[]> {
    const project = this.tab(tabId).project
    if (scope === "thread" || scope === "turn") {
      await this.turnEnds.get(tabId)
      const thread = this.thread(tabId)
      const from = scope === "thread" ? thread.threadStart : thread.turnFrom
      return from && thread.turnTo ? checkpointChanges(project, from, thread.turnTo).catch(() => []) : []
    }
    const base = scope === "git" ? await headTree(project) : await branchBase(project)
    return base ? changesSince(project, base).catch(() => []) : []
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
      // The message the running turn answers, which names the turn's summary, and the summary being made.
      let lastMessage: string | undefined
      let summary: Promise<void> = Promise.resolve()
      const emit = (event: ThreadEvent) => {
        if (!current()) {
          // A parked session's turn ended while its thread was away. Nothing shows it, so it closes. Its transcript keeps the turn.
          if (event.kind === "status" && !event.busy) this.closeParked(created)
          return
        }
        if (event.kind === "context") this.updateThread(tab.id, { context: event.reading })
        this.hooks.broadcast({ type: "session.event", tabId: tab.id, event })
        if (event.kind === "item" && event.item.type === "user") lastMessage = event.item.id
        if (event.kind === "item" && event.item.type === "result") {
          pause = !!event.item.stopped || event.item.isError
          if (lastMessage) {
            summary = this.finishTurn(tab.id, lastMessage, current)
            this.turnEnds.set(tab.id, summary)
          }
        }
        if (event.kind === "item" && event.item.type === "error") pause = true
        if (event.kind === "status" && !event.busy) {
          const paused = pause
          pause = false
          // The next queued turn starts from the checkpoint this one ends on, so it waits for it.
          void summary.then(() => {
            if (!current()) return
            if (paused && this.thread(tab.id).queue?.length) this.setQueue(tab.id, this.thread(tab.id).queue!, true)
            else this.sendNextQueued(tab.id)
          })
        }
      }
      found = new Session(tab.project, emit, {
        resume: this.thread(tab.id).sessionId,
        settings: tab,
        compactIdle: this.hooks.compactIdle,
        onSessionId: (sessionId) => {
          // A parked thread still saves its session under its key, so coming back resumes it.
          if (key) this.persist({ keys: { ...this.state.keys, [threadKey(tab.project, key)]: sessionId } })
          if (current()) this.updateThread(tab.id, { sessionId })
        },
        onRateLimit: this.hooks.rateLimit,
      })
      const created = found
      this.sessions.set(tab.id, created)
    }
    return found
  }

  private closeParked(session: Session) {
    for (const [key, parked] of this.parked) {
      if (parked.session !== session) continue
      this.parked.delete(key)
      session.close()
    }
  }

  /**
   * Ends a turn, stopped and failed ones too, after T3 Code. It takes the checkpoint the next turn starts
   * from, lists the files the turn changed under its answer and saves the list for when the thread is
   * restored. A turn that a finished background task started runs from the turn before it, like any other.
   * Files a branch switch or a pull brought in are left out. A turn that changed nothing gets no summary.
   */
  private async finishTurn(tabId: string, lastMessage: string, current: () => boolean) {
    const tab = this.state.tabs.find((found) => found.id === tabId)
    if (!tab) return
    const to = await capture(tab.project)
    if (!to || !current()) return
    const from = this.thread(tabId).turnTo ?? this.thread(tabId).threadStart
    this.updateThread(tabId, { turnTo: to, ...(from ? { turnFrom: from } : { threadStart: to }) })
    if (!from) return
    const files = (await checkpointChanges(tab.project, from, to).catch(() => [])).map(({ patch: _patch, ...file }) => file)
    if (!files.length || !current()) return
    this.updateThread(tabId, { turnChanges: { ...this.thread(tabId).turnChanges, [lastMessage]: files } })
    this.hooks.broadcast({ type: "session.event", tabId, event: { kind: "item", item: changesItem(lastMessage, files) } })
  }

  /** A restored thread, with each turn's saved summary after its result. A thread that cannot be read shows empty, and the user is told. */
  private async history(tab: TabInfo, sessionId: string): Promise<ThreadItem[]> {
    const items = await threadHistory(tab.project, sessionId).catch((error) => {
      this.hooks.broadcast({ type: "error", message: `Desk could not read the thread in “${tab.title}”: ${message(error)}` })
      return []
    })
    const saved = this.thread(tab.id).turnChanges ?? {}
    return items.flatMap((item) => {
      const files = item.type === "result" ? saved[item.id.slice(RESULT_PREFIX.length)] : undefined
      return files ? [item, changesItem(item.id.slice(RESULT_PREFIX.length), files)] : [item]
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

/** How many closed tabs ⌘⇧T can bring back. */
const CLOSED_TABS = 10

/** A restored turn's result is named after the message it answers: `result:<message id>`. */
const RESULT_PREFIX = "result:"

const changesItem = (lastMessage: string, files: readonly ChangedFile[]): ThreadItem => ({ type: "changes", id: `changes:${lastMessage}`, files })
