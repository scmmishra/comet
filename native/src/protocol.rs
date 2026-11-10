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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub theme: ThemeChoice,
    /// The thread's text, in points.
    pub font_size: f32,
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
}

#[derive(Clone, Debug, Deserialize)]
pub struct DeskSettings {
    pub appearance: AppearanceSettings,
    pub claude: ClaudeSettings,
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

/// A message waiting for the running turn to end.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct QueuedMessage {
    pub id: String,
    pub text: String,
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
    /// An event the app does not read yet.
    #[serde(other)]
    Other,
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
    /// A plugin opened a thread in a tab under this name.
    #[serde(rename = "tab.title")]
    TabTitle {
        #[serde(rename = "tabId")]
        tab_id: String,
        title: String,
    },
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
    /// A tab's queued messages, sent whole on each change. `held` means a stop or an error paused them.
    #[serde(rename = "queue")]
    Queue {
        #[serde(rename = "tabId")]
        tab_id: String,
        messages: Vec<QueuedMessage>,
        held: bool,
    },
    /// Something the user asked for failed.
    #[serde(rename = "error")]
    Error { message: String },
    /// A message the app does not read yet. The core sends several on connect.
    #[serde(other)]
    Other,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "models.get")]
    ModelsGet,
    /// Reopens the tab closed last. The core answers with `tab.reopened`.
    #[serde(rename = "tab.reopen")]
    TabReopen,
    /// Sends a message. While Claude works, `followUp` says whether it steers the turn or waits in the queue.
    #[serde(rename = "session.send", rename_all = "camelCase")]
    SessionSend {
        tab_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        follow_up: Option<String>,
    },
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
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let script = format!("import {{ {name} }} from './protocol/src/fixtures.ts'; console.log(JSON.stringify({name}))");
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
    fn client_messages_encode_as_the_fixtures() {
        let CoreMessage::Tabs { tabs, active } = core_messages().remove(1) else { panic!("tabs second") };
        let ours = [
            ClientMessage::ModelsGet,
            ClientMessage::TabReopen,
            ClientMessage::TabsSave { tabs, active },
            ClientMessage::SessionSend { tab_id: "tab-1".into(), text: "Add a test".into(), follow_up: Some("queue".into()) },
            ClientMessage::SessionSend { tab_id: "tab-1".into(), text: "Hi".into(), follow_up: None },
            ClientMessage::SessionInterrupt { tab_id: "tab-1".into() },
            ClientMessage::PermissionAnswer { tab_id: "tab-1".into(), request_id: "r1".into(), answer: "allow-session".into() },
            ClientMessage::QuestionAnswer { tab_id: "tab-1".into(), request_id: "r2".into(), answers: Some([("Which form?".to_owned(), "Login".to_owned())].into()) },
            ClientMessage::QuestionAnswer { tab_id: "tab-1".into(), request_id: "r2".into(), answers: None },
            ClientMessage::QueueSend { tab_id: "tab-1".into(), id: "m1".into() },
            ClientMessage::QueueRemove { tab_id: "tab-1".into(), id: "m1".into() },
            ClientMessage::QueueResume { tab_id: "tab-1".into() },
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
        let message: CoreMessage = serde_json::from_str(r#"{"type":"plugin.ops","plugin":"x","ops":[]}"#).unwrap();
        assert!(matches!(message, CoreMessage::Other));
    }
}
