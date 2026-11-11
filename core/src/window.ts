import type { TurnOutcome } from "@desk/plugin"
import { followUpFor, type AgentId, type ChangedFile, type CoreMessage, type FileChange, type FollowUp, type ImageAttachment, type PermissionAnswer, type PluginLayout, type QueuedMessage, type ReviewScope, type RunSettings, type TabInfo, type ThreadEvent, type ThreadItem, type ThreadSummary } from "@desk/protocol"
import { requireFeature, type Agent, type AgentSession } from "./agents/agent"
import type { Agents } from "./agents/registry"
import { resultMessage } from "./agents/turn-items"
import type { Delegations, Handoffs } from "./delegate/delegations"
import { branchBase, capture, changesSince, checkpointChanges, headTree, keepCheckpoints } from "./checkpoints"
import { errorMessage } from "./errors"
import { git } from "./git"
import { isProjectFolder, requireProjectFolder } from "./project-path"
import { currentBranch } from "./space"
import { Terminals } from "./terminals"
import { TurnWatch } from "./turn"
import { checkpointsOf, loadWindowState, saveWindowState, type ClosedTab, type TabThread, type WindowState } from "./window-state"

type Send = (message: CoreMessage) => void

/** Enough recent folders to pick from. */
const MAX_RECENT = 20
/** How many closed tabs ⌘⇧T can bring back. */
const CLOSED_TABS = 10

/** Thrown by `send` when a plugin moved the tab to another thread before the message went out. */
class ThreadMoved extends Error {
  constructor() {
    super("The tab moved to another thread before the message was sent.")
  }
}

/** A session that runs a thread, with the work its agent hands to others. */
interface Live {
  readonly session: AgentSession
  readonly handoffs: Handoffs
}

interface WindowHooks {
  /** Sends to every client. */
  readonly broadcast: Send
  /** The agents that run the tabs' threads. */
  readonly agents: Pick<Agents, "get" | "all">
  /** Gives each session Desk's tools, for the work its agent hands another agent. */
  readonly delegations: Pick<Delegations, "open">
  /** A tab closed, so what runs for it can stop. */
  readonly tabClosed: (tabId: string) => void
  /** A turn ended in a plugin's thread, named by its full key, even while the thread was away from its tab. */
  readonly turnEnded: (tabId: string, threadKey: string, outcome: TurnOutcome) => void
  /** A tab moved to another thread. `threadKey` is the full key of a plugin's thread, or undefined for the tab's own. */
  readonly threadShown: (tabId: string, threadKey: string | undefined) => void
}

/**
 * The window's tabs and what runs for them: each tab's agent session and its panel terminals. The
 * app owns the tabs and sends them on every change. The core keeps each tab's thread: its session,
 * its checkpoints for Review and its last context reading. It also keeps each tab's plugin layout.
 */
export class Window {
  private state: WindowState = loadWindowState()
  /** Each tab's session, once its thread has run a turn in this run of Desk. */
  private sessions = new Map<string, Live>()
  /**
   * Sessions whose turn still runs in a thread a plugin switched the tab away from, by keyed id.
   * One rejoins its tab when the thread comes back, and closes once its turn ends while away.
   */
  private readonly parked = new Map<string, { readonly tabId: string; readonly live: Live }>()
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
      for (const commit of thread ? checkpointsOf(thread) : []) commits.add(commit)
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
    const { [found.thread?.key ? keyedId(tab.project, found.thread.key) : ""]: _shown, ...keyed } = this.state.keyed
    this.persist({
      keyed,
      threads: found.thread ? { ...this.state.threads, [tab.id]: found.thread } : this.state.threads,
      layouts: found.layout ? { ...this.state.layouts, [tab.id]: found.layout } : this.state.layouts,
    })
    reply({ type: "tab.reopened", tab, index: found.index })
    await this.sendThread(tab, reply)
  }

  /** Sends a client a tab's queue and thread, read back from its agent's transcript. */
  private async sendThread(tab: TabInfo, reply: Send) {
    const thread = this.thread(tab.id)
    if (thread.queue?.length) reply({ type: "queue", tabId: tab.id, messages: thread.queue, held: !!thread.queueHeld })
    if (thread.branch) reply({ type: "thread.branch", tabId: tab.id, branch: thread.branch })
    if (!thread.sessionId) return
    reply(sessionMessage(tab.id, thread))
    reply({ type: "session.history", tabId: tab.id, items: await this.history(tab, thread.sessionId), context: thread.context })
    if (!thread.context) this.fillContext(tab.id, thread.sessionId)
  }

  /**
   * Takes the app's tabs. A tab that opened a folder makes it the most recent. A tab that moved to
   * another project, or another agent, starts its session there. A tab that closed ends its session and
   * its shells. A thread keeps the agent it started on, whatever its tab says later.
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
    for (const { tab, thread } of closing) if (thread?.key) keyed[keyedId(tab.project, thread.key)] = thread
    this.persist({ tabs, active, threads: kept(this.state.threads), layouts: kept(this.state.layouts), closed, keyed })
    for (const tab of tabs) {
      const old = before.get(tab.id)
      if (old && (old.project !== tab.project || old.agent !== tab.agent)) this.closeSession(tab.id)
      else if (old && !sameRunSettings(old, tab))
        this.sessions
          .get(tab.id)
          ?.session.configure(tab)
          .catch((error) => this.hooks.broadcast({ type: "error", message: "Desk could not change how the thread runs", detail: errorMessage(error) }))
    }
    for (const id of before.keys()) {
      if (tabs.some((tab) => tab.id === id)) continue
      this.closeSession(id)
      this.turnEnds.delete(id)
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
    const running = this.sessions.get(tabId)?.session
    if (running?.busy) {
      // An agent that cannot take a message mid-turn queues it, whatever the user chose.
      if (followUpFor(text, followUp) === "steer" && this.steers(tabId)) return running.steer!(text, images)
      return this.setQueue(tabId, [...(this.thread(tabId).queue ?? []), { id: crypto.randomUUID(), text, ...(images.length ? { images } : {}) }])
    }
    const tab = this.tab(tabId)
    if (!this.thread(tabId).threadStart) {
      const key = this.thread(tabId).key
      const threadStart = await capture(tab.project)
      if (this.thread(tabId).key !== key) throw new ThreadMoved()
      if (threadStart) this.updateThread(tabId, { threadStart })
    }
    this.live(tab).session.send(text, images)
    void this.recordBranch(tabId)
  }

  /** Continues a past thread in a tab, on the agent it ran on. The tab may hold a session that never sent a message; the thread replaces it. */
  async resume(tabId: string, agent: AgentId, threadId: string, reply: Send) {
    const tab = this.tab(tabId)
    this.hooks.agents.get(agent)
    this.closeSession(tabId)
    this.setThread(tabId, { sessionId: threadId, agent })
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
    const id = keyedId(tab.project, thread.key)
    const coming = this.state.keyed[id] ?? this.shownKeyThread(tab.project, thread.key) ?? { key: thread.key }
    const { [id]: _taken, ...keyed } = this.state.keyed
    this.persist({ keyed: leaving.key ? { ...keyed, [keyedId(tab.project, leaving.key)]: leaving } : keyed })
    this.setThread(tabId, coming)
    const sessionId = coming.sessionId
    if (thread.title) this.hooks.broadcast({ type: "tab.title", tabId, title: thread.title })
    const items = sessionId ? await this.history(tab, sessionId) : []
    // Another key may have taken the tab while the transcript was read.
    if (this.thread(tabId).key !== thread.key) return
    // A thread whose turn kept running while away rejoins the tab, and its turn shows from where it is.
    const back = this.parked.get(id)
    if (back?.tabId === tabId) {
      this.parked.delete(id)
      this.sessions.set(tabId, back.live)
    }
    // A transcript read mid-turn closes that turn with a result timed to its last reply. The turn is still running, so its result is left for the live one.
    const running = back?.live.session.busy ?? false
    const shown = running && items.at(-1)?.type === "result" ? items.slice(0, -1) : items
    this.hooks.broadcast({ type: "session.history", tabId, items: shown })
    if (running) this.hooks.broadcast({ type: "session.event", tabId, event: { kind: "status", busy: true } })
    if (sessionId) this.fillContext(tabId, sessionId)
    // A queue whose turn ended while the thread was away sends its next message now.
    if (!running) this.sendNextQueued(tabId)
    // A new thread starts with the plugin's prompt. A newer key that took the tab during the send has its
    // own prompt, so this one goes unsaid.
    if (!sessionId && thread.prompt) await this.send(tabId, thread.prompt).catch((error) => { if (!(error instanceof ThreadMoved)) throw error })
  }

  /** Sends a queued message now: into the running turn, or as a turn of its own. */
  async sendQueued(tabId: string, id: string) {
    const queued = this.thread(tabId).queue?.find((message) => message.id === id)
    if (!queued) return
    const running = this.sessions.get(tabId)?.session
    // An agent that cannot take a message mid-turn keeps it queued until the turn ends.
    if (running?.busy && !this.steers(tabId)) return
    this.removeQueued(tabId, id)
    // Send now is asked for outright, so even a slash command goes into the running turn.
    if (running?.busy) return running.steer!(queued.text, queued.images)
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
    if (!next || thread.queueHeld || this.sessions.get(tabId)?.session.busy) return
    this.setQueue(tabId, rest)
    this.send(tabId, next.text, next.images).catch((error) => this.hooks.broadcast({ type: "error", message: "Desk could not send a queued message", detail: errorMessage(error) }))
  }

  private setQueue(tabId: string, queue: readonly QueuedMessage[], held = this.thread(tabId).queueHeld ?? false) {
    this.updateThread(tabId, { queue, queueHeld: held && queue.length > 0 })
  }

  /** Asks a tab's turn to stop, and with it the work its agent handed to others. */
  interrupt(tabId: string) {
    const live = this.sessions.get(tabId)
    live?.handoffs.stop()
    return live?.session.interrupt()
  }

  stopTasks(tabId: string, ids: readonly string[]) {
    return this.sessions.get(tabId)?.session.stopTasks?.(ids)
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
    const shown = tab && this.state.threads[tab.id]!
    return shown?.sessionId ? { key, sessionId: shown.sessionId, agent: shown.agent } : undefined
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
    if (this.sessions.get(tabId)?.session.forceStop()) this.closeSession(tabId)
  }

  /** Answers a request in a tab's thread. A request of work handed to another agent goes to that agent. */
  answerPermission(tabId: string, requestId: string, answer: PermissionAnswer) {
    const live = this.sessions.get(tabId)
    if (live && !live.handoffs.answerPermission(requestId, answer)) live.session.answerPermission(requestId, answer)
  }

  answerQuestion(tabId: string, requestId: string, answers: Readonly<Record<string, string>> | undefined) {
    const live = this.sessions.get(tabId)
    if (live && !live.handoffs.answerQuestion(requestId, answers)) live.session.answerQuestion(requestId, answers)
  }

  /**
   * Moves a tab's session aside when a plugin switches the tab to another thread. A turn still running goes
   * on, out of sight, so switching conversations never stops the agent. An idle session closes.
   */
  private parkSession(tabId: string) {
    const live = this.sessions.get(tabId)
    const key = this.thread(tabId).key
    if (!live) return
    this.sessions.delete(tabId)
    if (live.session.busy && key) this.parked.set(keyedId(this.tab(tabId).project, key), { tabId, live })
    else close(live)
  }

  private closeSession(tabId: string) {
    const live = this.sessions.get(tabId)
    if (live) close(live)
    this.sessions.delete(tabId)
  }

  /** Starts a fresh session in a tab, as /clear asks. The tab keeps its plugin key and its queue, and its thread starts empty. */
  clearThread(tabId: string) {
    this.closeSession(tabId)
    this.setThread(tabId, startedOver(this.thread(tabId)))
    this.hooks.broadcast({ type: "session.history", tabId, items: [] })
  }

  /** Names a tab and its session. The agent keeps the name with the thread, so the thread list shows it. */
  async renameThread(tabId: string, title: string) {
    const name = title.trim()
    if (!name) throw new Error("A thread needs a name.")
    const { agent, project, sessionId } = this.started(tabId)
    requireFeature(agent, "rename", "rename a thread")
    await agent.threads.rename!(project, sessionId, name)
    this.hooks.broadcast({ type: "tab.title", tabId, title: name })
  }

  /**
   * Copies a tab's session into a new one, under the tab's name, for the app to open beside it. Given
   * one of the user's messages, the copy ends with that message's turn.
   */
  async forkThread(tabId: string, reply: Send, messageId?: string) {
    const { agent, project, sessionId } = this.started(tabId)
    requireFeature(agent, "fork", "fork a thread")
    const title = `${this.tab(tabId).title} (fork)`
    const threadId = await agent.threads.fork!(project, sessionId, { title, ...(messageId ? { messageId } : {}) })
    reply({ type: "thread.forked", tabId, agent: agent.id, threadId, title })
  }

  /**
   * Takes a tab's thread back to before one of the user's messages, so the user can send it again,
   * changed. The agent forgets that message and what followed. With `restoreFiles`, the files the agent's
   * tools changed since go back as they were. An agent whose transcript keeps the old messages until the
   * next turn runs names where the thread resumes, and the thread hides them until then.
   */
  async rewindThread(tabId: string, messageId: string, restoreFiles: boolean) {
    const tab = this.tab(tabId)
    const { agent, sessionId } = this.started(tabId)
    requireFeature(agent, "rewind", "rewind a thread")
    if (restoreFiles) requireFeature(agent, "restore-files", "restore the files a thread changed")
    if (this.sessions.get(tabId)?.session.busy) throw new Error(`Stop ${agent.name} before you rewind the thread.`)
    // The files go back first, while the transcript still holds the messages that changed them.
    if (restoreFiles) await this.live(tab).session.restoreFiles!(messageId)
    this.closeSession(tabId)
    const rewound = await agent.threads.rewind!(tab.project, sessionId, messageId)
    // The last turn's checkpoints describe work the rewind took back. The next turn starts from the files as they are now.
    const turnTo = await capture(tab.project)
    const { threadStart } = this.thread(tabId)
    const kept = { ...startedOver(this.thread(tabId)), ...(threadStart ? { threadStart } : {}), ...(turnTo ? { turnTo } : {}) }
    // A rewind to the first message leaves nothing to resume, so the next message starts a new session.
    const rewind = !rewound.empty && rewound.resumeAt ? { at: rewound.resumeAt, from: messageId } : undefined
    this.setThread(tabId, rewound.empty ? kept : { ...this.thread(tabId), ...kept, turnFrom: undefined, rewind })
    this.hooks.broadcast({ type: "session.history", tabId, items: rewound.empty ? [] : await this.history(tab, sessionId) })
  }

  /**
   * Deletes a tab's session from this Mac and starts the tab afresh. The session closes first, so
   * the agent stops writing to the transcript before it goes. Review's checkpoints go with the thread.
   */
  async deleteThread(tabId: string) {
    const { agent, project, sessionId } = this.started(tabId)
    requireFeature(agent, "delete", "delete a thread")
    this.clearThread(tabId)
    await agent.threads.delete!(project, sessionId)
  }

  /** A tab's agent, its project and its session, which must have started. */
  private started(tabId: string) {
    const { sessionId } = this.thread(tabId)
    if (!sessionId) throw new Error("The thread has not started yet.")
    const tab = this.tab(tabId)
    return { agent: this.agent(tab), project: tab.project, sessionId }
  }

  /** Whether a tab's agent takes a message into a running turn. */
  private steers(tabId: string) {
    return this.agent(this.tab(tabId)).features.includes("steer")
  }

  /** The agent that runs a tab's thread: the one the thread started on, else the one the tab names. */
  private agent(tab: TabInfo): Agent {
    return this.hooks.agents.get(this.thread(tab.id).agent ?? tab.agent)
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

  /** A project's recent threads across every agent, newest first, each with the tab that has it open. */
  async recentThreads(project: string): Promise<ThreadSummary[]> {
    const open = new Map(this.state.tabs.flatMap((tab) => (tab.project === project && this.thread(tab.id).sessionId ? [[threadRef(this.agent(tab).id, this.thread(tab.id).sessionId!), tab.id] as const] : [])))
    const lists = await Promise.all(
      this.hooks.agents.all().map(async (agent) =>
        (await agent.threads.list(project).catch(() => [])).map((thread): ThreadSummary => {
          const tabId = open.get(threadRef(agent.id, thread.id))
          return { ...thread, agent: agent.id, ...(tabId ? { tabId } : {}) }
        }),
      ),
    )
    return lists.flat().sort((a, b) => b.updatedAt - a.updatedAt)
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
    for (const live of this.sessions.values()) close(live)
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

  /** A tab's session, opened on the thread's agent when the tab has none. */
  private live(tab: TabInfo): Live {
    const found = this.sessions.get(tab.id)
    if (found) return found
    const key = this.thread(tab.id).key
    // A closed session may still deliver a message. It no longer speaks for the tab, so it is ignored.
    const current = () => this.sessions.get(tab.id) === created
    const turn = new TurnWatch()
    // The summary of the turn that ended last, while it is being made.
    let summary: Promise<void> = Promise.resolve()
    const emit = (event: ThreadEvent) => {
      const ended = turn.take(event)
      if (ended && key) this.hooks.turnEnded(tab.id, key, ended.outcome)
      if (!current()) {
        // A parked session's turn ended while its thread was away. Nothing shows it, so it closes. Its transcript keeps the turn.
        if (ended) this.closeParked(created)
        return
      }
      if (event.kind === "context") this.updateThread(tab.id, { context: event.reading })
      this.hooks.broadcast({ type: "session.event", tabId: tab.id, event })
      if (event.kind === "item" && event.item.type === "result" && turn.message) {
        summary = this.finishTurn(tab.id, turn.message, current)
        this.turnEnds.set(tab.id, summary)
      }
      if (!ended) return
      // The next queued turn starts from the checkpoint this one ends on, so it waits for it.
      void summary.then(() => {
        if (!current()) return
        if (ended.held && this.thread(tab.id).queue?.length) this.setQueue(tab.id, this.thread(tab.id).queue!, true)
        else this.sendNextQueued(tab.id)
      })
    }
    const rewind = this.thread(tab.id).rewind
    const agent = this.agent(tab)
    const handoffs = this.hooks.delegations.open({
      project: tab.project,
      settings: () => this.state.tabs.find((open) => open.id === tab.id) ?? tab,
      // A task's events show only while its session's thread does.
      emit: (event) => current() && this.hooks.broadcast({ type: "session.event", tabId: tab.id, event }),
    })
    const session = agent.open(tab.project, emit, {
      resume: this.thread(tab.id).sessionId,
      ...(rewind ? { resumeAt: rewind.at, onResumedAt: () => current() && this.updateThread(tab.id, { rewind: undefined }) } : {}),
      settings: tab,
      tools: handoffs.tools,
      onSessionId: (sessionId) => {
        // The thread belongs to the agent that started it from here on.
        if (current()) return this.updateThread(tab.id, { sessionId, agent: agent.id })
        // A parked thread keeps its session under its key, so coming back resumes it.
        const id = key && keyedId(tab.project, key)
        const parked = id ? this.state.keyed[id] : undefined
        if (id && parked) this.persist({ keyed: { ...this.state.keyed, [id]: { ...parked, sessionId, agent: agent.id } } })
      },
    })
    const created: Live = { session, handoffs }
    this.sessions.set(tab.id, created)
    return created
  }

  private closeParked(live: Live) {
    for (const [id, parked] of this.parked) {
      if (parked.live !== live) continue
      this.parked.delete(id)
      close(live)
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
    const items = await this.agent(tab).threads.history(tab.project, sessionId).catch((error) => {
      this.hooks.broadcast({ type: "error", message: `Desk could not read the thread in “${tab.title}”`, detail: errorMessage(error) })
      return []
    })
    const { turnChanges: saved = {}, rewind } = this.thread(tab.id)
    const cut = rewind ? items.findIndex((item) => item.id === rewind.from) : -1
    return (cut < 0 ? items : items.slice(0, cut)).flatMap((item) => {
      const files = item.type === "result" ? saved[resultMessage(item.id)] : undefined
      return files ? [item, changesItem(resultMessage(item.id), files)] : [item]
    })
  }

  /** A thread with no context reading gets one now, so its ring shows before its next reply. */
  private fillContext(tabId: string, sessionId: string) {
    const tab = this.state.tabs.find((found) => found.id === tabId)
    if (!tab) return
    void this.agent(tab).threads.context(tab.project, sessionId).catch(() => undefined).then((context) => {
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
    if (thread.sessionId !== before?.sessionId || thread.agent !== before?.agent) this.hooks.broadcast(sessionMessage(tabId, thread))
  }

  private persist(change: Partial<WindowState>) {
    this.state = { ...this.state, ...change }
    saveWindowState(this.state)
  }
}

/** Whether two tabs on one agent run the same way, so a save can skip reconfiguring a session. */
const sameRunSettings = (a: RunSettings, b: RunSettings) => a.model === b.model && a.effort === b.effort && !!a.fast === !!b.fast && a.permissionMode === b.permissionMode

const close = ({ session, handoffs }: Live) => {
  session.close()
  handoffs.close()
}

/** What a thread keeps when it starts over: its plugin key and the messages that wait. */
const startedOver = ({ key, queue, queueHeld }: TabThread): TabThread => ({ ...(key ? { key } : {}), ...(queue ? { queue, queueHeld } : {}) })

/** Tells the app which session a tab's thread runs in, and on which agent. A thread that has not started has neither. */
const sessionMessage = (tabId: string, thread: TabThread): CoreMessage => ({ type: "thread.session", tabId, ...(thread.sessionId ? { sessionId: thread.sessionId, ...(thread.agent ? { agent: thread.agent } : {}) } : {}) })

/** Two agents may give their sessions the same id, so a thread is told apart by both. */
const threadRef = (agent: AgentId, sessionId: string) => `${agent}\n${sessionId}`

/** What names a plugin's thread among every project's: its project and its key. Two projects' plugins can use the same key. */
const keyedId = (project: string, key: string) => `${project}\n${key}`

const changesItem = (lastMessage: string, files: readonly ChangedFile[]): ThreadItem => ({ type: "changes", id: `changes:${lastMessage}`, files })
