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
pub struct AppearanceSettings {
    pub theme: ThemeChoice,
}

/// The run settings a new tab starts with.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSettings {
    pub model: String,
    pub effort: Option<String>,
    pub permission_mode: String,
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
    pub value: String,
    /// Whether the model takes the Auto permission mode.
    pub auto_mode: bool,
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
        let ours = [ClientMessage::ModelsGet, ClientMessage::TabReopen, ClientMessage::TabsSave { tabs, active }];
        let encoded: Vec<Value> = ours.iter().map(|m| serde_json::to_value(m).unwrap()).collect();
        assert_eq!(encoded, fixtures("CLIENT_MESSAGES"));
    }

    #[test]
    fn skips_messages_it_does_not_read() {
        let message: CoreMessage = serde_json::from_str(r#"{"type":"plugin.ops","plugin":"x","ops":[]}"#).unwrap();
        assert!(matches!(message, CoreMessage::Other));
    }
}
