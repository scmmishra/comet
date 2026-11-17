//! An agent's Markdown as Desk shows it: a single newline breaks
//! the line, as Claude Code shows it, inline code that names a file opens the file, and each code block
//! has a header with its language and a Copy button.
//!
//! A file link draws as a chip in the accent, without its icon: rune-kit's Markdown puts
//! icons only before links to web pages.

use crate::shell::Desk;
use crate::theme;
use rune::{LinkPaint, Span, Tx, col, row, text};
use rune_kit::{Kit, Markdown};

/// The scheme of a link `prepare` makes for a file, which the thread opens in the view pane.
const FILE_SCHEME: &str = "desk-file:";

/// A file a reply names, with the line it points at.
#[derive(Debug, PartialEq)]
pub struct FileReference {
    pub path: String,
    pub line: Option<u32>,
}

/// The file an inline code span names, or None when it is not a file path. The rules follow T3 Code's:
/// a file has a folder or a line, and an extension or a line.
pub fn file_reference(text: &str) -> Option<FileReference> {
    let candidate = text.trim();
    if candidate.is_empty() || candidate.contains(|c: char| c.is_whitespace() || "`<>\"'".contains(c)) || has_url_scheme(candidate) {
        return None;
    }
    let (path, line) = split_position(candidate);
    if path.is_empty() || path.ends_with('/') || elided(path) {
        return None;
    }
    if line.is_none() && !path.contains('/') {
        return None;
    }
    let explicit = path.starts_with("~/") || path.starts_with("./") || path.starts_with("../") || path.starts_with('/');
    if !explicit && (is_hostname(path.split('/').next().unwrap_or(path)) || has_version_suffix(basename(path))) {
        return None;
    }
    // Without an extension or a line, `/api` is a route and `~/code/desk` a folder, and Desk opens only files.
    if line.is_none() && !has_extension(basename(path)) {
        return None;
    }
    Some(FileReference { path: path.to_owned(), line })
}

/// "space.ts · L37": the file's name, then its line when it has one.
pub fn file_label(reference: &FileReference) -> String {
    let name = basename(&reference.path);
    match reference.line {
        Some(line) => format!("{name} · L{line}"),
        None => name.to_owned(),
    }
}

/// `path:line` or `path:line:column`, split into the path and the line.
fn split_position(candidate: &str) -> (&str, Option<u32>) {
    let mut parts = candidate.rsplitn(3, ':');
    let last = parts.next().unwrap_or("");
    let numbers = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    match (parts.next(), parts.next()) {
        (Some(line), Some(path)) if numbers(last) && numbers(line) => (path, line.parse().ok()),
        (Some(rest), _) if numbers(last) => (&candidate[..rest.len()], last.parse().ok()),
        _ => (candidate, None),
    }
}

fn basename(path: &str) -> &str {
    path.split('/').rfind(|s| !s.is_empty()).unwrap_or(path)
}

fn has_url_scheme(s: &str) -> bool {
    s.split_once("://").is_some_and(|(scheme, _)| scheme.starts_with(|c: char| c.is_ascii_alphabetic()) && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)))
}

fn elided(path: &str) -> bool {
    path.split('/').any(|segment| segment == "…" || (segment.len() >= 3 && segment.bytes().all(|b| b == b'.')))
}

fn has_extension(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(stem, ext)| !stem.is_empty() && !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
}

/// A name ending in a version, such as `v1.2.3`, is a release, not a file.
fn has_version_suffix(name: &str) -> bool {
    let b = name.as_bytes();
    (0..b.len().saturating_sub(2)).any(|i| b[i].is_ascii_digit() && b[i + 1] == b'.' && b[i + 2].is_ascii_digit() && !name[i + 2..].contains('.'))
}

/// A first segment such as `github.com` is a host, not a folder.
fn is_hostname(segment: &str) -> bool {
    const TOP: [&str; 13] = ["com", "org", "net", "io", "dev", "app", "ai", "co", "sh", "me", "gg", "so", "edu"];
    let lower = segment.to_ascii_lowercase();
    lower.rsplit_once('.').is_some_and(|(name, top)| TOP.contains(&top) && !name.is_empty() && name.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')))
}

/// The reply's text as Desk renders it: outside code fences, a single newline becomes a hard break, and
/// inline code that names a file becomes a link to it labelled with its name and line.
pub fn prepare(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out = String::with_capacity(text.len() + 16);
    let mut fence: Option<&str> = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        let marker = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m));
        // A fence opens with ``` or ~~~ and closes with the same marker.
        let in_code = fence.is_some();
        match fence {
            Some(open) if trimmed.starts_with(open) => fence = None,
            None => fence = marker,
            _ => {}
        }
        let fenced = in_code || marker.is_some();
        out.push_str(&if fenced { (*line).to_owned() } else { link_files(line) });
        if i + 1 < lines.len() {
            let next = lines[i + 1];
            // A line followed by another line, outside code, breaks there, as Claude Code shows it.
            if !fenced && !line.trim().is_empty() && !next.trim().is_empty() && !line.ends_with("  ") {
                out.push_str("  ");
            }
            out.push('\n');
        }
    }
    out
}

/// The line with each inline code span that names a file turned into a link to it.
fn link_files(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find('`') {
        let ticks = rest[start..].bytes().take_while(|b| *b == b'`').count();
        let delimiter = &rest[start..start + ticks];
        let after = &rest[start + ticks..];
        let Some(end) = after.find(delimiter) else { break };
        let code = &after[..end];
        out.push_str(&rest[..start]);
        match file_reference(code) {
            Some(reference) => {
                let target = match reference.line {
                    Some(line) => format!("{FILE_SCHEME}{}:{line}", reference.path),
                    None => format!("{FILE_SCHEME}{}", reference.path),
                };
                out.push_str(&format!("[{}](<{target}>)", file_label(&reference).replace(['[', ']'], "")));
            }
            None => out.push_str(&rest[start..start + ticks + end + ticks]),
        }
        rest = &after[end + ticks..];
    }
    out.push_str(rest);
    out
}

/// A reply, thought or question as plain Markdown: prepared, with long code lines scrolling sideways
/// rather than wrapping.
pub fn document(text: &str) -> Markdown {
    Markdown::new(prepare(text)).scroll_wide(true)
}

/// `document` with its links and code blocks working: a file link opens the file it names in the tab's view pane,
/// another link opens in the browser, and each code block has a header with its language and a Copy
/// button. `id` names the reply, so a code block's copy is told apart from others'.
pub fn interactive(markdown: Markdown, tab: &str, id: &str, copied: Option<&str>, k: &Kit) -> Markdown {
    let tab = tab.to_owned();
    let (id, copied) = (id.to_owned(), copied.map(str::to_owned));
    let ink = k.c.text_faint;
    let hover = k.c.hover;
    let text_base = k.c.text_base;
    let surface = theme::code_fill(k.dark);
    let accent = k.c.text_accent;
    let soft = theme::accent_soft(k.dark);
    markdown
        // `.desk-file`: the accent at weight 500, on `accent-soft` under the pointer.
        .link_style(move |url| url.starts_with(FILE_SCHEME).then(|| (Span::new(0, 0).color(accent).weight(500.0), LinkPaint::new().color(accent).bg(soft))))
        // The chip's title: the file's path and line, as the reply named it.
        .link_help(|url| url.strip_prefix(FILE_SCHEME).map(str::to_owned))
        .on_link_tx(move |s: &mut Desk, url: &str, tx: &mut Tx| match url.strip_prefix(FILE_SCHEME) {
            Some(target) => {
                let (path, line) = split_position(target);
                s.open_named_file(&tab, path, line);
            }
            None => {
                if let Err(e) = tx.open_url(url) {
                    s.toasts.show(e.to_string(), true);
                }
            }
        })
        .code_frame(move |card, frame| {
            let key = format!("{id}#code{}", frame.index);
            let done = copied.as_deref() == Some(key.as_str());
            let source = frame.source.to_owned();
            let copy_key = key.clone();
            let copy = row()
                .key("copy")
                .h(22.0)
                .px(8.0)
                .radius(6.0)
                .items_center()
                .hover(hover)
                .role("button")
                .label("Copy code")
                .on_press_tx(move |s: &mut Desk, tx: &mut Tx| {
                    tx.copy(source.clone());
                    s.copied = Some((copy_key.clone(), std::time::Instant::now()));
                })
                .child(text(if done { "Copied" } else { "Copy" }).font(theme::text(11.0)).color(if done { text_base } else { ink }))
                .group_color(text_base);
            // `.desk-code-header`: the language and Copy on the block's own surface.
            let header = row().w_full().gap(8.0).items_center().pt(6.0).pr(6.0).pl(12.0).children(frame.language.map(|l| text(l.to_owned()).font(theme::text(11.0)).color(ink))).child(row().grow(1.0)).child(copy);
            // One surface, `.desk-code`, under the header and the code.
            col().key(key).w_full().radius(10.0).clip_rounded(10.0).fill(surface).child(header).child(card)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(path: &str, line: Option<u32>) -> Option<FileReference> {
        Some(FileReference { path: path.into(), line })
    }

    #[test]
    fn recognises_repo_relative_paths_with_and_without_a_position() {
        assert_eq!(file_reference("core/src/space.ts"), at("core/src/space.ts", None));
        assert_eq!(file_reference("core/src/space.ts:37"), at("core/src/space.ts", Some(37)));
        assert_eq!(file_reference("app/main.tsx:12:5"), at("app/main.tsx", Some(12)));
        assert_eq!(file_reference("./README.md"), at("./README.md", None));
        assert_eq!(file_reference("README.md:4"), at("README.md", Some(4)));
    }

    #[test]
    fn leaves_code_that_is_not_a_path_alone() {
        for text in ["parseChanges", "git status --short", "a/b", "src/", "https://example.com/a.ts", "github.com/owner/repo", "v1.2.3/x", "src/…/x.ts", "README.md", "/api", "/api/v1/accounts", "~/code/desk"] {
            assert_eq!(file_reference(text), None, "{text}");
        }
    }

    #[test]
    fn labels_a_file_by_name_and_line() {
        assert_eq!(file_label(&FileReference { path: "core/src/space.ts".into(), line: Some(37) }), "space.ts · L37");
        assert_eq!(file_label(&FileReference { path: "core/src/space.ts".into(), line: None }), "space.ts");
    }

    #[test]
    fn single_newlines_break_outside_code() {
        assert_eq!(prepare("one\ntwo\n\nthree"), "one  \ntwo\n\nthree");
        assert_eq!(prepare("```\na\nb\n```\nc\nd"), "```\na\nb\n```\nc  \nd");
    }

    #[test]
    fn inline_code_naming_a_file_becomes_a_link() {
        assert_eq!(prepare("See `src/login.ts:12` and `parse`."), "See [login.ts · L12](<desk-file:src/login.ts:12>) and `parse`.");
        assert_eq!(prepare("```\n`src/a.ts`\n```"), "```\n`src/a.ts`\n```");
    }
}
