//! The models an agent offers and how a tab's run settings follow them.

use crate::icons;
use crate::protocol::ModelOption;
use rune::Icon;
use rune_theme_opencode::icons as ic;

/// Each effort's words. A level Comet has no words for shows as its agent names it.
pub fn effort_label(effort: &str) -> &str {
    match effort {
        "low" => "Low",
        "medium" => "Medium",
        "high" => "High",
        "xhigh" => "Extra high",
        "max" => "Max",
        "ultra" => "Ultra",
        "minimal" => "Minimal",
        "none" => "None",
        other => other,
    }
}

/// Permission modes, in T3 Code's words and order: the value, its label, what it does, and its icon.
pub const PERMISSION: [(&str, &str, &str, &Icon); 4] = [
    ("default", "Supervised", "Asks before commands and file changes.", &ic::LOCK),
    ("acceptEdits", "Auto-accept edits", "Makes edits, and asks before anything else.", &ic::EDIT),
    ("auto", "Auto", "Approves routine actions, asks about the rest.", &icons::SPARKLE),
    ("bypassPermissions", "Full access", "Edits and runs commands without asking.", &icons::SHIELD_OFF),
];

/// A mode's label, what it does and its icon. An unknown mode reads as Supervised.
pub fn permission(mode: &str) -> (&'static str, &'static str, &'static Icon) {
    let (_, label, description, icon) = PERMISSION.iter().find(|p| p.0 == mode).copied().unwrap_or(PERMISSION[0]);
    (label, description, icon)
}

/// The effort a model keeps when it becomes the model: the chosen one if it takes it, else its default.
pub fn effort_for(option: &ModelOption, effort: Option<&str>) -> Option<String> {
    effort.filter(|e| option.efforts.iter().any(|x| x == e)).map(str::to_owned)
}

/// The permission modes a model takes, in Comet's order. Before the models arrive, every mode but Auto shows,
/// since Auto needs a model that supports it.
pub fn permission_modes(option: Option<&ModelOption>) -> impl Iterator<Item = &'static str> + '_ {
    PERMISSION.iter().map(|p| p.0).filter(move |mode| option.map_or(*mode != "auto", |o| o.permission_modes.iter().any(|m| m == mode)))
}

/// The permission mode a model keeps when it becomes the model: the chosen one if it takes it, else Supervised.
pub fn permission_for(option: Option<&ModelOption>, mode: &str) -> String {
    if permission_modes(option).any(|m| m == mode) { mode } else { "default" }.to_owned()
}

/// A model's name as the picker shows it: the model that runs, so "Default" reads as "Opus 5.5".
pub fn option_label(option: &ModelOption) -> &str {
    option.runs.as_deref().unwrap_or(&option.label)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(value: &str, modes: &[&str]) -> ModelOption {
        ModelOption { value: value.into(), label: value.into(), description: String::new(), runs: None, efforts: vec!["low".into(), "high".into()], default_effort: None, fast: false, permission_modes: modes.iter().map(|m| (*m).to_owned()).collect(), older: false }
    }

    #[test]
    fn a_mode_needs_a_model_that_takes_it() {
        let every = model("m", &["default", "acceptEdits", "auto", "bypassPermissions"]);
        let some = model("m", &["default", "acceptEdits", "bypassPermissions"]);
        assert_eq!(permission_for(Some(&every), "auto"), "auto");
        assert_eq!(permission_for(Some(&some), "auto"), "default");
        assert_eq!(permission_for(None, "auto"), "default");
        assert_eq!(permission_for(None, "acceptEdits"), "acceptEdits");
        assert_eq!(permission_modes(Some(&some)).collect::<Vec<_>>(), ["default", "acceptEdits", "bypassPermissions"]);
    }

    #[test]
    fn names_the_model_that_runs_and_keeps_only_efforts_a_model_takes() {
        let mut default = model("default", &[]);
        assert_eq!(option_label(&default), "default");
        default.runs = Some("Opus 5.5".into());
        assert_eq!(option_label(&default), "Opus 5.5");
        assert_eq!(effort_for(&default, Some("high")).as_deref(), Some("high"));
        assert_eq!(effort_for(&default, Some("max")), None);
        assert_eq!(effort_label("ultra"), "Ultra");
    }
}
