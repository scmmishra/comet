import { DEFAULT_SETTINGS, type AppearanceSettings, type ClaudeAccount, type McpServer, type Skill, type ClaudeSettings, type CommandInfo, type ProjectSettings, type CommandProcess, type CommandSource, type CoreMessage, type FileChange, type ModelOption, type PlanUsage, type RunSettings, type Space, type TabInfo, type ThreadEvent, type ThreadSummary } from "@desk/protocol"
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
  /** The project folder the tab works in. It can change only before the tab's thread starts. */
  project: string
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

/** What the window knows about one project, read from the core when a tab first shows it. */
export interface ProjectData {
  /** The Space card's facts. Undefined until read, and when the folder is not a Git repo. */
  space?: Space
  /** The project's saved commands and their runs. */
  commands: readonly CommandInfo[]
  /** Commands the project's files define, for the import menu. Undefined until the core has looked. */
  commandSources?: readonly CommandSource[]
  /** The project's recent threads, for the start screen and thread search. */
  threads: readonly ThreadSummary[]
  /** Images in the project that look like its logo, for the icon picker. Undefined until asked for. */
  iconFiles?: readonly string[]
  /** The project's MCP servers. Undefined while reading, null when Claude Code could not be asked. */
  mcp?: readonly McpServer[] | null
  /** The project's skills and custom commands. Undefined while reading, null when Claude Code could not be asked. */
  skills?: readonly Skill[] | null
}

const EMPTY_PROJECT: ProjectData = { commands: [], threads: [] }

/** The settings screen's pages, in the order its sidebar lists them. */
export const SETTINGS_PAGES = ["providers", "appearance", "projects", "mcps", "skills"] as const
export type SettingsPage = (typeof SETTINGS_PAGES)[number]

const [state, setState] = createStore({
  /** The folder a new tab opens in when the window has none, as the core names it. */
  defaultProject: "",
  settings: DEFAULT_SETTINGS,
  /** The settings page on show in place of the session. Undefined shows the session. */
  settingsPage: undefined as SettingsPage | undefined,
  tabs: [] as Tab[],
  active: "",
  /** Each project a tab has shown, by folder. */
  projects: {} as Record<string, ProjectData>,
  usage: undefined as PlanUsage | undefined,
  models: [] as readonly ModelOption[],
  /** Who Claude Code is signed in as. Undefined until read, and when no one is. */
  account: undefined as ClaudeAccount | undefined,
  /** Whether the core has read the account yet, so "not signed in" is not shown while it reads. */
  accountRead: false,
  /** Whether the panel beside the thread is open. A per-window preference, so it lives in the page's storage. */
  panelOpen: localStorage.getItem(PANEL_KEY) === "open",
  connected: false,
})
export { state }

export const activeTab = () => state.tabs.find((tab) => tab.id === state.active)

/** The project the active tab works in. */
export const activeProject = () => activeTab()?.project ?? state.defaultProject

/** What the window knows about the active tab's project. */
export const activeData = (): ProjectData => state.projects[activeProject()] ?? EMPTY_PROJECT

/** Changes what the window knows about a project, starting a record for a project it has not seen. */
function updateProject(project: string, change: (data: ProjectData) => Partial<ProjectData>) {
  setState("projects", project, (data) => ({ ...(data ?? EMPTY_PROJECT), ...change(data ?? EMPTY_PROJECT) }))
}

/** Reads a project's Space card, commands and threads from the core, so its tab shows them. */
function loadProject(project: string) {
  if (!project) return
  updateProject(project, () => ({}))
  core.send({ type: "space.get", project })
  core.send({ type: "commands.get", project })
  core.send({ type: "threads.get", project })
}

/**
 * Opens a tab at the end of the bar, or right after the active tab. It works in `project`, or else in
 * the active tab's project. Returns its id.
 */
export function newTab(place: "end" | "next" = "end", project?: string): string {
  // A new thread starts on the default model and effort, and on the project, speed and permission mode of the one in front of you.
  const from = activeTab()
  const defaults = state.settings.claude
  const tab: Tab = {
    id: crypto.randomUUID(),
    title: NEW_TAB_TITLE,
    project: project ?? from?.project ?? state.defaultProject,
    items: [],
    busy: false,
    model: defaults.model,
    effort: defaults.effort,
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
  loadProject(tab.project)
  return tab.id
}

/** Shows the settings screen in place of the session, on a page. */
export function openSettings(page: SettingsPage = SETTINGS_PAGES[0]) {
  setState("settingsPage", page)
}

export function closeSettings() {
  setState("settingsPage", undefined)
}

/** Reads the project's skills and custom commands. */
export function readSkills(project: string) {
  updateProject(project, () => ({ skills: undefined }))
  core.send({ type: "skills.get", project })
}

/** Reads the project's MCP servers again. Claude Code starts them to report on them, so it takes a moment. */
export function readMcpServers(project: string) {
  updateProject(project, () => ({ mcp: undefined }))
  core.send({ type: "mcp.get", project })
}

/** Turns an MCP server on or off in the project. Claude Code keeps the choice. */
export function toggleMcpServer(project: string, name: string, enabled: boolean) {
  updateProject(project, (data) => ({ mcp: data.mcp?.map((server) => (server.name === name ? { ...server, status: "pending" } : server)) }))
  core.send({ type: "mcp.toggle", project, name, enabled })
}

/** Asks the core for the images in a project that look like its logo. */
export function findProjectIcons(project: string) {
  core.send({ type: "project.icons", project })
}

/** Changes the named settings. The core saves them and sends them back. */
export function updateSettings(change: { appearance?: Partial<AppearanceSettings>; claude?: Partial<ClaudeSettings>; project?: { dir: string; settings: ProjectSettings } }) {
  core.send({ type: "settings.update", ...change })
}

/** Moves the active tab to another project. Only a tab whose thread has not started can move. */
export function setTabProject(project: string) {
  const tab = activeTab()
  if (!tab || tab.items.length > 0 || tab.project === project) return
  setState("tabs", (found) => found.id === tab.id, "project", project)
  saveTabs()
  loadProject(project)
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
  refreshSpace()
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
  core.send({ type: "threads.get", project: activeProject() })
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
  updateProject(tab.project, (data) => ({ threads: data.threads.map((found) => (found.id === thread.id ? { ...found, tabId: tab.id } : found)) }))
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
  core.send({ type: "file.open", project: activeProject(), path, line })
}

/** Reads the active tab's project again, or loads it the first time it shows. */
export function refreshSpace() {
  const project = activeProject()
  if (!state.projects[project]) return loadProject(project)
  core.send({ type: "space.get", project })
}

export function togglePanel() {
  setState("panelOpen", !state.panelOpen)
  localStorage.setItem(PANEL_KEY, state.panelOpen ? "open" : "closed")
  refreshReview()
}

/** Looks again for commands to import. The space's files may have changed since the last look. */
export function discoverCommands() {
  const project = activeProject()
  updateProject(project, () => ({ commandSources: undefined }))
  core.send({ type: "commands.discover", project })
}

/**
 * Replaces the commands in `replacing` with `processes`. One process saves as a plain command called
 * `name`, several as a group called `name`. Adding replaces nothing.
 */
export function saveCommands(name: string, processes: readonly CommandProcess[], replacing: readonly string[]) {
  core.send({ type: "commands.save", project: activeProject(), name, processes, replacing })
}

/** Removes commands, such as every command in a group, stopping those that run. */
export function removeCommands(ids: readonly string[]) {
  core.send({ type: "commands.remove", project: activeProject(), ids })
}

export function runCommand(id: string) {
  core.send({ type: "command.run", project: activeProject(), id })
}

export function stopCommand(id: string) {
  core.send({ type: "command.stop", project: activeProject(), id })
}

/** Runs the group's commands that are not running. */
export function runGroup(group: string) {
  core.send({ type: "group.run", project: activeProject(), group })
}

export function stopGroup(group: string) {
  core.send({ type: "group.stop", project: activeProject(), group })
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
      project: tab.project,
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
      return { id: tab.id, title: tab.title, project: tab.project, items: [], busy: false, model: tab.model, effort: tab.effort, fast: tab.fast, permissionMode: tab.permissionMode, panelTabs, panelActive: tab.panelActive ?? REVIEW_TAB.id }
    }),
    active: active ?? tabs[0]!.id,
  })
  refreshReview()
  refreshSpace()
}

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0] ?? ""
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH)}…` : line || NEW_TAB_TITLE
}

core.listen((message: CoreMessage) => {
  // The active tab's project loads once the saved tabs arrive, so hello only reads what is global.
  if (message.type === "hello") {
    setState({ connected: true, defaultProject: message.project })
    refreshUsage()
    core.send({ type: "models.get" })
  } else if (message.type === "settings") setState("settings", message.settings)
  else if (message.type === "tabs") restoreTabs(message.tabs, message.active)
  else if (message.type === "space") updateProject(message.project, () => ({ space: message.space }))
  else if (message.type === "usage") setState("usage", message.usage)
  else if (message.type === "models") setState("models", message.models)
  else if (message.type === "account") setState({ account: message.account, accountRead: true })
  else if (message.type === "threads") updateProject(message.project, () => ({ threads: message.threads }))
  else if (message.type === "commands") updateProject(message.project, () => ({ commands: message.commands }))
  else if (message.type === "skills") updateProject(message.project, () => ({ skills: message.skills ?? null }))
  else if (message.type === "mcp") updateProject(message.project, () => ({ mcp: message.servers ?? null }))
  else if (message.type === "project.icons") updateProject(message.project, () => ({ iconFiles: message.files }))
  else if (message.type === "commands.found") updateProject(message.project, () => ({ commandSources: message.sources }))
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
