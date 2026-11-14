/** Messages between the Desk app and the core, sent as JSON over one WebSocket. */

import type { IconName } from "./icon-names"

export { ICON_NAMES, type IconName } from "./icon-names"

/** The line the core prints on stdout once it listens, so the app knows where to connect. */
export interface CoreReady {
  readonly port: number
}

/** The coding agents Desk runs, in the order Desk lists them. */
export const AGENTS = ["claude", "codex", "antigravity"] as const
export type AgentId = (typeof AGENTS)[number]

/** The agent a tab runs when nothing says otherwise, such as a tab saved before Desk ran more than one. */
export const DEFAULT_AGENT: AgentId = "claude"

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

/** The image types every agent reads. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const
/** The largest image Desk sends, in bytes before base64. It is Claude's limit, the lowest of the agents'. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * What a message sent while the agent works does: steer joins the running turn, and queue waits for the
 * turn to end. ⌘Enter does the other one, for one message.
 */
export const FOLLOW_UPS = ["steer", "queue"] as const
export type FollowUp = (typeof FOLLOW_UPS)[number]

/**
 * What a message sent while the agent works does. A slash command, such as /rename, is a turn the agent
 * runs on its own, so steering one in would cut the running turn short. It always waits in the queue.
 */
export const followUpFor = (text: string, chosen: FollowUp): FollowUp => (text.trimStart().startsWith("/") ? "queue" : chosen)

/** A message waiting for the running turn to end. The core sends queued messages in order, one turn each. */
export interface QueuedMessage {
  readonly id: string
  readonly text: string
  readonly images?: readonly ImageAttachment[]
}

/** An image sent with a message, as base64. */
export interface ImageAttachment {
  readonly mediaType: (typeof IMAGE_TYPES)[number]
  readonly data: string
}

/**
 * One item of a thread, shaped for drawing. The core turns each agent's own messages into these, so the
 * app never reads an agent's types or tool inputs. Items are told apart by id within their thread.
 */
export type ThreadItem =
  /**
   * A message that starts a turn. `at` is when it was sent, in milliseconds since the epoch, when that is
   * known. `steered` marks one sent into a turn that was still running. `waiting` marks a steered message
   * the agent has not taken in yet, such as while a tool runs. `selfStarted` marks a turn the agent started
   * itself: a background task finished, or a subagent or another session sent it a message. Its text says which.
   */
  | {
      readonly type: "user"
      readonly id: string
      readonly text: string
      readonly images?: readonly ImageAttachment[]
      readonly at?: number
      readonly steered?: boolean
      readonly waiting?: boolean
      readonly selfStarted?: boolean
    }
  /**
   * Assistant text. `at` is when it finished. Text still streaming is not done and has none. `interrupted`
   * marks a reply that a steered message cut short.
   */
  | { readonly type: "text"; readonly id: string; readonly text: string; readonly done: boolean; readonly at?: number; readonly interrupted?: boolean }
  /** The agent's thinking. `text` is what it thought, when the agent shares it. */
  | { readonly type: "thinking"; readonly id: string; readonly text?: string; readonly kind: StepKind; readonly label: string }
  /**
   * A tool call. `summary` is what it was given in short, such as its command or path, relative to the
   * project. A call that edits a file carries the file's path and its edits. A result is `stopped` when
   * the user stopped the call while it ran.
   */
  | {
      readonly type: "tool"
      readonly id: string
      readonly name: string
      readonly summary: string
      readonly file?: string
      readonly edits?: readonly TextEdit[]
      readonly result?: { readonly output: string; readonly isError: boolean; readonly stopped?: boolean }
      readonly kind: StepKind
      readonly label: string
    }
  /**
   * A tool call waiting for the user's approval, after T3 Code. `detail` is what the user approves: the
   * command itself, else the agent's sentence for the request. `reason` says why the agent asks, when
   * that adds to `detail`. `requestId` answers it. It leaves the thread once answered.
   */
  | {
      readonly type: "permission"
      readonly id: string
      readonly requestId: string
      readonly tool: string
      readonly kind: PermissionKind
      readonly detail: string
      readonly reason?: string
      /** Whether "Always allow this session" is offered. An agent withholds it when its rule would grant more than this call. */
      readonly allowSession: boolean
      readonly answered?: boolean
    }
  /** Questions the agent asks the user, waiting for answers. `requestId` answers them. It leaves the thread once answered. */
  | { readonly type: "question"; readonly id: string; readonly requestId: string; readonly questions: readonly Question[]; readonly answered?: boolean }
  /**
   * The agent compacting the thread's context, after T3 Code. Live compactions carry the token counts
   * before and after, when the agent reports them. A restored one has none. `error` is the agent's reason when it failed.
   */
  | {
      readonly type: "compaction"
      readonly id: string
      readonly status: "running" | "done" | "failed" | "stopped"
      readonly preTokens?: number
      readonly postTokens?: number
      readonly error?: string
    }
  /** The end of a turn. `stopped` means the user stopped it. */
  | { readonly type: "result"; readonly id: string; readonly durationMs: number; readonly isError: boolean; readonly stopped?: boolean }
  | { readonly type: "error"; readonly id: string; readonly message: string }
  /** Something the agent says about the turn that is not its reply, such as a hook's note. A warning stands out. */
  | { readonly type: "notice"; readonly id: string; readonly text: string; readonly warning: boolean }
  /** The files a turn changed, without their diffs, added once the turn ends. */
  | { readonly type: "changes"; readonly id: string; readonly files: readonly ChangedFile[] }

/** What a permission request would let the agent do, which picks its icon and label, after T3 Code. */
export type PermissionKind = "command" | "file-change" | "file-read" | "permission"

/**
 * The user's answer to a permission request. "allow-session" also allows calls like it for the rest of
 * the session. "cancel" declines and stops the turn.
 */
export type PermissionAnswer = "allow" | "allow-session" | "decline" | "cancel"

/** One question the agent asks the user. */
export interface Question {
  readonly header: string
  readonly question: string
  readonly options: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect: boolean
}

/**
 * One step of the agent's work in a turn: a thought or a tool call. The core names each: its `kind`, and
 * its `label` in a few words, such as "Ran npm" or the thought's first line.
 */
export type Step = Extract<ThreadItem, { type: "thinking" | "tool" }>

/** What a step did, which picks its icon. */
export type StepKind = "thought" | "command" | "edit" | "read" | "search" | "web" | "other"

export const isStep = (item: ThreadItem): item is Step => item.type === "thinking" || item.type === "tool"

/** An item of the thread, shown on its own. */
export interface ItemRow {
  readonly type: "item"
  readonly id: string
}

/** Steps in a row, with nothing between them, by item id. The last group of a running turn is live: it shows its latest step. */
export interface StepGroup {
  readonly type: "group"
  readonly id: string
  readonly steps: readonly string[]
  readonly live: boolean
  /** The steps in one line, such as "Read 3 files and ran 2 commands". */
  readonly summary: string
}

/**
 * A row of the thread as the core lays it out, after T3 Code. Rows hold item ids, and the items come
 * through `session.event` and `session.history`. Ids stay the same while a row changes, so a client
 * can keep a row's open state under its id.
 * - `fold`: a finished turn's work, folded into one row. A turn restored without timing has no duration.
 * - `working`: the head of a running turn. `since` is when its message was sent.
 */
export type ThreadRow =
  | ItemRow
  | StepGroup
  | { readonly type: "fold"; readonly id: string; readonly rows: readonly (ItemRow | StepGroup)[]; readonly durationMs?: number; readonly stopped: boolean }
  | { readonly type: "working"; readonly id: string; readonly since?: number }

/** A change to a thread. An item replaces the item with the same id, or joins the thread after the others. */
export type ThreadEvent =
  | { readonly kind: "item"; readonly item: ThreadItem }
  /** More text for a text item still streaming. */
  | { readonly kind: "text.delta"; readonly id: string; readonly delta: string }
  /** Items the agent took back, such as a reply it replaced with another. An id the thread does not hold is skipped. */
  | { readonly kind: "items.remove"; readonly ids: readonly string[] }
  | { readonly kind: "status"; readonly busy: boolean }
  /** The model that runs, by the name Desk shows for it, such as "Opus 5.5". */
  | { readonly kind: "init"; readonly model: string }
  /** Read after each turn. */
  | { readonly kind: "context"; readonly reading: ContextReading }
  /** A subagent the agent started, sent whole each time it changes. */
  | { readonly kind: "subagent"; readonly subagent: Subagent }
  /** The commands running in the background now, sent whole each time the set changes. */
  | { readonly kind: "background"; readonly tasks: readonly BackgroundTask[] }
  /**
   * The user asked the turn to stop, at `since`. `unresponsive` once the agent has not stopped in
   * time, so Force stop can end it. The turn's end clears it.
   */
  | { readonly kind: "stopping"; readonly since: number; readonly unresponsive: boolean }
  /** A request to the API failed and the agent tries again, as attempt `attempt` of `maxRetries`, after `delayMs`. More output or a status clears it. */
  | { readonly kind: "retry"; readonly attempt: number; readonly maxRetries: number; readonly delayMs: number; readonly error: string }

/** A command the agent left running in the background, such as a long review or a dev server. */
export interface BackgroundTask {
  /** The agent's task id. */
  readonly id: string
  /** What it runs, as the agent describes it: the command, or what the agent named it. */
  readonly label: string
  /** When Desk first saw it, in milliseconds since the epoch. */
  readonly startedAt: number
}

/**
 * A subagent the agent started in a turn: one of its own, such as Claude's Explore agent, or another
 * agent it handed work to through Desk. It runs beside the thread, so Desk shows it in its own card, not
 * in the thread. `items` is what it has done so far, shaped as thread items.
 */
export interface Subagent {
  /** The agent's task id, or Desk's id for work handed to another agent. */
  readonly id: string
  readonly description: string
  /** The kind of agent, such as "Explore". */
  readonly type?: string
  /** The agent that runs it. Absent for an agent's own subagent, which runs on the agent that started it. */
  readonly agent?: AgentId
  /** The model it runs on, by the name Desk shows for it, when it is not the thread's. */
  readonly model?: string
  readonly status: "running" | "completed" | "failed" | "stopped"
  /** Whether it runs in the background, so the turn that started it can end first. */
  readonly background: boolean
  readonly startedAt: number
  readonly endedAt?: number
  /** A one-line status while it runs, and its result's summary once it ends. */
  readonly summary?: string
  readonly toolUses: number
  readonly prompt?: string
  readonly items: readonly ThreadItem[]
}

/** The repo and branch a project is on, for the Space card. */
export interface Space {
  readonly name: string
  readonly root: string
  readonly branch: string
  /** Commits ahead of and behind the upstream branch, when there is one. */
  readonly upstream?: { readonly ahead: number; readonly behind: number }
  /** Uncommitted changes in the project's folder against HEAD, as Review's uncommitted scope counts them: new files and their lines included. */
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

/**
 * What Review compares the working tree with: the thread's first message, the last commit, where the
 * branch left the default branch, or the start of the last turn.
 */
export const REVIEW_SCOPES = ["thread", "git", "branch", "turn"] as const
export type ReviewScope = (typeof REVIEW_SCOPES)[number]

/** A file a turn changed, as the turn's summary lists it. */
export type ChangedFile = Omit<FileChange, "patch">

/** One changed file, with its unified diff. */
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
  /** The window as the agent names it, such as "five_hour". */
  readonly id: string
  readonly label: string
  /** Percentage used, 0–100. */
  readonly percent: number
  readonly resetsAt?: string
}

/** Plan usage. It has at least one window. */
export interface PlanUsage {
  readonly windows: readonly [UsageWindow, ...UsageWindow[]]
}

/** An agent's own default model, as a ModelOption value. Every agent lists it first. */
export const DEFAULT_MODEL = "default"

/** How much a model thinks before it answers, as its agent names the level, such as "high". Each model lists the levels it takes. */
export type Effort = string

/**
 * How an agent handles tool calls, as T3 Code names them: Supervised asks first, Auto-accept edits
 * lets edits through, Auto lets a reviewer decide, and Full access never asks. Each model lists the modes it takes.
 */
export const PERMISSION_MODES = ["default", "acceptEdits", "auto", "bypassPermissions"] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

/** How a tab's thread runs. A change applies to a running thread from its next reply. */
export interface RunSettings {
  /** The agent that runs the thread. A tab can change it only before its thread starts. */
  readonly agent: AgentId
  /** The model, as a ModelOption value of that agent. */
  readonly model: string
  /** Absent means the model's default effort. */
  readonly effort?: Effort
  /** Fast mode, on a model that has it. */
  readonly fast?: boolean
  readonly permissionMode: PermissionMode
}

/** A model an agent offers the account, as the agent's own model menu lists it. */
export interface ModelOption {
  /** What a session is started with, such as "opus". "default" is the agent's own default. */
  readonly value: string
  readonly label: string
  readonly description: string
  /** The model that runs, by the name Desk shows for it, when the label does not say: "Default" runs "Opus 5.5". */
  readonly runs?: string
  /** The effort levels the model takes, from least to most. Empty when it takes none. */
  readonly efforts: readonly Effort[]
  /** The effort the agent uses when the tab sets none, after the user's own settings. */
  readonly defaultEffort?: Effort
  /** Whether the model has fast mode. */
  readonly fast: boolean
  /** The permission modes the model takes. Auto needs a model, or an agent, that supports it. */
  readonly permissionModes: readonly PermissionMode[]
  /** Whether the picker keeps the model behind "Show older models", such as one pinned to a past version. */
  readonly older?: boolean
}

/**
 * What an agent can do beyond a conversation. The app offers only what the tab's agent lists, and the
 * core refuses the rest.
 * - `steer`: a message joins the running turn. Without it, every message sent meanwhile waits in the queue.
 * - `rewind`: a thread goes back to before a message. `restore-files` also takes its file changes back.
 * - `fork`, `rename`, `delete`: what the session menu does to a thread.
 * - `compact-idle`: the agent compacts a large thread that sat idle.
 * - `sign-in`: Desk can start the agent's sign-in. `install`: Desk can install the agent.
 * - `mcp`: Desk lists the agent's MCP servers in a project and turns them on or off.
 * - `slash-commands`: the agent runs a skill or command named after a `/` in a message, so the composer offers them.
 */
export const AGENT_FEATURES = ["steer", "rewind", "restore-files", "fork", "rename", "delete", "compact-idle", "sign-in", "install", "mcp", "slash-commands"] as const
export type AgentFeature = (typeof AGENT_FEATURES)[number]

/** An agent's version on this Mac, and whether a newer one is out. A version that could not be read is absent. */
export interface AgentVersion {
  readonly installed?: string
  /** The newest version on the user's update channel. */
  readonly latest?: string
  readonly updateAvailable: boolean
  /** Whether Desk can update it, with the agent's own updater. */
  readonly updatable: boolean
}

/** The account an agent is signed in with, as it reports it. */
export interface AgentAccount {
  readonly email?: string
  readonly organization?: string
  /** The plan the account is on, such as "max" or "plus". Absent without one, such as with an API key. */
  readonly plan?: string
  /** How the agent signs in when not with a subscription, such as "an API key" or "Amazon Bedrock". */
  readonly method?: string
}

/**
 * An agent as Desk knows it now. `state` says where it stands:
 * - `checking`: Desk is still reading it.
 * - `ready`: installed and signed in.
 * - `missing`: not installed on this Mac.
 * - `signed-out`: installed, with no account.
 * - `installing`, `signing-in` and `updating`: Desk is doing so, as the user asked.
 * `problem` says what to do about a state that is not ready, in one line.
 */
export interface AgentInfo {
  readonly id: AgentId
  /** The agent's name, such as "Claude Code". */
  readonly name: string
  readonly state: "checking" | "ready" | "missing" | "signed-out" | "installing" | "signing-in" | "updating"
  readonly problem?: string
  readonly version?: AgentVersion
  readonly account?: AgentAccount
  /** The models the agent offers, with its default first. Empty until read. */
  readonly models: readonly ModelOption[]
  readonly features: readonly AgentFeature[]
  /** The account's plan usage. Absent until read, and when the account has no plan limits. */
  readonly usage?: PlanUsage
  /** The page a sign-in that runs waits on, so the user can open it again after closing it. */
  readonly signInLink?: string
}

/** A past thread in a project, as its agent saved it. */
export interface ThreadSummary {
  /** The agent's session id, which resumes the thread. */
  readonly id: string
  /** The agent the thread ran on, which a tab that resumes it runs. */
  readonly agent: AgentId
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

/** What a new tab starts an agent with. */
export interface AgentDefaults {
  /** A ModelOption value of the agent. */
  readonly model: string
  /** Absent means the model's default effort. */
  readonly effort?: Effort
  /** A model that does not take the mode starts Supervised instead. */
  readonly permissionMode: PermissionMode
}

/** How threads start and run, whichever agent runs them. */
export interface ThreadSettings {
  /** The agent a new tab starts with. */
  readonly agent: AgentId
  /** What Enter does while the agent works. */
  readonly followUp: FollowUp
  /** Compacts a thread's context once it has sat idle, so picking it up again starts small. Only an agent with `compact-idle` does. */
  readonly compactIdle: boolean
}

/** The colors a project's avatar can take, as @opencode/ui's ProjectAvatar names them. */
export const PROJECT_COLORS = ["orange", "yellow", "cyan", "green", "red", "pink", "blue", "purple", "gray"] as const
export type ProjectColor = (typeof PROJECT_COLORS)[number]

/** How a project shows in tabs and menus. Each is optional. Without one, Desk uses the folder's. */
export interface ProjectSettings {
  readonly name?: string
  readonly color?: ProjectColor
  /** An image in the project to use as its icon, as a path relative to its folder. */
  readonly icon?: string
}

/**
 * An MCP server an agent loads in a project, and how its connection stands. `not-started` means the agent
 * starts it only inside a thread, so Desk cannot see it connect.
 */
export interface McpServer {
  readonly name: string
  readonly status: "connected" | "failed" | "needs-auth" | "pending" | "not-started" | "disabled"
  /** Where it is configured, as the agent names it, such as "user" or "project". */
  readonly scope?: string
  /** Whether it is configured for this project only, rather than for every project. */
  readonly ownProject: boolean
  /** What the server runs: its command, or its URL. */
  readonly target?: string
  /** The tools it offers, when connected. */
  readonly tools: number
  /** Why it failed, when it did. */
  readonly error?: string
  /** Whether Desk can turn it on or off. Codex lets Desk change only the user's own config, so a project's or a plugin's server stays as it is. */
  readonly toggleable: boolean
}

/**
 * A command an agent offers in a project: one of its own, a skill or a custom command. The core lists
 * them grouped by `group`, in order, with the agent's own first.
 */
export interface Skill {
  /** What follows the slash, such as "pdf" or "figma:figma-use". */
  readonly name: string
  readonly description: string
  /** What the command takes after its name, such as "<file>". */
  readonly argumentHint?: string
  /** Whether it is the agent's own command, such as /compact, rather than a skill. */
  readonly builtin?: boolean
  /** Whether it lives in this project, rather than being available to every project. */
  readonly ownProject: boolean
  /** Where a skill available to every project comes from, such as "User" or "Plugin: figma". */
  readonly group: string
  /** The file that defines it, such as its SKILL.md, when the agent says or Desk finds it. */
  readonly path?: string
}

export interface DeskSettings {
  readonly appearance: AppearanceSettings
  readonly threads: ThreadSettings
  /** What a new tab starts each agent with. */
  readonly agents: Readonly<Record<AgentId, AgentDefaults>>
  /** By project folder. */
  readonly projects: Readonly<Record<string, ProjectSettings>>
}

/** Desk's settings before anyone changes them. The app uses them until the core sends the saved ones. */
export const DEFAULT_SETTINGS: DeskSettings = {
  appearance: { theme: "dark", fontSize: 14, uiFont: "", codeFont: "" },
  threads: { agent: DEFAULT_AGENT, followUp: "steer", compactIdle: false },
  agents: {
    claude: { model: DEFAULT_MODEL, permissionMode: "auto" },
    codex: { model: DEFAULT_MODEL, permissionMode: "auto" },
    antigravity: { model: DEFAULT_MODEL, permissionMode: "default" },
  },
  projects: {},
}

/**
 * A change to the settings. Named fields change and the rest stay. JSON has no undefined, so null
 * clears an optional field. A project's settings replace what the project had.
 */
export interface SettingsChange {
  readonly appearance?: Partial<AppearanceSettings>
  readonly threads?: Partial<ThreadSettings>
  /** What a new tab starts one agent with. */
  readonly agent?: { readonly id: AgentId; readonly defaults: Partial<Omit<AgentDefaults, "effort">> & { readonly effort?: Effort | null } }
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
 * `project` message. Commands are sent again whenever they change, such as a command's run.
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
  /** Each agent's skills and custom commands, by agent. Null when the agent could not be asked. An agent with no slash commands lists none. */
  readonly skills: Readonly<Partial<Record<AgentId, readonly Skill[] | null>>>
  /** What the plugins on in the project let the user start. Reading starts those plugins. */
  readonly plugins: PluginContributions
}
export type ProjectPart = keyof ProjectParts

/** A setup and the project it opens in. */
export interface ProjectSetup {
  readonly project: string
  readonly id: string
  readonly title: string
}

/**
 * What the plugins on in a project let the user start from the palette, each named `<plugin>.<name>`,
 * such as `newrelic.dashboard`. Panels here need no parameters. A command with `input` runs on text
 * typed in the palette.
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

/** What plugins show in a tab, by full name: its sidebar, its open panel instances in order, and the plugin cards it leaves out. The core saves it with the tab. */
export interface PluginLayout {
  readonly sidebar?: string
  readonly panels: readonly { readonly panel: string; readonly params: PanelParams }[]
  readonly hiddenCards: readonly string[]
}

/** A plugin's name: its folder in `~/.desk/plugins`. It holds no dot, so a contribution's full id splits at its first dot. */
export const PLUGIN_NAME = /^[a-z0-9][a-z0-9_-]*$/

/** The full id of something a plugin registers, such as `support.inbox`. Thread keys a plugin opens are scoped the same way. */
export const contributionId = (plugin: string, name: string) => `${plugin}.${name}`

/** The plugin and the name a full id holds. A panel instance id splits the same way. */
export function splitContributionId(id: string): { readonly plugin: string; readonly name: string } {
  const dot = id.indexOf(".")
  if (dot < 1) throw new Error(`Plugin views are named <plugin>.<name>, not ${id}.`)
  return { plugin: id.slice(0, dot), name: id.slice(dot + 1) }
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

/** A file open in a tab's panel. `path` is absolute. `line`, when set, is the line to show. */
export interface FileTabInfo {
  readonly id: string
  readonly path: string
  readonly line?: number
}

/** A file as the panel shows it. A binary file has no text, and a large one shows only its start. */
export interface FileView {
  /** The absolute path. */
  readonly path: string
  readonly text?: string
  readonly binary?: boolean
  /** Set when the text stops before the end of the file. */
  readonly truncated?: boolean
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
  /** Files open in this tab's panel, in order. */
  readonly files?: readonly FileTabInfo[]
  /** The panel tab on show: a terminal's, a file's or a plugin panel's id. Absent means Review. */
  readonly panelActive?: string
  /** What Review compares with. Absent means the thread's changes. */
  readonly reviewScope?: ReviewScope
  /**
   * Whether the view pane is open beside the thread. Each tab keeps its own, and a new tab starts with it
   * closed. Absent means the user has not opened or closed it yet, so a plugin's panel may open it.
   */
  readonly panelOpen?: boolean
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
  /**
   * One row of a list. It is selectable when it has `onSelect`. With `href`, a press opens that URL in the
   * browser, and runs `onSelect` too when given. `icon` names a catalog icon to draw before the title.
   * `image` is the path of an image file, such as an SVG the plugin imports, and draws in place of `icon`.
   */
  item: {
    title: string
    subtitle?: string
    detail?: string
    badge?: { text: string; tint?: Tint }
    icon?: IconName
    image?: string
    href?: string
    selected?: boolean
    onSelect?: () => void
  }
  button: { label: string; variant?: ButtonVariant; disabled?: boolean; onClick: () => void }
  /** A text field. Desk keeps what is typed and reports it through `onInput`. Setting `value` replaces it, such as "" to clear it. */
  textinput: { value: string; placeholder?: string; multiline?: boolean; onInput: (value: string) => void; /** Enter, or ⌘Enter in a multiline field. */ onSubmit?: () => void }
  /** A conversation, oldest first. */
  messages: { items: readonly MessageData[] }
  markdown: { text: string }
}
export type UiPrimitive = keyof UiPrimitives

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
  /** Reads an agent's MCP servers in the project, for an agent that has `mcp`. Reading starts the servers, so it takes a few seconds. The core answers with `mcp`, again as they connect. */
  | { readonly type: "mcp.get"; readonly project: string; readonly agent: AgentId }
  /** Turns one of an agent's MCP servers on or off. The agent keeps the choice. The core answers with `mcp`. */
  | { readonly type: "mcp.toggle"; readonly project: string; readonly agent: AgentId; readonly name: string; readonly enabled: boolean }
  /** Reads the agents: whether each is installed and signed in, its models and its plan usage. The core answers with `agents`, again as it learns more. */
  | { readonly type: "agents.get" }
  /** Reads every agent's plan usage again. The core answers with `agents`. */
  | { readonly type: "usage.get" }
  /** Updates an agent with its own updater. The core answers with `agents` once it is done. */
  | { readonly type: "agent.update"; readonly agent: AgentId }
  /** Installs an agent that has `install`. The core answers with `agents` as it goes. */
  | { readonly type: "agent.install"; readonly agent: AgentId }
  /** Starts an agent's sign-in, which opens in the browser, for an agent that has `sign-in`. The core answers with `agents` once it ends. */
  | { readonly type: "agent.signIn"; readonly agent: AgentId }
  /** Stops an agent's install or sign-in. The core answers with `agents`, as the agent was before. */
  | { readonly type: "agent.cancel"; readonly agent: AgentId }
  /** Continues a past thread in a tab that has not started one. The tab runs the thread's agent. */
  | { readonly type: "thread.resume"; readonly tabId: string; readonly agent: AgentId; readonly threadId: string }
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
  /** The files that changed in a tab's project over the span `scope` names. The core answers with `review`. */
  | { readonly type: "review.get"; readonly tabId: string; readonly scope: ReviewScope }
  /** Reopens the tab closed last, as ⌘⇧T asks. The core answers with `tab.reopened`. */
  | { readonly type: "tab.reopen" }
  /** The window's tabs, in order, sent whenever they change. */
  | { readonly type: "tabs.save"; readonly tabs: readonly TabInfo[]; readonly active?: string }
  /** Desk's window gained or lost focus. Plugins hear which of their views are on screen. */
  | { readonly type: "window.focus"; readonly focused: boolean }
  /** Opens a file from the thread in the editor. A relative path is in the project. The core refuses anything that is not a file. */
  | { readonly type: "file.open"; readonly project: string; readonly path: string; readonly line?: number }
  /** Reads a file to show in the panel. `path` is relative to the project, absolute, or from ~/. The core answers with `file`. */
  | { readonly type: "file.read"; readonly project: string; readonly path: string }
  /** Sends a message. While the agent works, `followUp` says whether it steers the turn or waits in the queue. */
  | { readonly type: "session.send"; readonly tabId: string; readonly text: string; readonly images?: readonly ImageAttachment[]; readonly followUp?: FollowUp }
  /** Sends a queued message now: into the running turn, or as a new turn when none runs. */
  | { readonly type: "queue.send"; readonly tabId: string; readonly id: string }
  | { readonly type: "queue.remove"; readonly tabId: string; readonly id: string }
  /** Sends the queue again after a stop or an error paused it. */
  | { readonly type: "queue.resume"; readonly tabId: string }
  /** Finds files in the project whose path matches `query`, for an @ mention or the file search. The core answers with `files.found`. */
  | { readonly type: "files.search"; readonly project: string; readonly query: string }
  | { readonly type: "session.interrupt"; readonly tabId: string }
  /** Ends a turn that did not stop when asked, by closing its agent's session. */
  | { readonly type: "session.forceStop"; readonly tabId: string }
  /** Switches the tab's project back to the branch its thread last ran on. */
  | { readonly type: "branch.restore"; readonly tabId: string }
  /** Stops commands the agent left running in the background in a tab. */
  | { readonly type: "tasks.stop"; readonly tabId: string; readonly ids: readonly string[] }
  /** Lists the setups of every project with plugins on, the active `project`'s first. The core answers with `setups`. */
  | { readonly type: "setups.get"; readonly project: string }
  /** Starts a fresh session in a tab, as /clear asks. */
  | { readonly type: "thread.clear"; readonly tabId: string }
  /** Names a tab and its session, as an agent's /rename does. It runs no turn, so a running one goes on. */
  | { readonly type: "thread.rename"; readonly tabId: string; readonly title: string }
  /** Copies a tab's session into a new one, ending with the turn of `messageId` when given. The core answers with `thread.forked`. */
  | { readonly type: "thread.fork"; readonly tabId: string; readonly messageId?: string }
  /**
   * Takes a tab's thread back to before one of the user's messages. The agent forgets it and what followed.
   * With `restoreFiles`, the files the agent's tools changed since go back too.
   */
  | { readonly type: "thread.rewind"; readonly tabId: string; readonly messageId: string; readonly restoreFiles: boolean }
  /** Deletes a tab's session from this Mac, after stopping a running turn. The tab starts afresh, as after /clear. */
  | { readonly type: "thread.delete"; readonly tabId: string }
  | { readonly type: "permission.answer"; readonly tabId: string; readonly requestId: string; readonly answer: PermissionAnswer }
  /** Answers the agent's questions, by question text. Without `answers`, the user dismissed them. */
  | { readonly type: "question.answer"; readonly tabId: string; readonly requestId: string; readonly answers?: Readonly<Record<string, string>> }
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
  /** Starts every plugin again from its files, such as after an edit, and lays out every tab again. */
  | { readonly type: "plugins.reload" }

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
  /** Every agent as Desk knows it now, in Desk's order, sent whole each time one changes. */
  | { readonly type: "agents"; readonly agents: readonly AgentInfo[] }
  /** An agent's MCP servers in a project, to the client that asked. Null when the agent could not be asked. */
  | { readonly type: "mcp"; readonly project: string; readonly agent: AgentId; readonly servers: readonly McpServer[] | null }
  | { readonly type: "review"; readonly tabId: string; readonly scope: ReviewScope; readonly files: readonly FileChange[] }
  /** Setups across projects, each with the project it opens in. A setup on in every project shows once, for the active one. */
  | { readonly type: "setups"; readonly setups: readonly ProjectSetup[] }
  /** A closed tab to add back at `index`, its place before it closed. Its thread follows. */
  | { readonly type: "tab.reopened"; readonly tab: TabInfo; readonly index: number }
  /** A tab's queued messages, sent whole on each change. `held` means a stop or an error paused them. */
  | { readonly type: "queue"; readonly tabId: string; readonly messages: readonly QueuedMessage[]; readonly held: boolean }
  /** A file read for the panel, for the `path` that was asked for. */
  | { readonly type: "file"; readonly project: string; readonly path: string; readonly file: FileView }
  /** The branch a tab's thread last ran on. Absent outside a Git repo or on a detached HEAD. */
  | { readonly type: "thread.branch"; readonly tabId: string; readonly branch?: string }
  /** The answer to `files.search`, with the query it answers: paths relative to the project, best match first. */
  | { readonly type: "files.found"; readonly project: string; readonly query: string; readonly paths: readonly string[] }
  | { readonly type: "terminal.output"; readonly id: string; readonly data: string }
  | { readonly type: "terminal.exit"; readonly id: string; readonly code: number }
  | { readonly type: "session.event"; readonly tabId: string; readonly event: ThreadEvent }
  /** A tab's thread as rows, sent after its history and whenever an event changes them. */
  | { readonly type: "session.rows"; readonly tabId: string; readonly rows: readonly ThreadRow[] }
  /** A restored thread, read back from its agent's transcript in one message, so the app can tell it from live events. */
  | { readonly type: "session.history"; readonly tabId: string; readonly items: readonly ThreadItem[]; readonly context?: ContextReading }
  /** Changes to a plugin's UI. With `reset`, they replace every node the app holds for the plugin. */
  | { readonly type: "plugin.ops"; readonly plugin: string; readonly ops: readonly UiOp[]; readonly reset?: boolean }
  /** What plugins show in a tab, sent whole on every change. */
  | { readonly type: "layout"; readonly tabId: string; readonly layout: TabLayout }
  /** A panel instance opened, so the app brings it to the front and opens the view pane. */
  | { readonly type: "panel.show"; readonly tabId: string; readonly id: string }
  /** A tab's new name, from a plugin's thread or a rename. */
  | { readonly type: "tab.title"; readonly tabId: string; readonly title: string }
  /**
   * The session a tab's thread runs in, and the agent it runs on. Both are absent until the thread's first
   * message starts one. A started thread keeps its agent, so the app sets the tab's agent to it.
   */
  | { readonly type: "thread.session"; readonly tabId: string; readonly sessionId?: string; readonly agent?: AgentId }
  /** A copy of a tab's session, on the same agent, which the app opens in a new tab beside it. */
  | { readonly type: "thread.forked"; readonly tabId: string; readonly agent: AgentId; readonly threadId: string; readonly title: string }
  /**
   * Something failed. `message` says what failed, in one line. `detail` holds the cause, such as the
   * error a plugin threw, which can run to several lines. The app shows both.
   */
  | { readonly type: "error"; readonly message: string; readonly detail?: string }
  /** A short message for the user, such as a plugin's toast. */
  | { readonly type: "notice"; readonly message: string }
