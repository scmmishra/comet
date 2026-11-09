import { DEFAULT_MODEL, type CoreMessage, type FileChange, type ModelOption, type PlanUsage, type RunSettings, type Space, type TabInfo, type ThreadEvent, type ThreadSummary } from "@desk/protocol"
import { batch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { core } from "./core"

/** `arrivedAt` is when an item arrived live, from performance.now(). Items replayed from a transcript have none. */
export type Item = { arrivedAt?: number } & (
  | { readonly type: "user"; readonly id: string; readonly text: string; readonly at?: number }
  | { readonly type: "text"; readonly id: string; text: string; done: boolean; at?: number }
  | { readonly type: "thinking"; readonly id: string }
  | { readonly type: "tool"; readonly id: string; readonly name: string; readonly input: Record<string, unknown>; result?: { readonly output: string; readonly isError: boolean } }
  | { readonly type: "permission"; readonly id: string; readonly requestId: string; readonly tool: string; readonly input: Record<string, unknown>; answer?: boolean }
  | { readonly type: "result"; readonly id: string; readonly durationMs: number; readonly isError: boolean }
  | { readonly type: "error"; readonly id: string; readonly message: string }
)

/** A tab's run settings are writable here, so the picker can change them. */
type Writable<T> = { -readonly [K in keyof T]: T[K] }

export interface Tab extends Writable<RunSettings> {
  readonly id: string
  title: string
  items: Item[]
  busy: boolean
  /** The model that ran, as the session reported it. */
  resolvedModel?: string
  context?: { percent: number; tokens: number; maxTokens: number }
  /** The files this tab's thread changed. Undefined until asked for. */
  review?: FileChange[]
  /** The panel's tabs for this tab: Review first, then terminals. */
  panelTabs: PanelTab[]
  panelActive: string
}

export type PanelTab = { readonly kind: "review"; readonly id: "review" } | { readonly kind: "terminal"; readonly id: string; readonly title: string }

const REVIEW_TAB: PanelTab = { kind: "review", id: "review" }

const NEW_TAB_TITLE = "New session"
const PANEL_KEY = "desk.panel"
const TITLE_LENGTH = 40

const [state, setState] = createStore({
  /** The project folder this window shows, as the core names it. */
  project: "",
  tabs: [] as Tab[],
  active: "",
  space: undefined as Space | undefined,
  usage: undefined as PlanUsage | undefined,
  models: [] as readonly ModelOption[],
  /** The space's recent threads, for the start screen and thread search. */
  threads: [] as readonly ThreadSummary[],
  /** Whether the panel beside the thread is open. A per-window preference, so it lives in the page's storage. */
  panelOpen: localStorage.getItem(PANEL_KEY) === "open",
  connected: false,
})
export { state }

export const activeTab = () => state.tabs.find((tab) => tab.id === state.active)

/** Opens a tab at the end of the bar, or right after the active tab. Returns its id. */
export function newTab(place: "end" | "next" = "end"): string {
  // A new thread starts on the model and effort of the one in front of you.
  const from = activeTab()
  const tab: Tab = {
    id: crypto.randomUUID(),
    title: NEW_TAB_TITLE,
    items: [],
    busy: false,
    model: from?.model ?? DEFAULT_MODEL,
    effort: from?.effort,
    fast: from?.fast,
    permissionMode: from?.permissionMode ?? "default",
    panelTabs: [REVIEW_TAB],
    panelActive: REVIEW_TAB.id,
  }
  setState(produce((draft) => {
    const index = place === "next" ? draft.tabs.findIndex((found) => found.id === draft.active) + 1 : draft.tabs.length
    draft.tabs.splice(index, 0, tab)
    draft.active = tab.id
  }))
  saveTabs()
  return tab.id
}

export function closeTab(id: string) {
  core.send({ type: "session.close", sessionId: id })
  setState(produce((draft) => {
    const index = draft.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    draft.tabs.splice(index, 1)
    if (draft.active === id) draft.active = draft.tabs[Math.max(0, index - 1)]?.id ?? ""
  }))
  if (state.tabs.length === 0) newTab()
  else saveTabs()
}

export function selectTab(id: string) {
  setState("active", id)
  saveTabs()
  refreshReview()
}

export function selectTabAt(index: number) {
  const tab = state.tabs[index]
  if (tab) selectTab(tab.id)
}

export function send(text: string) {
  const tab = activeTab()
  if (!tab) return
  if (tab.title === NEW_TAB_TITLE) {
    setState("tabs", (found) => found.id === tab.id, "title", titleFrom(text))
    saveTabs()
  }
  core.send({ type: "session.send", sessionId: tab.id, text })
}

/** Changes how the active tab's thread runs. A running thread takes the change from its next reply. */
export function updateRunSettings(change: Partial<RunSettings>) {
  const tab = activeTab()
  if (!tab) return
  setState("tabs", (found) => found.id === tab.id, change)
  saveTabs()
}

export function refreshThreads() {
  core.send({ type: "threads.get" })
}

/**
 * Shows a past thread: its tab if one has it open, else the active tab when that tab has not started
 * a thread, else a new tab. Its history follows from the core.
 */
export function openThread(thread: ThreadSummary) {
  if (thread.tabId) return selectTab(thread.tabId)
  if (activeTab()?.items.length !== 0) newTab()
  const tab = activeTab()!
  setState("tabs", (found) => found.id === tab.id, "title", titleFrom(thread.title))
  setState("threads", (threads) => threads.map((found) => (found.id === thread.id ? { ...found, tabId: tab.id } : found)))
  saveTabs()
  core.send({ type: "thread.resume", sessionId: tab.id, threadId: thread.id })
}

export function interrupt() {
  const tab = activeTab()
  if (tab?.busy) core.send({ type: "session.interrupt", sessionId: tab.id })
}

export function answerPermission(id: string, allow: boolean) {
  const tab = activeTab()
  if (tab) core.send({ type: "permission.answer", sessionId: tab.id, id, allow })
}

export function openFile(path: string, line?: number) {
  core.send({ type: "file.open", path, line })
}

export function refreshSpace() {
  core.send({ type: "space.get" })
}

export function togglePanel() {
  setState("panelOpen", !state.panelOpen)
  localStorage.setItem(PANEL_KEY, state.panelOpen ? "open" : "closed")
  refreshReview()
}

/** Opens a terminal in the active tab's panel, opening the panel if it is closed. */
export function newTerminal() {
  const tab = activeTab()
  if (!tab) return
  const id = crypto.randomUUID()
  const count = tab.panelTabs.filter((panelTab) => panelTab.kind === "terminal").length
  setState("tabs", (found) => found.id === tab.id, produce((draft) => {
    draft.panelTabs.push({ kind: "terminal", id, title: count ? `Terminal ${count + 1}` : "Terminal" })
    draft.panelActive = id
  }))
  saveTabs()
  if (!state.panelOpen) togglePanel()
}

export function selectPanelTab(id: string) {
  const tab = activeTab()
  if (!tab) return
  setState("tabs", (found) => found.id === tab.id, "panelActive", id)
  saveTabs()
  if (id === REVIEW_TAB.id) refreshReview()
}

export function closePanelTab(id: string) {
  const tab = activeTab()
  if (!tab || id === REVIEW_TAB.id) return
  setState("tabs", (found) => found.id === tab.id, produce((draft) => {
    draft.panelTabs = draft.panelTabs.filter((panelTab) => panelTab.id !== id)
    if (draft.panelActive === id) draft.panelActive = REVIEW_TAB.id
  }))
  // The core ends the shell of a terminal the saved tabs no longer list.
  saveTabs()
}

/** Asks for the active tab's changes, when the panel is open to show them. */
export function refreshReview() {
  if (state.panelOpen && state.active) core.send({ type: "review.get", sessionId: state.active })
}

/** The core probes plan usage at most once a minute, so asking often is cheap. */
export function refreshUsage() {
  core.send({ type: "usage.get" })
}

/**
 * The core saves the tabs per space, so Desk reopens with the same tabs and panel terminals. A reload
 * reattaches each terminal to its running shell. After a restart, each one starts a new shell.
 */
function saveTabs() {
  core.send({
    type: "tabs.save",
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      terminals: tab.panelTabs.flatMap((panelTab) => (panelTab.kind === "terminal" ? [{ id: panelTab.id, title: panelTab.title }] : [])),
      panelActive: tab.panelActive === REVIEW_TAB.id ? undefined : tab.panelActive,
      model: tab.model,
      effort: tab.effort,
      fast: tab.fast,
      permissionMode: tab.permissionMode,
    })),
    active: state.active,
  })
}

/** Puts back the tabs the core saved. Their threads follow as session events. */
function restoreTabs(tabs: readonly TabInfo[], active: string | undefined) {
  if (tabs.length === 0) {
    newTab()
    return
  }
  setState({
    tabs: tabs.map((tab) => {
      const panelTabs: PanelTab[] = [REVIEW_TAB, ...tab.terminals.map((terminal) => ({ kind: "terminal" as const, ...terminal }))]
      return { id: tab.id, title: tab.title, items: [], busy: false, model: tab.model, effort: tab.effort, fast: tab.fast, permissionMode: tab.permissionMode, panelTabs, panelActive: tab.panelActive ?? REVIEW_TAB.id }
    }),
    active: active ?? tabs[0]!.id,
  })
  refreshReview()
}

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0] ?? ""
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH)}…` : line || NEW_TAB_TITLE
}

core.listen((message: CoreMessage) => {
  if (message.type === "hello") {
    setState({ connected: true, project: message.dir })
    refreshSpace()
    refreshUsage()
    core.send({ type: "models.get" })
  } else if (message.type === "tabs") restoreTabs(message.tabs, message.active)
  else if (message.type === "space") setState("space", message.space)
  else if (message.type === "usage") setState("usage", message.usage)
  else if (message.type === "models") setState("models", message.models)
  else if (message.type === "threads") setState("threads", message.threads)
  else if (message.type === "review") setState("tabs", (tab) => tab.id === message.sessionId, "review", [...message.files])
  else if (message.type === "session.event") apply(message.sessionId, message.event, performance.now())
  else if (message.type === "session.history") batch(() => message.events.forEach((event) => apply(message.sessionId, event)))
})

function apply(sessionId: string, event: ThreadEvent, arrivedAt?: number) {
  setState("tabs", (tab) => tab.id === sessionId, produce((tab) => {
    const items = tab.items
    const before = items.length
    const find = (id: string) => items.find((item) => item.id === id)
    switch (event.kind) {
      case "user":
        items.push({ type: "user", id: event.id, text: event.text, at: event.at })
        break
      case "text": {
        const found = find(event.id)
        if (found?.type === "text") {
          found.text = event.text || found.text
          found.done = event.done
          found.at = event.at
        } else items.push({ type: "text", id: event.id, text: event.text, done: event.done, at: event.at })
        break
      }
      case "text.delta": {
        const found = find(event.id)
        if (found?.type === "text") found.text += event.delta
        break
      }
      case "thinking":
        items.push({ type: "thinking", id: event.id })
        break
      case "tool":
        items.push({ type: "tool", id: event.id, name: event.name, input: event.input })
        break
      case "tool.result": {
        const found = find(event.id)
        if (found?.type === "tool") found.result = { output: event.output, isError: event.isError }
        break
      }
      case "permission":
        items.push({ type: "permission", id: `permission:${event.id}`, requestId: event.id, tool: event.tool, input: event.input })
        break
      case "permission.resolved": {
        const found = find(`permission:${event.id}`)
        if (found?.type === "permission") found.answer = event.allowed
        break
      }
      case "result":
        items.push({ type: "result", id: event.id, durationMs: event.durationMs, isError: event.isError })
        break
      case "error":
        items.push({ type: "error", id: event.id, message: event.message })
        break
      case "status":
        tab.busy = event.busy
        break
      case "init":
        tab.resolvedModel = event.model
        break
      case "context":
        tab.context = { percent: event.percent, tokens: event.tokens, maxTokens: event.maxTokens }
        break
    }
    for (const item of items.slice(before)) item.arrivedAt = arrivedAt
  }))
  // A finished turn may have changed files, so the Space card and Review read the repo again.
  if (event.kind === "result") {
    refreshSpace()
    if (sessionId === state.active) refreshReview()
  }
}

// The core sends the saved tabs once, on connect. A hot-swapped copy of this module would start with
// none, and its next save would overwrite them. In development, a change here reloads the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
