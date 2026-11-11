//! The models Claude Code offers and how a tab's run settings follow them.

use crate::icons;
use crate::protocol::ModelOption;
use rune::Icon;
use rune_theme_opencode::icons as ic;

/// Each effort's words.
pub fn effort_label(effort: &str) -> &str {
    match effort {
        "low" => "Low",
        "medium" => "Medium",
        "high" => "High",
        "xhigh" => "Extra high",
        "max" => "Max",
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

/// Aliases such as "opus" follow the newest model of a family, so they lead the list. Pinned models,
/// such as "claude-opus-4-8", wait behind "Show older models".
pub fn is_alias(option: &ModelOption) -> bool {
    !option.value.starts_with("claude-")
}

/// The effort a model keeps when it becomes the model: the chosen one if it takes it, else its default.
pub fn effort_for(option: &ModelOption, effort: Option<&str>) -> Option<String> {
    effort.filter(|e| option.efforts.iter().any(|x| x == e)).map(str::to_owned)
}

/// The permission modes a model takes. Auto needs a model that supports it.
pub fn permission_modes(option: Option<&ModelOption>) -> impl Iterator<Item = &'static str> {
    let auto = option.is_some_and(|o| o.auto_mode);
    PERMISSION.iter().map(|p| p.0).filter(move |mode| *mode != "auto" || auto)
}

/// The permission mode a model keeps when it becomes the model: the chosen one if it takes it, else Supervised.
pub fn permission_for(option: Option<&ModelOption>, mode: &str) -> String {
    if permission_modes(option).any(|m| m == mode) { mode } else { "default" }.to_owned()
}

/// "claude-opus-5-5" → "Opus 5.5". Unknown ids pass through unchanged.
pub fn model_label(id: &str) -> String {
    let Some(rest) = id.strip_prefix("claude-") else { return id.to_owned() };
    let mut parts = rest.split('-');
    let (Some(family), Some(major)) = (parts.next(), parts.next()) else { return id.to_owned() };
    if family.is_empty() || !family.chars().all(|c| c.is_ascii_lowercase()) || major.is_empty() || !major.chars().all(|c| c.is_ascii_digit()) {
        return id.to_owned();
    }
    let minor = parts.next().filter(|m| m.len() == 1 && m.chars().all(|c| c.is_ascii_digit()));
    let mut name = family[..1].to_uppercase() + &family[1..];
    name.push(' ');
    name.push_str(major);
    if let Some(minor) = minor {
        name.push('.');
        name.push_str(minor);
    }
    name
}

/// A model's name as the picker shows it: the model that runs, so "Default" reads as "Opus 5.5".
pub fn option_label(option: &ModelOption) -> String {
    option.resolved_model.as_deref().map_or_else(|| option.label.clone(), model_label)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(value: &str, auto_mode: bool) -> ModelOption {
        ModelOption { value: value.into(), label: value.into(), description: String::new(), resolved_model: None, efforts: vec!["low".into(), "high".into()], default_effort: None, fast: false, auto_mode }
    }

    #[test]
    fn auto_needs_a_model_that_takes_it() {
        assert_eq!(permission_for(Some(&model("m", true)), "auto"), "auto");
        assert_eq!(permission_for(Some(&model("m", false)), "auto"), "default");
        assert_eq!(permission_for(None, "auto"), "default");
        assert_eq!(permission_for(None, "acceptEdits"), "acceptEdits");
    }

    #[test]
    fn names_models_and_keeps_only_efforts_a_model_takes() {
        assert_eq!(model_label("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(model_label("claude-haiku-5-20260101"), "Haiku 5");
        assert_eq!(model_label("opus"), "opus");
        assert!(is_alias(&model("opus", true)) && !is_alias(&model("claude-opus-4-8", true)));
        assert_eq!(effort_for(&model("m", true), Some("high")).as_deref(), Some("high"));
        assert_eq!(effort_for(&model("m", true), Some("max")), None);
    }
}
