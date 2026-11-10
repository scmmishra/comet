/** Messages between the Desk app and the core, sent as JSON over one WebSocket. */

/** The line the core prints on stdout once it listens, so the app knows where to connect. */
export interface CoreReady {
  readonly port: number
}

/** How full a thread's context window is. */
export interface ContextReading {
  readonly percent: number
  readonly tokens: number
  readonly maxTokens: number
}

/** The before and after text of one edit a tool made. */
export interface TextEdit {
  readonly before: string
  readonly after: string
}

/**
 * One item of a thread, shaped for drawing. The core turns the Agent SDK's messages into these, so the
 * app never reads SDK types or tool inputs. Items are told apart by id within their thread.
 */
export type ThreadItem =
  /** `at` is when it was sent, in milliseconds since the epoch, when that is known. */
  | { readonly type: "user"; readonly id: string; readonly text: string; readonly at?: number }
  /** Assistant text. `at` is when it finished. Text still streaming is not done and has none. */
  | { readonly type: "text"; readonly id: string; readonly text: string; readonly done: boolean; readonly at?: number }
  | { readonly type: "thinking"; readonly id: string }
  /**
   * A tool call. `summary` is what it was given in short, such as its command or path, relative to the
   * project. A call that edits a file carries the file's path and its edits.
   */
  | {
      readonly type: "tool"
      readonly id: string
      readonly name: string
      readonly summary: string
      readonly file?: string
      readonly edits?: readonly TextEdit[]
      readonly result?: { readonly output: string; readonly isError: boolean }
    }
  /** A tool call waiting for the user. `detail` is its input in full. `requestId` answers it. */
  | { readonly type: "permission"; readonly id: string; readonly requestId: string; readonly tool: string; readonly detail: string; readonly answer?: boolean }
  /** The end of a turn. */
  | { readonly type: "result"; readonly id: string; readonly durationMs: number; readonly isError: boolean }
  | { readonly type: "error"; readonly id: string; readonly message: string }

/** A change to a thread. An item replaces the item with the same id, or joins the thread after the others. */
export type ThreadEvent =
  | { readonly kind: "item"; readonly item: ThreadItem }
  /** More text for a text item still streaming. */
  | { readonly kind: "text.delta"; readonly id: string; readonly delta: string }
  | { readonly kind: "status"; readonly busy: boolean }
  /** The model that runs, as the session reports it. */
  | { readonly kind: "init"; readonly model: string }
  /** Read after each turn. */
  | { readonly kind: "context"; readonly reading: ContextReading }

/** The repo and branch a project is on, for the Space card. */
export interface Space {
  readonly name: string
  readonly root: string
  readonly branch: string
  /** Commits ahead of and behind the upstream branch, when there is one. */
  readonly upstream?: { readonly ahead: number; readonly behind: number }
  /** Uncommitted changes against HEAD, untracked files included. */
  readonly changes: { readonly files: number; readonly additions: number; readonly deletions: number }
  /** The branch's pull request, when `gh` finds one. */
  readonly pr?: {
    readonly number: number
    readonly title: string
    readonly url: string
    readonly state: "OPEN" | "CLOSED" | "MERGED"
    readonly draft: boolean
    readonly checks: { readonly passed: number; readonly failed: number; readonly pending: number }
  }
}

/** One file a thread changed, with its unified diff. */
export interface FileChange {
  readonly path: string
  readonly status: "added" | "modified" | "deleted" | "renamed"
  readonly additions: number
  readonly deletions: number
  /** The unified diff of this file. Empty for binary files. */
  readonly patch: string
}

/** One plan usage window, such as the 5-hour session limit. */
export interface UsageWindow {
  readonly id: "five_hour" | "seven_day"
  readonly label: string
  /** Percentage used, 0–100. */
  readonly percent: number
  readonly resetsAt?: string
}

/** Plan usage. It has at least one window. */
export interface PlanUsage {
  readonly windows: readonly [UsageWindow, ...UsageWindow[]]
}

/** Claude Code's own default model, as a ModelOption value. */
export const DEFAULT_MODEL = "default"

/** How much Claude thinks before it answers, from least to most. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const
export type Effort = (typeof EFFORTS)[number]

/**
 * How Claude Code handles tool calls, as T3 Code names them: Supervised asks first, Auto-accept edits
 * lets edits through, Auto lets a classifier decide, and Full access never asks.
 */
export type PermissionMode = "default" | "acceptEdits" | "auto" | "bypassPermissions"

/** How a tab's thread runs. A change applies to a running thread from its next reply. */
export interface RunSettings {
  /** The model, as a ModelOption value. */
  readonly model: string
  /** Absent means the model's default effort. */
  readonly effort?: Effort
  /** Fast mode, on a model that has it. */
  readonly fast?: boolean
  readonly permissionMode: PermissionMode
}

/** A model Claude Code offers the account, as its /model menu lists it. */
export interface ModelOption {
  /** What a session is started with, such as "opus". "default" is Claude Code's own default. */
  readonly value: string
  readonly label: string
  readonly description: string
  /** The model that runs, such as "claude-opus-5-5". */
  readonly resolvedModel?: string
  /** The effort levels the model takes. Empty when it takes none. */
  readonly efforts: readonly Effort[]
  /** The effort Claude Code uses when the tab sets none, after the user's own settings. */
  readonly defaultEffort?: Effort
  /** Whether the model has fast mode. */
  readonly fast: boolean
  /** Whether the model takes the Auto permission mode. */
  readonly autoMode: boolean
}

/** A past thread in a project, as Claude Code saved it. */
export interface ThreadSummary {
  /** Claude's session id, which resumes the thread. */
  readonly id: string
  readonly title: string
  readonly branch?: string
  /** Milliseconds since the epoch. */
  readonly updatedAt: number
  /** The tab that has the thread open, if one does. */
  readonly tabId?: string
}

/** How the window draws itself. Auto follows the system. */
export const THEMES = ["dark", "light", "auto"] as const
export type ThemeChoice = (typeof THEMES)[number]

/** Thread text sizes Desk allows, in px. Outside them, text either crowds or no longer fits a line. */
export const FONT_SIZES = { min: 11, max: 20 } as const

export interface AppearanceSettings {
  readonly theme: ThemeChoice
  /** Thread text, in px. Code and the composer follow it. */
  readonly fontSize: number
  /** A CSS font family list for the interface. Empty means Desk's own. */
  readonly uiFont: string
  /** A CSS font family list for code and terminals. Empty means Desk's own. */
  readonly codeFont: string
}

/** What a new tab starts Claude with. */
export interface ClaudeSettings {
  /** A ModelOption value. */
  readonly model: string
  /** Absent means the model's default effort. */
  readonly effort?: Effort
  /** Compacts a thread's context once it has sat idle, so picking it up again starts small. */
  readonly compactIdle: boolean
}

/** The colors a project's avatar can take, as @opencode/ui's ProjectAvatar names them. */
export const PROJECT_COLORS = ["orange", "yellow", "cyan", "green", "red", "pink", "blue", "purple", "gray"] as const
export type ProjectColor = (typeof PROJECT_COLORS)[number]

/** How a project shows in tabs and menus. Each is optional; without it, Desk uses the folder's. */
export interface ProjectSettings {
  readonly name?: string
  readonly color?: ProjectColor
  /** An image in the project to use as its icon, as a path relative to its folder. */
  readonly icon?: string
}

/** The Claude account Claude Code is signed in with, as it reports it. */
export interface ClaudeAccount {
  readonly email?: string
  readonly organization?: string
  /** Such as "max" or "pro". Absent with an API key. */
  readonly plan?: string
  /** "firstParty" for Anthropic. Other values, such as "bedrock", mean the account lives with that cloud. */
  readonly apiProvider?: string
  /** Set when Claude Code signs in with an API key, naming where the key comes from. */
  readonly apiKeySource?: string
}

/** An MCP server Claude Code loads in a project, and how its connection stands. */
export interface McpServer {
  readonly name: string
  readonly status: "connected" | "failed" | "needs-auth" | "pending" | "disabled"
  /** Where it is configured, as Claude Code names it, such as "user" or "project". */
  readonly scope?: string
  /** Whether it is configured for this project only, rather than for every project. */
  readonly ownProject: boolean
  /** What the server runs: its command, or its URL. */
  readonly target?: string
  /** The tools it offers, when connected. */
  readonly tools: number
  /** Why it failed, when it did. */
  readonly error?: string
}

/** A skill or custom command Claude Code offers in a project. The core lists skills grouped by `group`, in order. */
export interface Skill {
  /** What follows the slash, such as "pdf" or "figma:figma-use". */
  readonly name: string
  readonly description: string
  /** Whether it lives in this project, rather than being available to every project. */
  readonly ownProject: boolean
  /** Where a skill available to every project comes from, such as "User" or "Plugin: figma". */
  readonly group: string
}

export interface DeskSettings {
  readonly appearance: AppearanceSettings
  readonly claude: ClaudeSettings
  /** By project folder. */
  readonly projects: Readonly<Record<string, ProjectSettings>>
}

/** Desk's settings before anyone changes them. The app uses them until the core sends the saved ones. */
export const DEFAULT_SETTINGS: DeskSettings = {
  appearance: { theme: "dark", fontSize: 14, uiFont: "", codeFont: "" },
  claude: { model: DEFAULT_MODEL, compactIdle: false },
  projects: {},
}

/**
 * A change to the settings. Named fields change and the rest stay. JSON has no undefined, so null
 * clears an optional field. A project's settings replace what the project had.
 */
export interface SettingsChange {
  readonly appearance?: Partial<AppearanceSettings>
  readonly claude?: Partial<Omit<ClaudeSettings, "effort">> & { readonly effort?: Effort | null }
  readonly project?: { readonly dir: string; readonly settings: ProjectSettings }
}

/** A command saved for a project, such as a dev server. The core runs it in the background. */
export interface SpaceCommand {
  readonly id: string
  readonly name: string
  /** A shell command line, run in the project's folder. */
  readonly command: string
  /** Commands that share a group show as one row and run and stop together, as Rune's did. */
  readonly group?: string
}

/**
 * Where a command's last run stands. A command not run since the core started is idle. Stop makes it
 * idle again, so only a command that exits on its own reports exited or failed.
 */
export type CommandRun =
  | { readonly state: "idle" }
  | { readonly state: "running" }
  | { readonly state: "exited" }
  | { readonly state: "failed"; readonly code: number }

/** A process in the command editor. `id` is the saved command it replaces, when it replaces one. */
export interface CommandProcess {
  readonly id?: string
  readonly name: string
  readonly command: string
}

export interface CommandInfo extends SpaceCommand {
  readonly run: CommandRun
}

/** A file in a project that defines commands, such as a Procfile, and the commands found in it. */
export interface CommandSource {
  /** What the menu calls it, such as "Procfile.dev" or "package.json". */
  readonly name: string
  readonly commands: readonly { readonly name: string; readonly command: string }[]
}

/**
 * What Desk reads about a project, by part. The app asks for a part and the core answers with a
 * `project` message. Commands are sent again whenever they change, such as a command's run. MCP
 * servers are sent again while they connect, to the client that asked.
 */
export interface ProjectParts {
  /** Null when the folder is not a Git repo. */
  readonly space: Space | null
  readonly commands: readonly CommandInfo[]
  /** Commands the project's files define, for the import menu. */
  readonly commandSources: readonly CommandSource[]
  /** The project's recent threads, open in a tab or not. */
  readonly threads: readonly ThreadSummary[]
  /** Images in the project that look like its logo, as paths relative to it. The core serves each at `/project-icon`. */
  readonly icons: readonly string[]
  /** Null when Claude Code could not be asked. Reading starts the servers, so it takes a few seconds. */
  readonly mcp: readonly McpServer[] | null
  /** Skills and custom commands. Null when Claude Code could not be asked. */
  readonly skills: readonly Skill[] | null
  /** What the plugins on in the project let the user start. Reading starts those plugins. */
  readonly plugins: PluginContributions
}
export type ProjectPart = keyof ProjectParts

/**
 * What the plugins on in a project let the user start from the palette, each named `<plugin>.<name>`,
 * such as `newrelic.dashboard`. Panels here need no parameters. A command with `input` runs on text typed in the palette.
 */
export interface PluginContributions {
  readonly panels: readonly { readonly id: string; readonly title: string }[]
  readonly setups: readonly { readonly id: string; readonly title: string }[]
  readonly commands: readonly { readonly id: string; readonly title: string; readonly input?: string }[]
}

/** A panel's parameters. They name one instance of the panel, so they are plain values. */
export type PanelParams = Readonly<Record<string, string | number | boolean | null>>

/**
 * The id of one open panel: the panel and its parameters in key order, such as `support.conversation?id=1001`.
 * Opening the same panel with the same parameters names the same instance. Values are URI-encoded,
 * because the view pane's Tabs put the id in a CSS selector without escaping it, and a quote breaks it.
 */
export function panelInstanceId(panel: string, params: PanelParams = {}): string {
  const keys = Object.keys(params).sort()
  return keys.length ? `${panel}?${keys.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(JSON.stringify(params[key]))}`).join("&")}` : panel
}

/** A plugin view drawn for a tab: the plugin that drew it and the node it starts at. */
export interface DrawnView {
  readonly id: string
  readonly title: string
  readonly plugin: string
  readonly root: number
}

/** What plugins show in a tab. The core keeps it and sends it whole on every change. */
export interface TabLayout {
  readonly sidebar?: DrawnView
  /** Open panel instances, in order. Each `id` comes from panelInstanceId. */
  readonly panels: readonly DrawnView[]
  /** Cards for the card stack, after the Space card. */
  readonly cards: readonly DrawnView[]
}

/** A terminal in a tab's panel. Its shell runs in the core under this id. */
export interface TerminalInfo {
  readonly id: string
  readonly title: string
}

/**
 * A top tab as the app keeps it. The core saves the window's tabs, in their order, as the app sends
 * them, and sends them back on connect. Each tab works in one project.
 */
export interface TabInfo extends RunSettings {
  readonly id: string
  readonly title: string
  /** The project folder the tab works in. A tab can change it only before its thread starts. */
  readonly project: string
  /** The terminals in this tab's panel, in order. The core closes any shell that no tab lists. */
  readonly terminals: readonly TerminalInfo[]
  /** The panel tab on show: a terminal's id, or a plugin panel's instance id. Absent means Review. */
  readonly panelActive?: string
}

/** A value a plugin's UI node can hold. A function becomes a handler id, which the app calls back through `plugin.event`. */
export type UiValue = string | number | boolean | null | undefined | { readonly handler: number } | readonly UiValue[] | { readonly [key: string]: UiValue }

/** The node a view is drawn into, and the node type of a text. Neither is a primitive. */
export const ROOT_NODE = "root"
export const TEXT_NODE = "#text"

/** Colours a plugin's badge may take. */
export type Tint = "neutral" | "blue" | "green" | "orange" | "red" | "purple"

export type ButtonVariant = "primary" | "secondary" | "ghost"

/** One message in a conversation. `note` sets it apart as private, `activity` draws it as one quiet line. */
export interface MessageData {
  readonly id: string
  readonly text: string
  readonly author?: string
  /** Milliseconds since the epoch. */
  readonly at?: number
  readonly kind?: "message" | "note" | "activity"
  /** Whether it came from the other side, such as a customer. */
  readonly incoming?: boolean
}

/**
 * The UI primitives a plugin draws with, by node type, and their props as the plugin writes them. The
 * plugin package builds its components from this list, and the app draws each type, so both change together.
 */
export interface UiPrimitives {
  /** Children in a row or a column. */
  stack: { direction?: "row" | "column"; gap?: number; grow?: boolean }
  /** Text. `muted` sets it quieter, `strong` heavier. */
  text: { tone?: "normal" | "muted" | "strong" }
  /** A scrolling list of items. */
  list: {}
  /** One row of a list. It is selectable when it has `onSelect`. */
  item: { title: string; subtitle?: string; detail?: string; badge?: { text: string; tint?: Tint }; selected?: boolean; onSelect?: () => void }
  button: { label: string; variant?: ButtonVariant; disabled?: boolean; onClick: () => void }
  /** A text field. Desk keeps what is typed and reports it through `onInput`. Setting `value` replaces it, such as "" to clear it. */
  textinput: { value: string; placeholder?: string; multiline?: boolean; onInput: (value: string) => void; /** Enter, or ⌘Enter in a multiline field. */ onSubmit?: () => void }
  /** A conversation, oldest first. */
  messages: { items: readonly MessageData[] }
  markdown: { text: string }
}
export type UiPrimitive = keyof UiPrimitives

/** A primitive's props as the app receives them. Each function the plugin passed is a handler id. */
export type UiProps<T extends UiPrimitive> = {
  readonly [K in keyof UiPrimitives[T]]: NonNullable<UiPrimitives[T][K]> extends (...args: never[]) => unknown ? { readonly handler: number } | undefined : UiPrimitives[T][K]
}

/**
 * One change to a plugin's UI tree, after the remote-DOM idea MCP-UI used: the plugin's code builds the
 * tree in the core, and the app draws each node with Desk's own component of that name. Node ids are
 * unique within a plugin, and the app keeps one copy of each plugin's nodes.
 */
export type UiOp =
  | { readonly op: "create"; readonly id: number; readonly type: string }
  | { readonly op: "text"; readonly id: number; readonly text: string }
  | { readonly op: "set"; readonly id: number; readonly key: string; readonly value: UiValue }
  | { readonly op: "insert"; readonly parent: number; readonly id: number; readonly before?: number }
  | { readonly op: "remove"; readonly parent: number; readonly id: number }

/** A plugin's UI node as a client keeps it. */
export interface UiNode {
  readonly type: string
  props: Record<string, UiValue>
  children: number[]
  text?: string
  parent?: number
}

/**
 * Applies a batch of operations to a client's copy of a plugin's nodes, in place. A node moved to
 * another parent leaves its old one first. Solid removes a node and inserts it again in one update,
 * such as the text after a changed value, so a removed node is dropped only if the batch ends with it out.
 * The plugin's renderer frees its own tree by the same rule, and sends one batch per flush.
 */
export function applyOps(nodes: Record<number, UiNode>, ops: readonly UiOp[]) {
  const detach = (id: number) => {
    const node = nodes[id]
    const parent = node?.parent === undefined ? undefined : nodes[node.parent]
    if (parent) parent.children = parent.children.filter((child) => child !== id)
    if (node) node.parent = undefined
  }
  const drop = (id: number) => {
    for (const child of nodes[id]?.children ?? []) drop(child)
    delete nodes[id]
  }
  const removed: number[] = []
  for (const op of ops) {
    if (op.op === "create") nodes[op.id] = { type: op.type, props: {}, children: [] }
    else if (op.op === "text") {
      const node = nodes[op.id]
      if (node) node.text = op.text
      else nodes[op.id] = { type: TEXT_NODE, props: {}, children: [], text: op.text }
    } else if (op.op === "set") {
      const node = nodes[op.id]
      if (node) node.props[op.key] = op.value
    } else if (op.op === "insert") {
      const parent = nodes[op.parent]
      const node = nodes[op.id]
      if (!parent || !node) continue
      detach(op.id)
      const at = op.before === undefined ? -1 : parent.children.indexOf(op.before)
      if (at < 0) parent.children.push(op.id)
      else parent.children.splice(at, 0, op.id)
      node.parent = op.parent
    } else if (op.op === "remove") {
      detach(op.id)
      removed.push(op.id)
    }
  }
  for (const id of removed) if (nodes[id] && nodes[id].parent === undefined) drop(id)
}

/**
 * Messages from the app. Those about a project's data name the project's folder. Those about a tab's
 * thread or panel name the tab or terminal, and the core finds the project from the saved tabs.
 */
export type ClientMessage =
  | { readonly type: "settings.update"; readonly change: SettingsChange }
  | { readonly type: "project.get"; readonly project: string; readonly part: ProjectPart }
  /** Turns an MCP server on or off for the project. Claude Code keeps the choice. */
  | { readonly type: "mcp.toggle"; readonly project: string; readonly name: string; readonly enabled: boolean }
  | { readonly type: "usage.get" }
  | { readonly type: "models.get" }
  /** Continues a past thread in a tab that has not started one. */
  | { readonly type: "thread.resume"; readonly tabId: string; readonly threadId: string }
  /** Starts a terminal, or reattaches to one already running under this id. */
  | { readonly type: "terminal.open"; readonly id: string; readonly cols: number; readonly rows: number }
  | { readonly type: "terminal.input"; readonly id: string; readonly data: string }
  | { readonly type: "terminal.resize"; readonly id: string; readonly cols: number; readonly rows: number }
  /**
   * Replaces the commands in `replacing` with `processes`, in their place. One process saves as a plain
   * command called `name`, several as a group called `name`. Adding replaces nothing.
   */
  | { readonly type: "commands.save"; readonly project: string; readonly name: string; readonly processes: readonly CommandProcess[]; readonly replacing: readonly string[] }
  /** Removes commands, such as every command in a group, stopping those that run. */
  | { readonly type: "commands.remove"; readonly project: string; readonly ids: readonly string[] }
  /** Runs the commands that are not running, such as every command in a group. */
  | { readonly type: "commands.run"; readonly project: string; readonly ids: readonly string[] }
  | { readonly type: "commands.stop"; readonly project: string; readonly ids: readonly string[] }
  /** The files a tab's thread changed since its first message. */
  | { readonly type: "review.get"; readonly tabId: string }
  /** The window's tabs, in order, sent whenever they change. */
  | { readonly type: "tabs.save"; readonly tabs: readonly TabInfo[]; readonly active?: string }
  /** Opens a file from the thread in the editor. The core refuses paths outside the project. */
  | { readonly type: "file.open"; readonly project: string; readonly path: string; readonly line?: number }
  | { readonly type: "session.send"; readonly tabId: string; readonly text: string }
  | { readonly type: "session.interrupt"; readonly tabId: string }
  | { readonly type: "permission.answer"; readonly tabId: string; readonly requestId: string; readonly allow: boolean }
  /** Asks for what plugins show in a saved tab. The core draws it and answers with `layout`. */
  | { readonly type: "layout.get"; readonly tabId: string }
  /** Opens a panel instance in a saved tab, or brings the open one to the front. */
  | { readonly type: "panel.open"; readonly tabId: string; readonly panel: string; readonly params?: PanelParams }
  | { readonly type: "panel.close"; readonly tabId: string; readonly id: string }
  /** Lays a saved tab out as a setup says: its sidebar and panels. */
  | { readonly type: "setup.open"; readonly tabId: string; readonly setup: string }
  /** Runs a plugin command for a saved tab. */
  | { readonly type: "plugin.command"; readonly tabId: string; readonly command: string; readonly input?: string }
  /** Runs a handler a plugin's node holds, such as a button's onClick. */
  | { readonly type: "plugin.event"; readonly plugin: string; readonly handler: number; readonly args: readonly UiValue[] }

export type CoreMessage =
  /** Desk's settings, sent on connect and again after every change. */
  | { readonly type: "settings"; readonly settings: DeskSettings }
  /**
   * The window's saved tabs, sent once on connect. Each restored tab's thread follows as a
   * session.history message.
   */
  | { readonly type: "tabs"; readonly tabs: readonly TabInfo[]; readonly active?: string }
  /** Folders tabs have opened, most recent first. Sent on connect, before the tabs, and when a tab opens a folder. */
  | { readonly type: "recent"; readonly projects: readonly string[] }
  | { [K in ProjectPart]: { readonly type: "project"; readonly project: string; readonly part: K; readonly value: ProjectParts[K] } }[ProjectPart]
  /** The models Claude Code offers, read once when first asked. */
  | { readonly type: "models"; readonly models: readonly ModelOption[] }
  /** Who Claude Code is signed in as, read with the models. Absent when it is not signed in. */
  | { readonly type: "account"; readonly account?: ClaudeAccount }
  /** `usage` is absent when Claude has no plan limits, such as with an API key. */
  | { readonly type: "usage"; readonly usage?: PlanUsage }
  | { readonly type: "review"; readonly tabId: string; readonly files: readonly FileChange[] }
  | { readonly type: "terminal.output"; readonly id: string; readonly data: string }
  | { readonly type: "terminal.exit"; readonly id: string; readonly code: number }
  | { readonly type: "session.event"; readonly tabId: string; readonly event: ThreadEvent }
  /** A restored thread, read back from Claude's transcript in one message, so the app can tell it from live events. */
  | { readonly type: "session.history"; readonly tabId: string; readonly items: readonly ThreadItem[]; readonly context?: ContextReading }
  /** Changes to a plugin's UI. With `reset`, they replace every node the app holds for the plugin. */
  | { readonly type: "plugin.ops"; readonly plugin: string; readonly ops: readonly UiOp[]; readonly reset?: boolean }
  /** What plugins show in a tab, sent whole on every change. */
  | { readonly type: "layout"; readonly tabId: string; readonly layout: TabLayout }
  /** A panel instance opened, so the app brings it to the front and opens the view pane. */
  | { readonly type: "panel.show"; readonly tabId: string; readonly id: string }
  /** A plugin opened a thread in a tab under this name. */
  | { readonly type: "tab.title"; readonly tabId: string; readonly title: string }
  /** Something the user asked for failed. The app shows the message. */
  | { readonly type: "error"; readonly message: string }
  /** A short message for the user, such as a plugin's toast. */
  | { readonly type: "notice"; readonly message: string }
