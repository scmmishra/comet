import { deleteSession, forkSession, renameSession, type SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk"
import { Transcript } from "./rewind"
import type { TurnOutcome } from "@desk/plugin"
import { followUpFor, type ChangedFile, type CoreMessage, type FileChange, type FollowUp, type ImageAttachment, type PermissionAnswer, type PluginLayout, type QueuedMessage, type ReviewScope, type TabInfo, type ThreadEvent, type ThreadItem } from "@desk/protocol"
import { branchBase, capture, changesSince, checkpointChanges, headTree, keepCheckpoints } from "./checkpoints"
import { git } from "./git"
import { threadContext, threadHistory } from "./past-threads"
import { isProjectFolder, requireProjectFolder } from "./project-path"
import { sameRunSettings, Session } from "./session"
import { currentBranch } from "./space"
import { Terminals } from "./terminals"
import { loadWindowState, saveWindowState, type ClosedTab, type TabThread, type WindowState } from "./window-state"

type Send = (message: CoreMessage) => void

/** Enough recent folders to pick from. */
const MAX_RECENT = 20
/** How a turn that ends with no result ended, such as one whose session failed to start. */
const NO_RESULT: TurnOutcome = "error"

/** How a running turn ends so far, after one of its events. A result says how it ended, and a later error overrides it. */
export function outcomeAfter(outcome: TurnOutcome, event: ThreadEvent): TurnOutcome {
  if (event.kind !== "item") return outcome
  if (event.item.type === "result") return event.item.stopped ? "interrupted" : event.item.isError ? "error" : "done"
  if (event.item.type === "error") return "error"
  return outcome
}

interface WindowHooks {
  /** Sends to every client. */
  readonly broadcast: Send
  /** Whether to compact a large thread that sat idle, read at each ask. */
  readonly compactIdle: () => boolean
  readonly rateLimit: (info: SDKRateLimitInfo) => void
  /** A tab closed, so what runs for it can stop. */
  readonly tabClosed: (tabId: string) => void
  /** A turn ended in a plugin's thread, named by its full key, even while the thread was away from its tab. */
  readonly turnEnded: (tabId: string, threadKey: string, outcome: TurnOutcome) => void
  /** A tab moved to another thread. `threadKey` is the full key of a plugin's thread, or undefined for the tab's own. */
  readonly threadShown: (tabId: string, threadKey: string | undefined) => void
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
    // The tab shows its plugin thread again, so the thread leaves the keyed threads.
    const { [found.thread?.key ? threadKey(tab.project, found.thread.key) : ""]: _shown, ...keyed } = this.state.keyed
    this.persist({
      keyed,
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
    if (thread.branch) reply({ type: "thread.branch", tabId: tab.id, branch: thread.branch })
    if (!thread.sessionId) return
    reply({ type: "thread.session", tabId: tab.id, sessionId: thread.sessionId })
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
    // A plugin thread outlives its tab under its key, so opening the key again resumes it.
    const keyed = { ...this.state.keyed }
    for (const { tab, thread } of closing) if (thread?.key) keyed[threadKey(tab.project, thread.key)] = thread
    this.persist({ tabs, active, threads: kept(this.state.threads), layouts: kept(this.state.layouts), closed, keyed })
    for (const tab of tabs) {
      const old = before.get(tab.id)
      if (old && old.project !== tab.project) this.closeSession(tab.id)
      else if (old && !sameRunSettings(old, tab))
        this.sessions
          .get(tab.id)
          ?.configure(tab)
          .catch((error) => this.hooks.broadcast({ type: "error", message: "Desk could not change how the thread runs", detail: message(error) }))
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
    void this.recordBranch(tabId)
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
    const leaving = this.thread(tabId)
    if (leaving.key === thread.key) return
    const tab = this.tab(tabId)
    this.parkSession(tabId)
    // The thread leaving keeps everything under its key, and the one coming takes back what it kept.
    const id = threadKey(tab.project, thread.key)
    const coming = this.state.keyed[id] ?? this.shownKeyThread(tab.project, thread.key) ?? { key: thread.key }
    const { [id]: _taken, ...keyed } = this.state.keyed
    this.persist({ keyed: leaving.key ? { ...keyed, [threadKey(tab.project, leaving.key)]: leaving } : keyed })
    this.setThread(tabId, coming)
    const sessionId = coming.sessionId
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
    // A queue whose turn ended while the thread was away sends its next message now.
    if (!running) this.sendNextQueued(tabId)
    // A new thread starts with the plugin's prompt. A newer key that took the tab during the send has its
    // own prompt, so this one goes unsaid.
    if (!sessionId && thread.prompt) await this.send(tabId, thread.prompt).catch((error: Error) => { if (error.message !== MOVED) throw error })
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
    this.send(tabId, next.text, next.images).catch((error) => this.hooks.broadcast({ type: "error", message: "Desk could not send a queued message", detail: message(error) }))
  }

  private setQueue(tabId: string, queue: readonly QueuedMessage[], held = this.thread(tabId).queueHeld ?? false) {
    this.updateThread(tabId, { queue, queueHeld: held && queue.length > 0 })
  }

  interrupt(tabId: string) {
    return this.sessions.get(tabId)?.interrupt()
  }

  stopTasks(tabId: string, ids: readonly string[]) {
    return this.sessions.get(tabId)?.stopTasks(ids)
  }

  /** Notes the branch the tab's thread runs on now. A detached HEAD keeps the branch it last ran on. */
  private async recordBranch(tabId: string) {
    const tab = this.state.tabs.find((found) => found.id === tabId)
    const branch = tab && (await currentBranch(tab.project))
    if (branch && branch !== this.thread(tabId).branch) this.updateThread(tabId, { branch })
  }

  /** The thread for a key that another tab shows, so a second tab opening the key resumes the same session. */
  private shownKeyThread(project: string, key: string): TabThread | undefined {
    const tab = this.state.tabs.find((found) => found.project === project && this.state.threads[found.id]?.key === key)
    const sessionId = tab && this.state.threads[tab.id]!.sessionId
    return sessionId ? { key, sessionId } : undefined
  }

  /**
   * Switches the tab's project back to the branch its thread last ran on, after T3 Code. Git refuses
   * when uncommitted changes would be lost, and the user sees why. Returns the project.
   */
  async restoreBranch(tabId: string): Promise<string> {
    const { project } = this.tab(tabId)
    const branch = this.thread(tabId).branch
    if (!branch) throw new Error("This thread has no branch to go back to.")
    await git(project, ["switch", branch])
    return project
  }

  /** Ends a turn that did not stop when asked. Its session closes, and the next message starts a new one on the thread. */
  forceStop(tabId: string) {
    if (this.sessions.get(tabId)?.forceStop()) this.closeSession(tabId)
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

  /** Names a tab and its session. Claude Code keeps the name in the transcript, so the thread list and `claude --resume` show it. */
  async renameThread(tabId: string, title: string) {
    const name = title.trim()
    if (!name) throw new Error("A thread needs a name.")
    const { project, sessionId } = this.started(tabId)
    await renameSession(sessionId, name, { dir: project })
    this.hooks.broadcast({ type: "tab.title", tabId, title: name })
  }

  /**
   * Copies a tab's session into a new one, under the tab's name, for the app to open beside it. Given
   * one of the user's messages, the copy ends with that message's turn.
   */
  async forkThread(tabId: string, reply: Send, messageId?: string) {
    const { project, sessionId } = this.started(tabId)
    const end = messageId ? (await Transcript.read(project, sessionId)).turnEnd(messageId) : undefined
    const title = `${this.tab(tabId).title} (fork)`
    const forked = await forkSession(sessionId, { dir: project, title, ...(end ? { upToMessageId: end } : {}) })
    reply({ type: "thread.forked", tabId, threadId: forked.sessionId, title })
  }

  /**
   * Takes a tab's thread back to before one of the user's messages, so the user can send it again,
   * changed. Claude forgets that message and what followed. With `restoreFiles`, the files Claude's
   * tools changed since go back as they were. The transcript keeps the old messages until the next
   * turn runs, so the thread hides them until then.
   */
  async rewindThread(tabId: string, messageId: string, restoreFiles: boolean) {
    const tab = this.tab(tabId)
    const { sessionId } = this.started(tabId)
    if (this.sessions.get(tabId)?.busy) throw new Error("Stop Claude before you rewind the thread.")
    const at = (await Transcript.read(tab.project, sessionId)).before(messageId)
    if (restoreFiles) await this.session(tab).rewindFiles(messageId)
    this.closeSession(tabId)
    // The last turn's checkpoints describe work the rewind took back. The next turn starts from the files as they are now.
    const turnTo = await capture(tab.project)
    const { key, queue, queueHeld, threadStart } = this.thread(tabId)
    const kept = { ...(key ? { key } : {}), ...(queue ? { queue, queueHeld } : {}), ...(threadStart ? { threadStart } : {}), ...(turnTo ? { turnTo } : {}) }
    // A rewind to the first message leaves nothing to resume, so the next message starts a new session.
    this.setThread(tabId, at ? { ...this.thread(tabId), ...kept, turnFrom: undefined, rewind: { at, from: messageId } } : kept)
    this.hooks.broadcast({ type: "session.history", tabId, items: at ? await this.history(tab, sessionId) : [] })
  }

  /**
   * Deletes a tab's session from this Mac and starts the tab afresh. The session closes first, so
   * Claude Code stops writing to the transcript before it goes. Review's checkpoints go with the thread.
   */
  async deleteThread(tabId: string) {
    const { project, sessionId } = this.started(tabId)
    this.clearThread(tabId)
    await deleteSession(sessionId, { dir: project })
  }

  /** A tab's project and its session, which must have started. */
  private started(tabId: string) {
    const { sessionId } = this.thread(tabId)
    if (!sessionId) throw new Error("The thread has not started yet.")
    return { project: this.tab(tabId).project, sessionId }
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

  activeTab(): TabInfo | undefined {
    return this.state.tabs.find((tab) => tab.id === this.state.active)
  }

  /** The folder a saved tab works in. */
  projectOf(tabId: string): string {
    return this.tab(tabId).project
  }

  layout(tabId: string): PluginLayout | undefined {
    return this.state.layouts[tabId]
  }

  /** The full key of the plugin thread a tab shows, or undefined while it shows its own thread. */
  threadKeyOf(tabId: string): string | undefined {
    return this.thread(tabId).key
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
      // How the running turn ends, for the plugin that owns the thread.
      let outcome: TurnOutcome = NO_RESULT
      const emit = (event: ThreadEvent) => {
        outcome = outcomeAfter(outcome, event)
        if (event.kind === "status" && !event.busy) {
          if (key) this.hooks.turnEnded(tab.id, key, outcome)
          outcome = NO_RESULT
        }
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
      const rewind = this.thread(tab.id).rewind
      found = new Session(tab.project, emit, {
        resume: this.thread(tab.id).sessionId,
        ...(rewind ? { resumeAt: rewind.at, onResumedAt: () => current() && this.updateThread(tab.id, { rewind: undefined }) } : {}),
        settings: tab,
        compactIdle: this.hooks.compactIdle,
        onSessionId: (sessionId) => {
          if (current()) return this.updateThread(tab.id, { sessionId })
          // A parked thread keeps its session under its key, so coming back resumes it.
          const id = key && threadKey(tab.project, key)
          const parked = id ? this.state.keyed[id] : undefined
          if (id && parked) this.persist({ keyed: { ...this.state.keyed, [id]: { ...parked, sessionId } } })
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
    await this.recordBranch(tabId)
    if (!from) return
    const files = (await checkpointChanges(tab.project, from, to).catch(() => [])).map(({ patch: _patch, ...file }) => file)
    if (!files.length || !current()) return
    this.updateThread(tabId, { turnChanges: { ...this.thread(tabId).turnChanges, [lastMessage]: files } })
    this.hooks.broadcast({ type: "session.event", tabId, event: { kind: "item", item: changesItem(lastMessage, files) } })
  }

  /** A restored thread, with each turn's saved summary after its result. A thread that cannot be read shows empty, and the user is told. */
  private async history(tab: TabInfo, sessionId: string): Promise<ThreadItem[]> {
    const items = await threadHistory(tab.project, sessionId).catch((error) => {
      this.hooks.broadcast({ type: "error", message: `Desk could not read the thread in “${tab.title}”`, detail: message(error) })
      return []
    })
    const { turnChanges: saved = {}, rewind } = this.thread(tab.id)
    const cut = rewind ? items.findIndex((item) => item.id === rewind.from) : -1
    return (cut < 0 ? items : items.slice(0, cut)).flatMap((item) => {
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
    // The tab's branch notice follows the thread it shows.
    const before = this.state.threads[tabId]
    if (thread.branch !== before?.branch) this.hooks.broadcast({ type: "thread.branch", tabId, ...(thread.branch ? { branch: thread.branch } : {}) })
    // Its queue follows the thread too, so a message queued in one thread never shows in another.
    if (thread.queue !== before?.queue || !!thread.queueHeld !== !!before?.queueHeld) this.hooks.broadcast({ type: "queue", tabId, messages: thread.queue ?? [], held: !!thread.queueHeld })
    this.persist({ threads: { ...this.state.threads, [tabId]: thread } })
    if (thread.key !== before?.key) this.hooks.threadShown(tabId, thread.key)
    if (thread.sessionId !== before?.sessionId) this.hooks.broadcast({ type: "thread.session", tabId, ...(thread.sessionId ? { sessionId: thread.sessionId } : {}) })
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
