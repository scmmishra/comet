//! What the core says about Desk's settings and the Claude account.

use crate::protocol::{ClaudeAccount, ClaudeCodeVersion, DeskSettings, ModelOption, PlanUsage, ProjectSettings, ThemeChoice};

/// The thread's text size before the settings arrive, as `DEFAULT_SETTINGS` has it.
const DEFAULT_TEXT_SIZE: f32 = 14.0;

#[derive(Default)]
pub struct Account {
    /// None until the core sends them, which it does first on connect.
    pub settings: Option<DeskSettings>,
    pub models: Vec<ModelOption>,
    /// None until read, and when Claude has no plan limits.
    pub usage: Option<PlanUsage>,
    /// Who Claude Code is signed in as: None until read, Some(None) when not signed in.
    pub user: Option<Option<ClaudeAccount>>,
    pub claude_code: Option<ClaudeCodeVersion>,
    /// Whether Claude Code is updating itself.
    pub updating: bool,
}

impl Account {
    /// The families for Rune's sans and mono slots: the fonts Settings named, falling back to Geist.
    pub fn font_families(&self) -> (String, String) {
        let (sans, mono) = crate::theme::FAMILIES;
        let pick = |named: Option<&str>, bundled: &str| match named.map(str::trim).filter(|n| !n.is_empty()) {
            Some(named) => format!("{named}, {bundled}"),
            None => bundled.to_owned(),
        };
        let appearance = self.settings.as_ref().map(|s| &s.appearance);
        (pick(appearance.map(|a| a.ui_font.as_str()), sans), pick(appearance.map(|a| a.code_font.as_str()), mono))
    }

    /// A project's name as Settings set it, else its folder's name.
    pub fn project_label(&self, dir: &str) -> String {
        self.project(dir).and_then(|p| p.name.clone()).unwrap_or_else(|| crate::format::project_name(dir).to_owned())
    }

    /// The colour Settings gave a project's mark, if any.
    pub fn project_color(&self, dir: &str) -> Option<&str> {
        self.project(dir).and_then(|p| p.color.as_deref())
    }

    /// The image Settings gave as a project's icon, as a path inside it, if any.
    pub fn project_icon(&self, dir: &str) -> Option<&str> {
        self.project(dir).and_then(|p| p.icon.as_deref())
    }

    fn project(&self, dir: &str) -> Option<&ProjectSettings> {
        self.settings.as_ref()?.projects.get(dir)
    }

    /// The chosen theme. Until the core sends the settings, Desk follows macOS, so a light Mac does not open dark.
    pub fn theme(&self) -> ThemeChoice {
        self.settings.as_ref().map_or(ThemeChoice::Auto, |s| s.appearance.theme)
    }

    /// The thread's text size, Desk's `--desk-text-size`.
    pub fn text_size(&self) -> f32 {
        self.settings.as_ref().map_or(DEFAULT_TEXT_SIZE, |s| s.appearance.font_size)
    }

    pub fn model(&self, value: &str) -> Option<&ModelOption> {
        self.models.iter().find(|m| m.value == value)
    }
}
