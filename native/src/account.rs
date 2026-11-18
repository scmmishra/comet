//! What the core says about Comet's settings and the agents it runs.

use crate::protocol::{AgentDefaults, AgentInfo, ColorTheme, CometSettings, ModelOption, PlanUsage, ProjectSettings, ThemeChoice};

/// The thread's text size before the settings arrive, as `DEFAULT_SETTINGS` has it.
const DEFAULT_TEXT_SIZE: f32 = 14.0;
/// The agent a tab runs before the settings arrive, the protocol's `DEFAULT_AGENT`.
pub const DEFAULT_AGENT: &str = "claude";
/// An agent's own default model, the protocol's `DEFAULT_MODEL`. Every agent lists it first.
pub const DEFAULT_MODEL: &str = "default";

#[derive(Default)]
pub struct Account {
    /// None until the core sends them, which it does first on connect.
    pub settings: Option<CometSettings>,
    /// The agents Comet runs, in Comet's order. Empty until the core sends them.
    pub agents: Vec<AgentInfo>,
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

    /// The chosen theme. Until the core sends the settings, Comet follows macOS, so a light Mac does not open dark.
    pub fn theme(&self) -> ThemeChoice {
        self.settings.as_ref().map_or(ThemeChoice::Auto, |s| s.appearance.theme)
    }

    /// The chosen colour theme, Comet's own until the core sends the settings.
    pub fn color_theme(&self) -> ColorTheme {
        self.settings.as_ref().map_or(ColorTheme::Comet, |s| s.appearance.color_theme)
    }

    /// The thread's text size, Comet's `--comet-text-size`.
    pub fn text_size(&self) -> f32 {
        self.settings.as_ref().map_or(DEFAULT_TEXT_SIZE, |s| s.appearance.font_size)
    }

    pub fn agent(&self, id: &str) -> Option<&AgentInfo> {
        self.agents.iter().find(|a| a.id == id)
    }

    /// One of an agent's models, by its value.
    pub fn model(&self, agent: &str, value: &str) -> Option<&ModelOption> {
        self.agent(agent)?.models.iter().find(|m| m.value == value)
    }

    /// Whether an agent can do something beyond a conversation, such as "rewind". An agent not read yet can do nothing.
    pub fn can(&self, agent: &str, feature: &str) -> bool {
        self.agent(agent).is_some_and(|a| a.features.iter().any(|f| f == feature))
    }

    /// The agent a new tab starts with.
    pub fn default_agent(&self) -> &str {
        self.settings.as_ref().map_or(DEFAULT_AGENT, |s| s.threads.agent.as_str())
    }

    /// What a new tab starts an agent with, once the settings have arrived.
    pub fn defaults(&self, agent: &str) -> Option<&AgentDefaults> {
        self.settings.as_ref()?.agents.get(agent)
    }

    /// An agent's plan usage, when it has plan limits and they have been read.
    pub fn usage(&self, agent: &str) -> Option<&PlanUsage> {
        self.agent(agent)?.usage.as_ref()
    }
}
