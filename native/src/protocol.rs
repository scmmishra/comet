//! The messages between the native app and the core, from `protocol/src/index.ts`. Only the fields the
//! app uses are typed. `protocol/src/fixtures.ts` holds messages of each type, and the tests check
//! both directions against them.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The line the core prints on stdout once it listens.
#[derive(Debug, Deserialize)]
pub struct CoreReady {
    pub port: u16,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub title: String,
}

/// A file open in a tab's panel. `path` is absolute. `line`, when set, is the line to show.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FileTabInfo {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// A top tab. The core saves tabs as the app sends them, so a tab keeps every field it arrived with:
/// fields the app does not read yet travel in `rest` and go back unchanged.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub id: String,
    pub title: String,
    /// The project folder the tab works in.
    pub project: String,
    pub terminals: Vec<TerminalInfo>,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fast: Option<bool>,
    pub permission_mode: String,
    /// Files open in the tab's panel, in order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<FileTabInfo>,
    /// The panel tab on show: a terminal's, a file's or a plugin panel's id. Absent means Review.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_active: Option<String>,
    /// What Review compares with. Absent means the thread's changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_scope: Option<String>,
    /// Whether the view pane is open. Absent means the user has not opened or closed it yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_open: Option<bool>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeChoice {
    #[default]
    Dark,
    Light,
    Auto,
}

impl ThemeChoice {
    /// The choices, in the order Appearance and the palette list them.
    pub const ALL: [ThemeChoice; 3] = [ThemeChoice::Dark, ThemeChoice::Light, ThemeChoice::Auto];

    /// The choice as the settings file names it.
    pub fn id(self) -> &'static str {
        match self {
            ThemeChoice::Dark => "dark",
            ThemeChoice::Light => "light",
            ThemeChoice::Auto => "auto",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ThemeChoice::Dark => "Dark",
            ThemeChoice::Light => "Light",
            ThemeChoice::Auto => "System",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: ThemeChoice,
    /// The thread's text, in points.
    pub font_size: f32,
    /// The font for everything but code, and the font for code, by family name. Empty for Geist.
    #[serde(default)]
    pub ui_font: String,
    #[serde(default)]
    pub code_font: String,
}

/// The run settings a new tab starts with.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSettings {
    pub model: String,
    pub effort: Option<String>,
    pub permission_mode: String,
    /// What Enter does while Claude works: "steer" or "queue".
    pub follow_up: String,
    /// Whether Claude Code compacts a large thread that sat idle before its next turn.
    #[serde(default)]
    pub compact_idle: bool,
}

/// How a project shows in tabs and menus.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ProjectSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DeskSettings {
    pub appearance: AppearanceSettings,
    pub claude: ClaudeSettings,
    /// By project folder.
    #[serde(default)]
    pub projects: std::collections::HashMap<String, ProjectSettings>,
}

/// The Claude Code that Desk runs, and whether a newer one is out.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeVersion {
    pub installed: Option<String>,
    pub latest: Option<String>,
    pub update_available: bool,
    /// Whether Desk can update it: only the native install updates itself.
    pub updatable: bool,
}

/// The Claude account Claude Code is signed in with.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccount {
    pub email: Option<String>,
    pub organization: Option<String>,
    pub plan: Option<String>,
    pub api_provider: Option<String>,
    pub api_key_source: Option<String>,
}

/// An MCP server Claude Code loads.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    /// "connected", "failed", "needs-auth", "pending" or "disabled".
    pub status: String,
    pub own_project: bool,
    pub target: Option<String>,
    #[serde(default)]
    pub tools: u32,
    pub error: Option<String>,
}

/// A model Claude Code offers the account.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    /// What a session is started with, such as "opus". "default" is Claude Code's own default.
    pub value: String,
    pub label: String,
    pub description: String,
    /// The model that runs, such as "claude-opus-5-5".
    pub resolved_model: Option<String>,
    /// The effort levels the model takes. Empty when it takes none.
    pub efforts: Vec<String>,
    /// The effort Claude Code uses when the tab sets none.
    pub default_effort: Option<String>,
    /// Whether the model has fast mode.
    pub fast: bool,
    /// Whether the model takes the Auto permission mode.
    pub auto_mode: bool,
}

/// How full a thread's context window is.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextReading {
    pub percent: f64,
    pub tokens: f64,
    pub max_tokens: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct TextEdit {
    pub before: String,
    pub after: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub output: String,
    pub is_error: bool,
}

/// A file a turn changed, without its diff.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

/// One question of an AskUserQuestion call.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub header: String,
    pub question: String,
    pub options: Vec<QuestionOption>,
    pub multi_select: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct QuestionOption {
    pub label: String,
    pub description: Option<String>,
}

/// One plan usage window, such as the five-hour one.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub label: String,
    /// Percentage used, 0 to 100.
    pub percent: f64,
    pub resets_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct PlanUsage {
    pub windows: Vec<UsageWindow>,
}

/// One change to a plugin's UI tree. The plugin's code builds the tree in the core, and the app draws
/// each node with Desk's own component of that name.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum UiOp {
    Create { id: u64, #[serde(rename = "type")] kind: String },
    Text { id: u64, text: String },
    Set { id: u64, key: String, #[serde(default)] value: Value },
    Insert { parent: u64, id: u64, before: Option<u64> },
    Remove { parent: u64, id: u64 },
}

/// A view a plugin drew for a tab: a sidebar, a panel instance or a card, by its root node.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct DrawnView {
    pub id: String,
    pub title: String,
    pub plugin: String,
    pub root: u64,
}

/// What plugins show in a tab. The core keeps it and sends it whole on every change.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct TabLayout {
    pub sidebar: Option<DrawnView>,
    pub panels: Vec<DrawnView>,
    pub cards: Vec<DrawnView>,
}

/// One thing a plugin offers in the palette.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Contribution {
    pub id: String,
    pub title: String,
    /// For a command that runs on text, what to ask for.
    pub input: Option<String>,
}

/// What the plugins on in a project let the user start.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct PluginContributions {
    pub panels: Vec<Contribution>,
    pub commands: Vec<Contribution>,
}

/// A setup a plugin offers, and the project it opens in.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ProjectSetup {
    pub project: String,
    pub id: String,
    pub title: String,
}

/// A past thread of a project, which a tab can continue.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    /// Claude's session id, which resumes the thread.
    pub id: String,
    pub title: String,
    pub branch: Option<String>,
    /// Milliseconds since the epoch.
    pub updated_at: f64,
    /// The tab that has the thread open, if one does.
    pub tab_id: Option<String>,
}

/// Commits ahead of and behind the upstream branch.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Upstream {
    pub ahead: u32,
    pub behind: u32,
}

/// Uncommitted changes against HEAD, untracked files included.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Changes {
    #[serde(default)]
    pub files: u32,
    #[serde(default)]
    pub additions: u32,
    #[serde(default)]
    pub deletions: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Checks {
    pub passed: u32,
    pub failed: u32,
    pub pending: u32,
}

/// The branch's pull request, when `gh` finds one.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct PullRequest {
    pub number: u32,
    pub title: String,
    pub url: String,
    /// "OPEN", "CLOSED" or "MERGED".
    pub state: String,
    pub draft: bool,
    pub checks: Checks,
}

/// The project's Git checkout.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Space {
    pub root: String,
    pub branch: String,
    pub upstream: Option<Upstream>,
    #[serde(default)]
    pub changes: Changes,
    pub pr: Option<PullRequest>,
}

/// A subagent Claude started in a turn, sent whole each time it changes. It runs beside the thread.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Subagent {
    pub id: String,
    pub description: String,
    /// The kind of agent, such as "Explore".
    #[serde(rename = "type")]
    pub kind: Option<String>,
    /// "running", "completed", "failed" or "stopped".
    pub status: String,
    pub started_at: f64,
    pub ended_at: Option<f64>,
    pub summary: Option<String>,
    #[serde(default)]
    pub tool_uses: u32,
    pub prompt: Option<String>,
    pub items: Vec<ThreadItem>,
}

/// Where a command's last run stands: "idle", "running", "exited" or "failed", which has its exit code.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CommandRun {
    pub state: String,
    pub code: Option<i32>,
}

/// A project's command, run in the background in its folder. Commands that share a group run together.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CommandInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub group: Option<String>,
    pub run: CommandRun,
}

/// A file in a project that defines commands, such as a Procfile, and the commands found in it.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CommandSource {
    /// What the import menu calls it, such as "Procfile.dev" or "package.json".
    pub name: String,
    pub commands: Vec<FoundCommand>,
}

/// A command a project's file defines, for the command editor's import menu.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct FoundCommand {
    pub name: String,
    pub command: String,
}

/// A process in the command editor. `id` is the saved command it replaces, when it replaces one.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CommandProcess {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub command: String,
}

/// A command Claude Code offers: a skill, or one of its own such as /compact.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// What follows the slash, such as "pdf".
    pub name: String,
    pub description: String,
    /// What the command takes after its name, such as "<file>".
    pub argument_hint: Option<String>,
    /// Whether it is Claude Code's own command, rather than a skill.
    #[serde(default)]
    pub builtin: bool,
}

/// A file a thread or the checkout changed, with its unified diff. Empty for binary files.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub patch: String,
}

/// A file as the panel shows it. A binary file has no text, and a large one shows only its start.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct FileView {
    pub path: String,
    pub text: Option<String>,
    #[serde(default)]
    pub binary: bool,
    #[serde(default)]
    pub truncated: bool,
}

/// An image sent with a message, as base64.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachment {
    pub media_type: String,
    pub data: String,
}

/// A message waiting for the running turn to end.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct QueuedMessage {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub images: Vec<ImageAttachment>,
}

/// What a step did, which picks its icon. The core names it.
#[derive(Clone, Copy, Debug, Deserialize, Hash, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StepKind {
    Thought,
    Command,
    Edit,
    Read,
    Search,
    Web,
    Other,
}

/// One item of a thread, shaped for drawing by the core. Items are told apart by id within their thread.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum ThreadItem {
    /// A message that starts a turn. `at` is when it was sent, in milliseconds since the epoch.
    User {
        id: String,
        text: String,
        #[serde(default)]
        images: Vec<ImageAttachment>,
        at: Option<f64>,
        /// Sent into a turn that was still running.
        #[serde(default)]
        steered: bool,
        /// A turn Claude Code started itself. Its text says why.
        #[serde(default)]
        self_started: bool,
    },
    /// Assistant text. Text still streaming is not done.
    Text { id: String, text: String, done: bool, at: Option<f64> },
    Thinking { id: String, text: Option<String>, kind: StepKind, label: String },
    Tool {
        id: String,
        name: String,
        /// What the call was given, in short.
        summary: String,
        file: Option<String>,
        edits: Option<Vec<TextEdit>>,
        result: Option<ToolResult>,
        kind: StepKind,
        label: String,
    },
    /// A tool call waiting for the user's approval. It leaves the thread once answered.
    Permission {
        id: String,
        request_id: String,
        tool: String,
        kind: String,
        detail: String,
        reason: Option<String>,
        allow_session: bool,
        #[serde(default)]
        answered: bool,
    },
    /// Questions Claude asks. They show in the composer, never in the thread.
    Question {
        id: String,
        request_id: String,
        questions: Vec<Question>,
        #[serde(default)]
        answered: bool,
    },
    Compaction { id: String, status: String, pre_tokens: Option<f64>, post_tokens: Option<f64>, error: Option<String> },
    /// The end of a turn.
    Result {
        id: String,
        duration_ms: f64,
        is_error: bool,
        #[serde(default)]
        stopped: bool,
    },
    Error { id: String, message: String },
    /// The files a turn changed, added once the turn ends.
    Changes { id: String, files: Vec<ChangedFile> },
}

impl ThreadItem {
    pub fn id(&self) -> &str {
        match self {
            ThreadItem::User { id, .. }
            | ThreadItem::Text { id, .. }
            | ThreadItem::Thinking { id, .. }
            | ThreadItem::Tool { id, .. }
            | ThreadItem::Permission { id, .. }
            | ThreadItem::Question { id, .. }
            | ThreadItem::Compaction { id, .. }
            | ThreadItem::Result { id, .. }
            | ThreadItem::Error { id, .. }
            | ThreadItem::Changes { id, .. } => id,
        }
    }
}

/// A row of the thread as the core lays it out. Rows hold item ids.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum ThreadRow {
    Item { id: String },
    /// Steps in a row. The last group of a running turn is live: it shows its latest step.
    Group { id: String, steps: Vec<String>, live: bool, summary: String },
    /// A finished turn's work, folded into one row. Its rows are items and groups.
    Fold { id: String, rows: Vec<ThreadRow>, duration_ms: Option<f64>, stopped: bool },
    /// The head of a running turn. `since` is when its message was sent.
    Working { id: String, since: Option<f64> },
}

impl ThreadRow {
    pub fn id(&self) -> &str {
        match self {
            ThreadRow::Item { id } | ThreadRow::Group { id, .. } | ThreadRow::Fold { id, .. } | ThreadRow::Working { id, .. } => id,
        }
    }
}

/// A change to a thread. An item replaces the item with the same id, or joins after the others.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum ThreadEvent {
    #[serde(rename = "item")]
    Item { item: ThreadItem },
    /// More text for a text item still streaming.
    #[serde(rename = "text.delta")]
    TextDelta { id: String, delta: String },
    #[serde(rename = "status")]
    Status { busy: bool },
    #[serde(rename = "context")]
    Context { reading: ContextReading },
    /// The model that runs, as the session reports it.
    #[serde(rename = "init")]
    Init { model: String },
    #[serde(rename = "subagent")]
    Subagent { subagent: Subagent },
    /// The commands running in the background now, sent whole each time the set changes.
    #[serde(rename = "background")]
    Background { tasks: Vec<BackgroundTask> },
    /// An event the app does not read yet.
    #[serde(other)]
    Other,
}

/// A command Claude left running in the background, such as a long review or a dev server.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTask {
    pub id: String,
    /// What it runs, as Claude Code describes it.
    pub label: String,
    /// When Desk first saw it, in milliseconds since the epoch.
    pub started_at: f64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum CoreMessage {
    #[serde(rename = "settings")]
    Settings { settings: DeskSettings },
    /// The window's saved tabs, sent once on connect.
    #[serde(rename = "tabs")]
    Tabs { tabs: Vec<TabInfo>, active: Option<String> },
    /// Folders tabs have opened, most recent first.
    #[serde(rename = "recent")]
    Recent { projects: Vec<String> },
    #[serde(rename = "models")]
    Models { models: Vec<ModelOption> },
    /// A closed tab to add back at `index`.
    #[serde(rename = "tab.reopened")]
    TabReopened { tab: TabInfo, index: usize },
    /// A tab's new name, from a plugin's thread or a rename.
    #[serde(rename = "tab.title")]
    TabTitle {
        #[serde(rename = "tabId")]
        tab_id: String,
        title: String,
    },
    /// The Claude session a tab's thread runs in. It is absent until the thread's first message starts one.
    #[serde(rename = "thread.session", rename_all = "camelCase")]
    ThreadSession {
        tab_id: String,
        #[serde(default)]
        session_id: Option<String>,
    },
    /// A copy of a tab's session, which the app opens in a new tab beside it.
    #[serde(rename = "thread.forked", rename_all = "camelCase")]
    ThreadForked { tab_id: String, thread_id: String, title: String },
    #[serde(rename = "session.event")]
    SessionEvent {
        #[serde(rename = "tabId")]
        tab_id: String,
        event: ThreadEvent,
    },
    /// A thread read back from Claude's transcript, in one message.
    #[serde(rename = "session.history")]
    SessionHistory {
        #[serde(rename = "tabId")]
        tab_id: String,
        items: Vec<ThreadItem>,
        context: Option<ContextReading>,
    },
    /// A tab's thread as rows, sent after its history and whenever an event changes them.
    #[serde(rename = "session.rows")]
    SessionRows {
        #[serde(rename = "tabId")]
        tab_id: String,
        rows: Vec<ThreadRow>,
    },
    /// Something read about a project. `value` decodes by `part`, in `projects.rs`.
    #[serde(rename = "project")]
    Project { project: String, part: String, value: Value },
    #[serde(rename = "terminal.output")]
    TerminalOutput { id: String, data: String },
    /// The shell ended. Its exit code is not shown.
    #[serde(rename = "terminal.exit")]
    TerminalExit { id: String },
    /// The files a tab's thread changed, in a Review scope.
    #[serde(rename = "review")]
    Review {
        #[serde(rename = "tabId")]
        tab_id: String,
        scope: String,
        files: Vec<FileChange>,
    },
    /// A file read for the panel, for the `path` that was asked for.
    #[serde(rename = "file")]
    File { project: String, path: String, file: FileView },
    /// The answer to `files.search`, with the query it answers: paths relative to the project, best match first.
    #[serde(rename = "files.found")]
    FilesFound { project: String, query: String, paths: Vec<String> },
    /// Changes to a plugin's UI. With `reset`, they replace every node the app holds for the plugin.
    #[serde(rename = "plugin.ops")]
    PluginOps {
        plugin: String,
        ops: Vec<UiOp>,
        #[serde(default)]
        reset: bool,
    },
    /// What plugins show in a tab, sent whole on every change.
    #[serde(rename = "layout")]
    Layout {
        #[serde(rename = "tabId")]
        tab_id: String,
        layout: TabLayout,
    },
    /// A panel instance opened, so the app brings it to the front and opens the view pane.
    #[serde(rename = "panel.show")]
    PanelShow {
        #[serde(rename = "tabId")]
        tab_id: String,
        id: String,
    },
    /// Setups across projects, each with the project it opens in.
    #[serde(rename = "setups")]
    Setups { setups: Vec<ProjectSetup> },
    #[serde(rename = "claude.version")]
    ClaudeVersion { version: ClaudeCodeVersion },
    /// Who Claude Code is signed in as. Absent when it is not signed in.
    #[serde(rename = "account")]
    Account { account: Option<ClaudeAccount> },
    /// Plan usage. Absent when Claude has no plan limits, such as with an API key.
    #[serde(rename = "usage")]
    Usage { usage: Option<PlanUsage> },
    /// A tab's queued messages, sent whole on each change. `held` means a stop or an error paused them.
    #[serde(rename = "queue")]
    Queue {
        #[serde(rename = "tabId")]
        tab_id: String,
        messages: Vec<QueuedMessage>,
        held: bool,
    },
    /// Something failed. `message` says what in one line, and `detail`, when given, holds the cause.
    #[serde(rename = "error")]
    Error {
        message: String,
        #[serde(default)]
        detail: Option<String>,
    },
    /// A short message for the user, such as a plugin's toast.
    #[serde(rename = "notice")]
    Notice { message: String },
    /// A message the app does not read yet. The core sends several on connect.
    #[serde(other)]
    Other,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "models.get")]
    ModelsGet,
    #[serde(rename = "usage.get")]
    UsageGet,
    /// Changes the named settings. The core saves them and sends them back.
    #[serde(rename = "settings.update")]
    SettingsUpdate { change: Value },
    #[serde(rename = "claude.version.get")]
    ClaudeVersionGet,
    /// Updates Claude Code with its own updater. The core answers with `claude.version` once done.
    #[serde(rename = "claude.update")]
    ClaudeUpdate,
    /// Turns an MCP server on or off for the project. Claude Code keeps the choice.
    #[serde(rename = "mcp.toggle")]
    McpToggle { project: String, name: String, enabled: bool },
    /// Reopens the tab closed last. The core answers with `tab.reopened`.
    #[serde(rename = "tab.reopen")]
    TabReopen,
    /// Sends a message. While Claude works, `followUp` says whether it steers the turn or waits in the queue.
    #[serde(rename = "session.send", rename_all = "camelCase")]
    SessionSend {
        tab_id: String,
        text: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        images: Vec<ImageAttachment>,
        #[serde(skip_serializing_if = "Option::is_none")]
        follow_up: Option<String>,
    },
    /// Asks for one part of what the core reads about a project. The core answers with `project`.
    #[serde(rename = "project.get")]
    ProjectGet { project: String, part: String },
    /// Replaces the commands in `replacing` with `processes`. One process saves as a plain command called
    /// `name`, several as a group called `name`.
    #[serde(rename = "commands.save")]
    CommandsSave { project: String, name: String, processes: Vec<CommandProcess>, replacing: Vec<String> },
    #[serde(rename = "commands.remove")]
    CommandsRemove { project: String, ids: Vec<String> },
    #[serde(rename = "commands.run")]
    CommandsRun { project: String, ids: Vec<String> },
    #[serde(rename = "commands.stop")]
    CommandsStop { project: String, ids: Vec<String> },
    /// Finds files in the project whose path matches `query`, for an @ mention. The core answers with `files.found`.
    #[serde(rename = "files.search")]
    FilesSearch { project: String, query: String },
    /// Asks for what plugins show in a saved tab. The core answers with `layout`.
    #[serde(rename = "layout.get", rename_all = "camelCase")]
    LayoutGet { tab_id: String },
    /// Opens a panel instance in a saved tab, or brings the open one to the front.
    #[serde(rename = "panel.open", rename_all = "camelCase")]
    PanelOpen { tab_id: String, panel: String },
    #[serde(rename = "panel.close", rename_all = "camelCase")]
    PanelClose { tab_id: String, id: String },
    /// Lays a saved tab out as a setup says: its sidebar and panels.
    #[serde(rename = "setup.open", rename_all = "camelCase")]
    SetupOpen { tab_id: String, setup: String },
    /// Lists the setups of every project with plugins on, `project`'s first. The core answers with `setups`.
    #[serde(rename = "setups.get")]
    SetupsGet { project: String },
    /// Runs a plugin command for a saved tab.
    #[serde(rename = "plugin.command", rename_all = "camelCase")]
    PluginCommand {
        tab_id: String,
        command: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
    /// Runs a handler a plugin's node holds, such as a button's onClick.
    #[serde(rename = "plugin.event")]
    PluginEvent { plugin: String, handler: u64, args: Vec<Value> },
    /// Starts a terminal, or reattaches to one already running under this id, which replays its output.
    #[serde(rename = "terminal.open")]
    TerminalOpen { id: String, cols: usize, rows: usize },
    #[serde(rename = "terminal.input")]
    TerminalInput { id: String, data: String },
    #[serde(rename = "terminal.resize")]
    TerminalResize { id: String, cols: usize, rows: usize },
    /// The files a tab's thread changed, in a Review scope. The core answers with `review`.
    #[serde(rename = "review.get", rename_all = "camelCase")]
    ReviewGet { tab_id: String, scope: String },
    /// Reads a file to show in the panel. The core answers with `file`.
    #[serde(rename = "file.read")]
    FileRead { project: String, path: String },
    /// Opens a file in the editor. A relative path is in the project.
    #[serde(rename = "file.open")]
    FileOpen {
        project: String,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        line: Option<u32>,
    },
    /// Starts a fresh session in a tab, as /clear asks.
    #[serde(rename = "thread.clear", rename_all = "camelCase")]
    ThreadClear { tab_id: String },
    /// Names a tab and its session. It runs no turn, so a running one goes on.
    #[serde(rename = "thread.rename", rename_all = "camelCase")]
    ThreadRename { tab_id: String, title: String },
    /// Copies a tab's session into a new one, ending with the turn of `message_id` when given. The core answers with `thread.forked`.
    #[serde(rename = "thread.fork", rename_all = "camelCase")]
    ThreadFork {
        tab_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
    },
    /// Takes a tab's thread back to before one of the user's messages. With `restore_files`, the files Claude's tools changed since go back too.
    #[serde(rename = "thread.rewind", rename_all = "camelCase")]
    ThreadRewind { tab_id: String, message_id: String, restore_files: bool },
    /// Deletes a tab's session from this Mac, after stopping a running turn. The tab starts afresh.
    #[serde(rename = "thread.delete", rename_all = "camelCase")]
    ThreadDelete { tab_id: String },
    /// Continues a past thread in a tab that has not started one.
    #[serde(rename = "thread.resume", rename_all = "camelCase")]
    ThreadResume { tab_id: String, thread_id: String },
    #[serde(rename = "session.interrupt", rename_all = "camelCase")]
    SessionInterrupt { tab_id: String },
    #[serde(rename = "permission.answer", rename_all = "camelCase")]
    PermissionAnswer { tab_id: String, request_id: String, answer: String },
    /// Answers Claude's questions, by question text. Without `answers`, the user dismissed them.
    #[serde(rename = "question.answer", rename_all = "camelCase")]
    QuestionAnswer {
        tab_id: String,
        request_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        answers: Option<std::collections::BTreeMap<String, String>>,
    },
    /// Sends a queued message now.
    #[serde(rename = "queue.send", rename_all = "camelCase")]
    QueueSend { tab_id: String, id: String },
    #[serde(rename = "queue.remove", rename_all = "camelCase")]
    QueueRemove { tab_id: String, id: String },
    /// Sends the queue again after a stop or an error paused it.
    #[serde(rename = "queue.resume", rename_all = "camelCase")]
    QueueResume { tab_id: String },
    /// Stops commands Claude left running in the background in a tab.
    #[serde(rename = "tasks.stop", rename_all = "camelCase")]
    TasksStop { tab_id: String, ids: Vec<String> },
    /// Desk's window gained or lost focus. Plugins hear which of their views are on screen.
    #[serde(rename = "window.focus")]
    WindowFocus { focused: bool },
    /// The window's tabs, in order, sent whenever they change.
    #[serde(rename = "tabs.save")]
    TabsSave {
        tabs: Vec<TabInfo>,
        #[serde(skip_serializing_if = "Option::is_none")]
        active: Option<String>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    /// One fixture list as JSON, printed by Bun from the TypeScript that the typecheck holds to the protocol.
    fn fixtures(name: &str) -> Vec<Value> {
        printed("fixtures", name)
    }

    /// A list `protocol/src/<module>.ts` exports, as JSON, printed by Bun.
    fn printed(module: &str, name: &str) -> Vec<Value> {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let script = format!("import {{ {name} }} from './protocol/src/{module}.ts'; console.log(JSON.stringify({name}))");
        let out = Command::new(std::env::var("DESK_BUN").unwrap_or_else(|_| "bun".into()))
            .args(["-e", &script])
            .current_dir(repo)
            .output()
            .expect("Bun runs the fixture script");
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        serde_json::from_slice(&out.stdout).expect("the fixtures print as JSON")
    }

    fn core_messages() -> Vec<CoreMessage> {
        fixtures("CORE_MESSAGES").into_iter().map(|v| serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))).collect()
    }

    #[test]
    fn decodes_every_core_fixture() {
        for (value, message) in fixtures("CORE_MESSAGES").iter().zip(core_messages()) {
            assert!(!matches!(message, CoreMessage::Other), "a fixture decodes as a message the app reads: {value}");
        }
    }

    #[test]
    fn reads_tabs_and_settings() {
        let messages = core_messages();
        let CoreMessage::Settings { settings } = &messages[0] else { panic!("settings first") };
        assert_eq!(settings.appearance.theme, ThemeChoice::Light);
        assert_eq!(settings.claude.permission_mode, "auto");
        let CoreMessage::Tabs { tabs, active } = &messages[1] else { panic!("tabs second") };
        assert_eq!(tabs.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["Fix the login form", "New session"]);
        assert_eq!(tabs[0].project, "/Users/me/code/web");
        assert_eq!(active.as_deref(), Some("tab-2"));
    }

    #[test]
    fn a_tab_goes_back_with_every_field_it_came_with() {
        for value in fixtures("CORE_MESSAGES").into_iter().filter(|v| v["type"] == "tabs") {
            for tab in value["tabs"].as_array().unwrap() {
                let decoded: TabInfo = serde_json::from_value(tab.clone()).unwrap();
                assert_eq!(&serde_json::to_value(&decoded).unwrap(), tab);
            }
        }
    }

    #[test]
    fn the_catalog_holds_every_icon_a_plugin_may_name() {
        let missing: Vec<String> = printed("icon-names", "ICON_NAMES")
            .into_iter()
            .filter_map(|name| name.as_str().map(str::to_owned))
            .filter(|name| !rune_theme_opencode::icons::ALL.iter().any(|icon| icon.name == name))
            .collect();
        assert!(missing.is_empty(), "the catalog lacks {missing:?}");
    }

    #[test]
    fn client_messages_encode_as_the_fixtures() {
        let CoreMessage::Tabs { tabs, active } = core_messages().remove(1) else { panic!("tabs second") };
        let ours = [
            ClientMessage::ModelsGet,
            ClientMessage::UsageGet,
            ClientMessage::SettingsUpdate { change: serde_json::json!({ "appearance": { "theme": "auto" }, "claude": { "effort": null } }) },
            ClientMessage::ClaudeVersionGet,
            ClientMessage::ClaudeUpdate,
            ClientMessage::McpToggle { project: "/Users/me/code/web".into(), name: "github".into(), enabled: false },
            ClientMessage::TabReopen,
            ClientMessage::TabsSave { tabs, active },
            ClientMessage::SessionSend { tab_id: "tab-1".into(), text: "Add a test".into(), images: vec![], follow_up: Some("queue".into()) },
            ClientMessage::SessionSend { tab_id: "tab-1".into(), text: "Hi".into(), images: vec![ImageAttachment { media_type: "image/png".into(), data: "iVBORw==".into() }], follow_up: None },
            ClientMessage::SessionInterrupt { tab_id: "tab-1".into() },
            ClientMessage::PermissionAnswer { tab_id: "tab-1".into(), request_id: "r1".into(), answer: "allow-session".into() },
            ClientMessage::QuestionAnswer { tab_id: "tab-1".into(), request_id: "r2".into(), answers: Some([("Which form?".to_owned(), "Login".to_owned())].into()) },
            ClientMessage::QuestionAnswer { tab_id: "tab-1".into(), request_id: "r2".into(), answers: None },
            ClientMessage::QueueSend { tab_id: "tab-1".into(), id: "m1".into() },
            ClientMessage::QueueRemove { tab_id: "tab-1".into(), id: "m1".into() },
            ClientMessage::QueueResume { tab_id: "tab-1".into() },
            ClientMessage::TasksStop { tab_id: "tab-1".into(), ids: vec!["b1".into()] },
            ClientMessage::ProjectGet { project: "/Users/me/code/web".into(), part: "threads".into() },
            ClientMessage::ThreadResume { tab_id: "tab-2".into(), thread_id: "s1".into() },
            ClientMessage::CommandsSave {
                project: "/Users/me/code/web".into(),
                name: "Dev".into(),
                processes: vec![CommandProcess { id: Some("c1".into()), name: "web".into(), command: "bun run dev".into() }, CommandProcess { id: None, name: "worker".into(), command: "bun run worker".into() }],
                replacing: vec!["c1".into()],
            },
            ClientMessage::CommandsRemove { project: "/Users/me/code/web".into(), ids: vec!["c1".into()] },
            ClientMessage::CommandsRun { project: "/Users/me/code/web".into(), ids: vec!["c1".into()] },
            ClientMessage::CommandsStop { project: "/Users/me/code/web".into(), ids: vec!["c1".into()] },
            ClientMessage::FilesSearch { project: "/Users/me/code/web".into(), query: "login".into() },
            ClientMessage::ThreadClear { tab_id: "tab-1".into() },
            ClientMessage::ThreadRename { tab_id: "tab-1".into(), title: "Login fix".into() },
            ClientMessage::ThreadFork { tab_id: "tab-1".into(), message_id: None },
            ClientMessage::ThreadFork { tab_id: "tab-1".into(), message_id: Some("u1".into()) },
            ClientMessage::ThreadRewind { tab_id: "tab-1".into(), message_id: "u2".into(), restore_files: true },
            ClientMessage::ThreadDelete { tab_id: "tab-1".into() },
            ClientMessage::LayoutGet { tab_id: "tab-1".into() },
            ClientMessage::PanelOpen { tab_id: "tab-1".into(), panel: "support.inbox".into() },
            ClientMessage::PanelClose { tab_id: "tab-1".into(), id: "support.conversation?id=1001".into() },
            ClientMessage::SetupOpen { tab_id: "tab-1".into(), setup: "support.triage".into() },
            ClientMessage::SetupsGet { project: "/Users/me/code/web".into() },
            ClientMessage::PluginCommand { tab_id: "tab-1".into(), command: "support.search".into(), input: Some("refund".into()) },
            ClientMessage::PluginEvent { plugin: "support".into(), handler: 3, args: vec![serde_json::json!("hi")] },
            ClientMessage::TerminalOpen { id: "term-1".into(), cols: 80, rows: 24 },
            ClientMessage::TerminalInput { id: "term-1".into(), data: "ls\r".into() },
            ClientMessage::TerminalResize { id: "term-1".into(), cols: 100, rows: 30 },
            ClientMessage::ReviewGet { tab_id: "tab-1".into(), scope: "git".into() },
            ClientMessage::FileRead { project: "/Users/me/code/web".into(), path: "src/login.ts".into() },
            ClientMessage::FileOpen { project: "/Users/me/code/web".into(), path: "src/login.ts".into(), line: Some(12) },
            ClientMessage::WindowFocus { focused: false },
        ];
        let encoded: Vec<Value> = ours.iter().map(|m| serde_json::to_value(m).unwrap()).collect();
        assert_eq!(encoded, fixtures("CLIENT_MESSAGES"));
    }

    #[test]
    fn reads_a_thread_and_its_rows() {
        let messages = core_messages();
        let history = messages.iter().find_map(|m| match m {
            CoreMessage::SessionHistory { items, .. } => Some(items),
            _ => None,
        });
        let items = history.expect("a history fixture");
        assert!(matches!(&items[0], ThreadItem::User { steered: true, .. }));
        assert!(items.iter().any(|i| matches!(i, ThreadItem::Tool { kind: StepKind::Command, result: Some(_), .. })));
        let rows = messages.iter().find_map(|m| match m {
            CoreMessage::SessionRows { rows, .. } => Some(rows),
            _ => None,
        });
        assert!(matches!(&rows.expect("a rows fixture")[1], ThreadRow::Fold { rows, duration_ms: Some(_), .. } if matches!(&rows[0], ThreadRow::Group { .. })));
        for m in &messages {
            if let CoreMessage::SessionEvent { event, .. } = m {
                assert!(!matches!(event, ThreadEvent::Other), "an event the app reads: {event:?}");
            }
        }
    }

    #[test]
    fn skips_messages_it_does_not_read() {
        let message: CoreMessage = serde_json::from_str(r#"{"type":"some.future.message","value":{}}"#).unwrap();
        assert!(matches!(message, CoreMessage::Other));
    }
}
