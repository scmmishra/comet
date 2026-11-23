//! How Comet matches what the user typed against a name: case, accents and full-width letters are
//! ignored, as `rune_kit::search` folds them, so "cafe" finds "Café" and "ｃａｆｅ" finds "cafe". Comet's
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

/// Whether `word` is the link, alone or with a path, query or anchor after it, such as a pull request's link
/// pasted from its Files tab. Part of a link, such as "github", names none: every link holds it. "pull/1234"
/// does not name "pull/123". Either may leave out the scheme.
pub fn names_link(word: &str, link: &str) -> bool {
    let bare = |url: &str| {
        let url = url.to_lowercase();
        url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")).map(str::to_owned).unwrap_or(url)
    };
    bare(word).strip_prefix(&bare(link)).is_some_and(|rest| rest.is_empty() || rest.starts_with(['/', '?', '#']))
}
