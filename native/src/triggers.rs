//! Text typed after a trigger, which the composer offers to complete: `@` lists files, and `/` lists commands.

#[derive(Clone, Debug, PartialEq)]
pub enum TriggerKind {
    File,
    Command,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Trigger {
    pub kind: TriggerKind,
    /// Where the trigger character is, in bytes.
    pub start: usize,
    /// What follows it, up to the caret.
    pub query: String,
}

/// The trigger the caret is in. A command starts the message. A file mention starts it or follows a space.
pub fn trigger_at(text: &str, caret: usize) -> Option<Trigger> {
    let before = text.get(..caret)?;
    if let Some(query) = before.strip_prefix('/')
        && !query.chars().any(char::is_whitespace)
    {
        return Some(Trigger { kind: TriggerKind::Command, start: 0, query: query.to_owned() });
    }
    let at = before.rfind('@')?;
    let query = &before[at + 1..];
    let starts_word = before[..at].chars().next_back().is_none_or(char::is_whitespace);
    (starts_word && !query.chars().any(|c| c.is_whitespace() || c == '@')).then(|| Trigger { kind: TriggerKind::File, start: at, query: query.to_owned() })
}

/// `text` with the trigger at `start` replaced by `inserted` and a space, and where the caret goes after it.
pub fn complete(text: &str, start: usize, caret: usize, inserted: &str) -> (String, usize) {
    let after = text[caret..].strip_prefix(char::is_whitespace).unwrap_or(&text[caret..]);
    (format!("{}{inserted} {after}", &text[..start]), start + inserted.len() + 1)
}

/// The commands that match what was typed after `/`, after T3 Code: names that start with it, then names
/// that hold it, then descriptions that hold it, each in the list's own order. A command whose name an
/// earlier one already took is left out, so Comet's own /model and /clear win over Claude Code's.
pub fn match_commands<'a, T>(commands: &'a [T], query: &str, name: impl Fn(&T) -> &str, description: impl Fn(&T) -> &str) -> Vec<&'a T> {
    let mut seen = std::collections::HashSet::new();
    let mut found: Vec<(u8, usize, &T)> = commands
        .iter()
        .enumerate()
        .filter(|(_, c)| seen.insert(name(c).to_owned()))
        .filter_map(|(i, c)| {
            let n = name(c);
            let rank = if crate::search::starts_with(n, query) {
                0
            } else if crate::search::contains(n, query) {
                1
            } else if crate::search::contains(description(c), query) {
                2
            } else {
                return None;
            };
            Some((rank, i, c))
        })
        .collect();
    found.sort_by_key(|(rank, i, _)| (*rank, *i));
    found.into_iter().map(|(_, _, c)| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_trigger_the_caret_is_in() {
        assert_eq!(trigger_at("/com", 4), Some(Trigger { kind: TriggerKind::Command, start: 0, query: "com".into() }));
        assert_eq!(trigger_at("/compact now", 12), None);
        assert_eq!(trigger_at("look at @src/ma", 15), Some(Trigger { kind: TriggerKind::File, start: 8, query: "src/ma".into() }));
        assert_eq!(trigger_at("mail me@home", 12), None, "an @ inside a word is not a mention");
        assert_eq!(trigger_at("@", 1), Some(Trigger { kind: TriggerKind::File, start: 0, query: String::new() }));
    }

    #[test]
    fn completes_in_place_with_one_space() {
        assert_eq!(complete("see @ma please", 4, 7, "@main.rs"), ("see @main.rs please".into(), 13));
        assert_eq!(complete("/com", 0, 4, "/compact"), ("/compact ".into(), 9));
    }

    #[test]
    fn ranks_name_starts_then_names_then_descriptions_and_drops_later_duplicates() {
        let commands = [("model", "Switch the model"), ("clear", "Start fresh"), ("pdf", "Read a model card"), ("remodel", "x"), ("model", "Claude Code's own")];
        let found: Vec<&str> = match_commands(&commands, "mod", |c| c.0, |c| c.1).into_iter().map(|c| c.0).collect();
        assert_eq!(found, ["model", "remodel", "pdf"]);
    }

    #[test]
    fn ignores_accents_and_full_width_letters() {
        let commands = [("résumé", "Pick up where it stopped"), ("clear", "Start fresh")];
        let names = |query: &str| -> Vec<&str> { match_commands(&commands, query, |c| c.0, |c| c.1).into_iter().map(|c| c.0).collect() };
        assert_eq!(names("resume"), ["résumé"], "a plain query finds an accented name");
        assert_eq!(names("ｃｌｅ"), ["clear"], "a full-width query finds a plain name");
        assert_eq!(names(""), ["résumé", "clear"], "an empty query lists every command");
    }
}
