import type { ReviewScope, RunSettings, TabInfo, TerminalInfo } from "@desk/protocol"
import { permissionFor } from "./models"
import { createStore, produce } from "solid-js/store"
import { account } from "./account"
import { core } from "./core"
import { applySetup, plugins } from "./plugins"

const NEW_TAB_TITLE = "New session"
const TITLE_LENGTH = 40

/** The window: its tabs, which one is in front, and what shows beside or instead of it. */
const [workspace, setWorkspace] = createStore({
  /** The window's tabs, as the core saves them. */
  tabs: [] as TabInfo[],
  active: "",
  /** The settings page on show in place of the active tab. Undefined shows the tab. */
  settingsPage: undefined as string | undefined,
  /** Folders tabs have opened, most recent first, as the core keeps them. */
  recent: [] as readonly string[],
  /** Whether the saved tabs are back. Until then, a change to the tabs would overwrite them. */
  restored: false,
})
export { workspace }

export const activeTab = () => workspace.tabs.find((tab) => tab.id === workspace.active)

/**
 * The view pane tab a tab shows: a terminal's id or an open plugin panel's, or undefined for Review.
 * A choice whose terminal or panel has closed, such as a panel the plugin closed, shows Review.
 */
export function shownPanelTab(tab: TabInfo): string | undefined {
  const chosen = tab.panelActive
  const open = tab.terminals.some((terminal) => terminal.id === chosen) || !!plugins.layouts[tab.id]?.panels.some((panel) => panel.id === chosen)
  return open ? chosen : undefined
}

/** The tab on show: the active tab, unless Settings shows in its place. */
export const shownTab = () => (workspace.settingsPage ? undefined : activeTab())

/** The project the window works in: the active tab's, else the most recent one. */
export const activeProject = () => activeTab()?.project ?? workspace.recent[0] ?? ""

/** Each project open in a tab, once, in the order its first tab sits. */
export const openProjects = () => [...new Set(workspace.tabs.map((tab) => tab.project))]

/** Whether a tab still has the name a new tab gets. */
export const isUntitled = (tab: TabInfo) => tab.title === NEW_TAB_TITLE

let waiting: (() => void)[] = []
/** Runs `action` once the saved tabs are back, so it never acts on an empty window. */
export function whenRestored(action: () => void) {
  if (workspace.restored) action()
  else waiting.push(action)
}

/**
 * Opens a tab at the end of the bar, or right after the active tab, and returns its id. It works in
 * `project`, or else in the active tab's project. A window with no project yet asks for a folder instead.
 */
export function newTab(place: "end" | "next" = "end", project = activeProject()): string | undefined {
  if (!project) return void openFolder()
  return addTab(tabIn(project), place)
}

/** Opens a plugin's setup in a tab of its own, in `project`. The core lays the tab out once it is saved. */
export function openSetup(project: string, setup: { readonly id: string; readonly title: string }) {
  const tabId = addTab({ ...tabIn(project), title: setup.title }, "end")
  applySetup(tabId, setup.id)
}

/** A new tab in `project`. Its thread starts on the default model, effort and permission mode, and on the speed of the tab in front. */
function tabIn(project: string): TabInfo {
  const from = activeTab()
  const { model, effort, permissionMode } = account.settings.claude
  const option = account.models.find((found) => found.value === model)
  return { id: crypto.randomUUID(), title: NEW_TAB_TITLE, project, terminals: [], model, effort, fast: from?.fast, permissionMode: permissionFor(option, permissionMode) }
}

function addTab(tab: TabInfo, place: "end" | "next") {
  // The tab is saved before it shows, because a shown tab asks the core for its layout, and the core knows only saved tabs.
  setWorkspace(
    produce((draft) => {
      const index = place === "next" ? draft.tabs.findIndex((found) => found.id === draft.active) + 1 : draft.tabs.length
      draft.tabs.splice(index, 0, tab)
    }),
  )
  save()
  setWorkspace({ active: tab.id, settingsPage: undefined })
  save()
  return tab.id
}

/** Asks for a folder and opens a tab in it. */
export async function openFolder() {
  const dir = await window.desk.chooseFolder()
  if (dir) newTab("end", dir)
}

/** Closes a tab. The core ends its session and shells once the tabs are saved. A window keeps at least one tab. */
export function closeTab(id: string) {
  setWorkspace(
    produce((draft) => {
      const index = draft.tabs.findIndex((tab) => tab.id === id)
      if (index < 0) return
      draft.tabs.splice(index, 1)
      if (draft.active === id) draft.active = draft.tabs[Math.max(0, index - 1)]?.id ?? ""
      draft.settingsPage = undefined
    }),
  )
  if (workspace.tabs.length === 0) newTab()
  else save()
}

/** Brings a tab to the front. Settings close, so the tab shows. */
export function showTab(id: string) {
  setWorkspace({ active: id, settingsPage: undefined })
  save()
}

export function showTabAt(index: number) {
  const tab = workspace.tabs[index]
  if (tab) showTab(tab.id)
}

/** Shows a settings page in place of the active tab. */
export function openSettings(page: string) {
  setWorkspace("settingsPage", page)
}

export function closeSettings() {
  setWorkspace("settingsPage", undefined)
}

export function changeTab(tabId: string, change: Partial<Pick<TabInfo, "project" | keyof RunSettings>>) {
  setWorkspace("tabs", (tab) => tab.id === tabId, change)
  save()
}

/** Names a tab after the start of `text`. */
export function nameTab(tabId: string, text: string) {
  const line = text.trim().split("\n")[0] ?? ""
  setWorkspace("tabs", (tab) => tab.id === tabId, { title: line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH)}…` : line || NEW_TAB_TITLE })
  save()
}

/** Opens or closes a tab's view pane. Each tab keeps its own. */
export function setPanelOpen(tabId: string, open: boolean) {
  setWorkspace("tabs", (found) => found.id === tabId, { panelOpen: open })
  setWorkspace("settingsPage", undefined)
  save()
}

/** Opens the active tab's view pane on Review, comparing with `scope`. */
export function openReview(scope: ReviewScope) {
  const tab = activeTab()
  if (!tab) return
  setWorkspace("tabs", (found) => found.id === tab.id, { panelOpen: true, panelActive: undefined, reviewScope: scope })
  setWorkspace("settingsPage", undefined)
  save()
}

/** Opens or closes the active tab's view pane. */
export function togglePanel() {
  const tab = activeTab()
  if (tab) setPanelOpen(tab.id, !tab.panelOpen)
}

/** Opens a terminal in the active tab's panel, opening the panel if it is closed. */
export function newTerminal() {
  const tab = activeTab()
  if (!tab) return
  const terminal: TerminalInfo = { id: crypto.randomUUID(), title: tab.terminals.length ? `Terminal ${tab.terminals.length + 1}` : "Terminal" }
  setWorkspace("tabs", (found) => found.id === tab.id, { terminals: [...tab.terminals, terminal], panelActive: terminal.id })
  setPanelOpen(tab.id, true)
}

/** Shows a tab's panel tab: a terminal or a plugin panel, or Review when `id` is undefined. */
/** Sets what a tab's Review compares with. */
export function setReviewScope(tabId: string, scope: ReviewScope) {
  setWorkspace("tabs", (found) => found.id === tabId, { reviewScope: scope })
  save()
}

export function showPanelTab(tabId: string, id: string | undefined) {
  setWorkspace("tabs", (found) => found.id === tabId, { panelActive: id })
  save()
}

/** Closes a panel terminal. The core ends the shell of a terminal no tab lists. */
export function closeTerminal(tabId: string, id: string) {
  const tab = workspace.tabs.find((found) => found.id === tabId)
  if (!tab) return
  setWorkspace("tabs", (found) => found.id === tabId, { terminals: tab.terminals.filter((terminal) => terminal.id !== id) })
  save()
}

/** The core saves the tabs, so Desk reopens with the same tabs and panel terminals. */
function save() {
  if (workspace.restored) core.send({ type: "tabs.save", tabs: workspace.tabs, active: workspace.active })
}

core.listen((message) => {
  if (message.type === "recent") setWorkspace("recent", message.projects)
  else if (message.type === "tab.title") nameTab(message.tabId, message.title)
  else if (message.type === "panel.show") {
    showPanelTab(message.tabId, message.id)
    setPanelOpen(message.tabId, true)
  } else if (message.type === "tabs") {
    setWorkspace({ tabs: [...message.tabs], active: message.active ?? message.tabs[0]?.id ?? "", restored: true })
    for (const action of waiting) action()
    waiting = []
    // An empty window opens a tab, unless a command waiting for the tabs, such as `desk <folder>`, already did.
    if (workspace.tabs.length === 0) newTab()
  }
})

// A hot-swapped copy of this module would start empty, and the core does not send its state again. In development, a change here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
