//! The core's messages the native app reads, from `protocol/src/index.ts`. Only the fields the app
//! uses are here. `protocol/src/fixtures.ts` holds one message of each type, and the tests decode them.

use serde::Deserialize;

/// The line the core prints on stdout once it listens.
#[derive(Debug, Deserialize)]
pub struct CoreReady {
    pub port: u16,
}

/// A top tab. The app never sends tabs back in this shape: the core saves tabs as they are sent, so
/// a tab with fields missing would lose them.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct TabInfo {
    pub id: String,
    pub title: String,
    /// The project folder the tab works in.
    pub project: String,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeChoice {
    #[default]
    Dark,
    Light,
    Auto,
}

#[derive(Debug, Deserialize)]
pub struct AppearanceSettings {
    pub theme: ThemeChoice,
}

#[derive(Debug, Deserialize)]
pub struct DeskSettings {
    pub appearance: AppearanceSettings,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum CoreMessage {
    #[serde(rename = "settings")]
    Settings { settings: DeskSettings },
    /// The window's saved tabs, sent once on connect.
    #[serde(rename = "tabs")]
    Tabs { tabs: Vec<TabInfo>, active: Option<String> },
    /// Something the user asked for failed.
    #[serde(rename = "error")]
    Error { message: String },
    /// A message the app does not read yet. The core sends several on connect.
    #[serde(other)]
    Other,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    /// The fixtures as JSON, printed by Bun from the TypeScript that the typecheck holds to the protocol.
    fn fixtures() -> Vec<serde_json::Value> {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let script = "import { CORE_MESSAGES } from './protocol/src/fixtures.ts'; console.log(JSON.stringify(CORE_MESSAGES))";
        let out = Command::new(std::env::var("DESK_BUN").unwrap_or_else(|_| "bun".into()))
            .args(["-e", script])
            .current_dir(repo)
            .output()
            .expect("Bun runs the fixture script");
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        serde_json::from_slice(&out.stdout).expect("the fixtures print as JSON")
    }

    #[test]
    fn decodes_every_fixture_the_core_sends() {
        for value in fixtures() {
            let message: CoreMessage = serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("{e}: {value}"));
            assert!(!matches!(message, CoreMessage::Other), "a fixture decodes as a message the app reads: {value}");
        }
    }

    #[test]
    fn reads_tabs_and_settings() {
        let messages: Vec<CoreMessage> = fixtures().into_iter().map(|v| serde_json::from_value(v).unwrap()).collect();
        let CoreMessage::Settings { settings } = &messages[0] else { panic!("settings first") };
        assert_eq!(settings.appearance.theme, ThemeChoice::Light);
        let CoreMessage::Tabs { tabs, active } = &messages[1] else { panic!("tabs second") };
        assert_eq!(tabs.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["Fix the login form", "New session"]);
        assert_eq!(tabs[0].project, "/Users/me/code/web");
        assert_eq!(active.as_deref(), Some("tab-2"));
        let CoreMessage::Tabs { active, .. } = &messages[2] else { panic!("empty tabs third") };
        assert_eq!(*active, None);
    }

    #[test]
    fn skips_messages_it_does_not_read() {
        let message: CoreMessage = serde_json::from_str(r#"{"type":"plugin.ops","plugin":"x","ops":[]}"#).unwrap();
        assert!(matches!(message, CoreMessage::Other));
    }
}
