import type { ContextReading, FileChange, ThreadEvent, ThreadItem, ThreadSummary } from "@desk/protocol"
import { createEffect, createMemo, createRoot, on } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { core } from "./core"
import { readProject } from "./projects"
import { activeTab, isUntitled, nameTab, newTab, shownTab, showTab, workspace } from "./workspace"

/** `arrivedAt` is when an item arrived live, from performance.now(). Items replayed from a transcript have none. */
export type Item = ThreadItem & { arrivedAt?: number }

/** What a tab's thread shows. The core sends it; nothing here is saved. */
export interface Thread {
  items: Item[]
  busy: boolean
  /** The model that ran, as the session reported it. */
  model?: string
  context?: ContextReading
  /** The files the thread changed. Undefined until asked for. */
  review?: readonly FileChange[]
}

/** What a tab with no thread yet shows. A tab that gets a thread gets a record of its own. */
const EMPTY: Thread = Object.freeze({ items: Object.freeze([]) as unknown as Item[], busy: false })

const [threads, setThreads] = createStore<Record<string, Thread>>({})

export const threadOf = (tabId: string): Thread => threads[tabId] ?? EMPTY

/** Starts a tab's thread record the first time something arrives for it. */
const ensure = (tabId: string) => setThreads(tabId, (thread) => thread ?? { items: [], busy: false })

/** Sends a message in a tab. A tab with no name takes it from the message. */
export function send(tabId: string, text: string) {
  const tab = workspace.tabs.find((found) => found.id === tabId)
  if (tab && isUntitled(tab)) nameTab(tabId, text)
  core.send({ type: "session.send", tabId, text })
}

export function interrupt(tabId: string) {
  if (threadOf(tabId).busy) core.send({ type: "session.interrupt", tabId })
}

export function answerPermission(tabId: string, requestId: string, allow: boolean) {
  core.send({ type: "permission.answer", tabId, requestId, allow })
}

/**
 * Shows a past thread of `project`: its tab if one has it open, else the active tab when that tab
 * works in the project and has not started a thread, else a new tab in the project.
 */
export function openThread(thread: ThreadSummary, project: string) {
  if (thread.tabId) return showTab(thread.tabId)
  const active = activeTab()
  const tabId = active?.project === project && !threadOf(active.id).items.length ? active.id : newTab("end", project)
  if (!tabId) return
  showTab(tabId)
  nameTab(tabId, thread.title)
  core.send({ type: "thread.resume", tabId, threadId: thread.id })
  readProject(project, "threads")
}

/** Asks for a tab's changes when the panel shows Review. */
function readReview(tabId: string) {
  core.send({ type: "review.get", tabId })
}

/** Applies a change to a tab's thread. An item replaces the one with its id, or joins after the others. */
function apply(tabId: string, event: ThreadEvent, arrivedAt?: number) {
  ensure(tabId)
  setThreads(
    tabId,
    produce((thread) => {
      if (event.kind === "item") {
        const index = thread.items.findIndex((item) => item.id === event.item.id)
        if (index < 0) thread.items.push({ ...event.item, arrivedAt })
        else thread.items[index] = { ...event.item, arrivedAt: thread.items[index]!.arrivedAt }
      } else if (event.kind === "text.delta") {
        const item = thread.items.find((found) => found.id === event.id)
        if (item?.type === "text") thread.items[thread.items.indexOf(item)] = { ...item, text: item.text + event.delta }
      } else if (event.kind === "status") thread.busy = event.busy
      else if (event.kind === "init") thread.model = event.model
      else if (event.kind === "context") thread.context = event.reading
    }),
  )
  // A finished turn may have changed files, so the Space card and Review read the repo again.
  if (event.kind === "item" && event.item.type === "result") {
    const tab = workspace.tabs.find((found) => found.id === tabId)
    if (tab) readProject(tab.project, "space")
    if (tabId === reviewShown()) readReview(tabId)
  }
}

core.listen((message) => {
  if (message.type === "session.event") apply(message.tabId, message.event, performance.now())
  else if (message.type === "session.history") setThreads(message.tabId, { items: [...message.items], busy: false, context: message.context })
  else if (message.type === "review") {
    ensure(message.tabId)
    setThreads(message.tabId, "review", message.files)
  }
})

/** The tab whose Review is on screen, if one is. Review reads the tab's changes whenever it comes into view. */
const reviewShown = createRoot(() => {
  const shown = createMemo(() => {
    const tab = shownTab()
    return tab && workspace.panelOpen && tab.panelActive === undefined ? tab.id : undefined
  })
  createEffect(on(shown, (tabId) => tabId && readReview(tabId)))
  return shown
})

// A hot-swapped copy of this module would start empty, and the core does not send its state again. In development, a change here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
