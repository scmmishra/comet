//! How Desk matches what the user typed against a name: case, accents and full-width letters are
//! ignored, as `rune_kit::search` folds them, so "cafe" finds "Café" and "ｃａｆｅ" finds "cafe". Desk's
//! interface is English, so it folds with no language's special rules.

use rune_kit::search::Fold;

/// Whether `text` holds `query`. An empty query matches everything.
pub fn contains(text: &str, query: &str) -> bool {
    Fold::default().contains(text, query)
}

/// Whether `text` begins with `query`. An empty query matches everything.
pub fn starts_with(text: &str, query: &str) -> bool {
    query.is_empty() || Fold::default().find(text, query).first().is_some_and(|m| m.start == 0)
}
