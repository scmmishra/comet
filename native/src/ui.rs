//! `@opencode/ui` components rune-kit has no counterpart for, drawn as `@opencode/ui` draws them.

use rune::{El, TextStyle, row, text};
use rune_kit::Kit;

/// `@opencode/ui`'s DiffChanges: `+3 -1` in the add and remove colours, 11 points at weight 440.
pub fn diff_changes(k: &Kit, added: u32, removed: u32) -> El {
    let font = TextStyle::new(11.0, 440.0).lh(11.0).tracking(0.05);
    row().gap(8.0).items_center().child(text(format!("+{added}")).font(font).color(k.c.success.fg)).child(text(format!("-{removed}")).font(font).color(k.c.danger.fg))
}
