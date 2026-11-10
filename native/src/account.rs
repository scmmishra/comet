//! What the core says about Desk's settings and the Claude account, as `app/src/renderer/account.ts` keeps it.

use crate::protocol::{DeskSettings, ModelOption, ThemeChoice};

#[derive(Default)]
pub struct Account {
    /// None until the core sends them, which it does first on connect.
    pub settings: Option<DeskSettings>,
    pub models: Vec<ModelOption>,
}

impl Account {
    pub fn theme(&self) -> ThemeChoice {
        self.settings.as_ref().map_or_else(ThemeChoice::default, |s| s.appearance.theme)
    }

    pub fn model(&self, value: &str) -> Option<&ModelOption> {
        self.models.iter().find(|m| m.value == value)
    }
}

/// The permission mode a model keeps when it becomes the model: the chosen one if it takes it, else
/// Supervised. Auto needs a model that supports it (`permissionFor` in `app/src/renderer/models.ts`).
pub fn permission_for(option: Option<&ModelOption>, mode: &str) -> String {
    let takes = mode != "auto" || option.is_some_and(|o| o.auto_mode);
    if takes { mode } else { "default" }.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(auto_mode: bool) -> ModelOption {
        ModelOption { value: "m".into(), auto_mode }
    }

    #[test]
    fn auto_needs_a_model_that_takes_it() {
        assert_eq!(permission_for(Some(&model(true)), "auto"), "auto");
        assert_eq!(permission_for(Some(&model(false)), "auto"), "default");
        assert_eq!(permission_for(None, "auto"), "default");
        assert_eq!(permission_for(None, "acceptEdits"), "acceptEdits");
    }
}
