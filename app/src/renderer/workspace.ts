import type { RunSettings, SetupInfo, TabInfo, TerminalInfo } from "@desk/protocol"
import { createStore, produce } from "solid-js/store"
import { account } from "./account"
import { core } from "./core"

const NEW_TAB_TITLE = "New session"
const TITLE_LENGTH = 40
const PANEL_KEY = "desk.panel"

/** The window: its tabs, which one is in front, and what shows beside or instead of it. */
const [workspace, setWorkspace] = createStore({
  /** The window's tabs, as the core saves them. */
  tabs: [] as TabInfo[],
  active: "",
  /** The settings page on show in place of the active tab. Undefined shows the tab. */
  settingsPage: undefined as string | undefined,
  /** Whether the panel beside the thread is open. A per-window preference, so it lives in the page's storage. */
  panelOpen: localStorage.getItem(PANEL_KEY) === "open",
  /** Folders tabs have opened, most recent first, as the core keeps them. */
  recent: [] as readonly string[],
  /** Whether the saved tabs are back. Until then, a change to the tabs would overwrite them. */
  restored: false,
})
export { workspace }

export const activeTab = () => workspace.tabs.find((tab) => tab.id === workspace.active)

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

/** Opens a setup in a tab of its own. Its plugins choose the tab's thread. */
export function openSetup(setup: SetupInfo) {
  return addTab({ ...tabIn(setup.project), title: setup.name, setup: setup.id }, "end")
}

/** A new tab in `project`. Its thread starts on the default model and effort, and on the speed and permission mode of the tab in front. */
function tabIn(project: string): TabInfo {
  const from = activeTab()
  const { model, effort } = account.settings.claude
  return { id: crypto.randomUUID(), title: NEW_TAB_TITLE, project, terminals: [], model, effort, fast: from?.fast, permissionMode: from?.permissionMode ?? "default" }
}

function addTab(tab: TabInfo, place: "end" | "next") {
  setWorkspace(
    produce((draft) => {
      const index = place === "next" ? draft.tabs.findIndex((found) => found.id === draft.active) + 1 : draft.tabs.length
      draft.tabs.splice(index, 0, tab)
      draft.active = tab.id
      draft.settingsPage = undefined
    }),
  )
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

export function togglePanel() {
  setWorkspace({ panelOpen: !workspace.panelOpen, settingsPage: undefined })
  localStorage.setItem(PANEL_KEY, workspace.panelOpen ? "open" : "closed")
}

/** Opens a terminal in the active tab's panel, opening the panel if it is closed. */
export function newTerminal() {
  const tab = activeTab()
  if (!tab) return
  const terminal: TerminalInfo = { id: crypto.randomUUID(), title: tab.terminals.length ? `Terminal ${tab.terminals.length + 1}` : "Terminal" }
  // The panel's Tabs pick their first tab when the chosen one has no trigger yet, and report it as a change. So the terminal joins the panel first, then shows.
  setWorkspace("tabs", (found) => found.id === tab.id, { terminals: [...tab.terminals, terminal] })
  setWorkspace("tabs", (found) => found.id === tab.id, { panelActive: terminal.id })
  setWorkspace("settingsPage", undefined)
  save()
  if (!workspace.panelOpen) togglePanel()
}

/** Shows a tab's panel tab: a terminal or a setup's pinned panel, or Review when `id` is undefined. */
export function showPanelTab(tabId: string, id: string | undefined) {
  setWorkspace("tabs", (found) => found.id === tabId, { panelActive: id })
  save()
}

/** Closes a panel terminal. The core ends the shell of a terminal no tab lists. */
export function closeTerminal(id: string) {
  const tab = activeTab()
  if (!tab) return
  setWorkspace("tabs", (found) => found.id === tab.id, { terminals: tab.terminals.filter((terminal) => terminal.id !== id), panelActive: tab.panelActive === id ? undefined : tab.panelActive })
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
    showPanelTab(message.tabId, message.panel)
    if (!workspace.panelOpen) togglePanel()
  }
  else if (message.type === "tabs") {
    setWorkspace({ tabs: [...message.tabs], active: message.active ?? message.tabs[0]?.id ?? "", restored: true })
    for (const action of waiting) action()
    waiting = []
    // An empty window opens a tab, unless a command waiting for the tabs, such as `desk <folder>`, already did.
    if (workspace.tabs.length === 0) newTab()
  }
})

// A hot-swapped copy of this module would start empty, and the core does not send its state again. In development, a change here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
