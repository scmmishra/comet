//! What the core says about Desk's settings and the Claude account, as `app/src/renderer/account.ts` keeps it.

use crate::protocol::{DeskSettings, ModelOption, PlanUsage, ThemeChoice};

/// The thread's text size before the settings arrive, as `DEFAULT_SETTINGS` has it.
const DEFAULT_TEXT_SIZE: f32 = 14.0;

#[derive(Default)]
pub struct Account {
    /// None until the core sends them, which it does first on connect.
    pub settings: Option<DeskSettings>,
    pub models: Vec<ModelOption>,
    /// None until read, and when Claude has no plan limits.
    pub usage: Option<PlanUsage>,
}

impl Account {
    pub fn theme(&self) -> ThemeChoice {
        self.settings.as_ref().map_or_else(ThemeChoice::default, |s| s.appearance.theme)
    }

    /// The thread's text size, Desk's `--desk-text-size`.
    pub fn text_size(&self) -> f32 {
        self.settings.as_ref().map_or(DEFAULT_TEXT_SIZE, |s| s.appearance.font_size)
    }

    pub fn model(&self, value: &str) -> Option<&ModelOption> {
        self.models.iter().find(|m| m.value == value)
    }
}
