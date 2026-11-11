//! The view pane beside the thread: its tabs, Review on the
//! tab's changes, and files open in it.

use crate::format;
use crate::protocol::{ClientMessage, FileChange, FileView, TabInfo};
use crate::shell::Desk;
use rune::{El, ScrollSpec, Tx, col, el, icon, row, text};
use crate::diff_view::{DiffMode, DiffState, DiffView, FileStatus, parse};
use rune_kit::{ButtonVariant, ControlSize, IconButton, IconButtonVariant, Kit, Select};
use rune_theme_opencode::icons as ic;
use std::collections::HashMap;

/// Review's scopes, in OpenCode's words, and what each says when nothing changed.
const SCOPES: [(&str, &str, &str); 4] = [
    ("thread", "Thread changes", "This thread has not changed any files."),
    ("git", "Git changes", "There are no uncommitted changes."),
    ("branch", "Branch changes", "This branch has no changes."),
    ("turn", "Last turn changes", "The last turn did not change any files."),
];
/// Above this many files, the diffs start folded, so a large change opens as a list.
const OPEN_FILE_LIMIT: usize = 8;
/// The panel's header, `h-[46px]`.
const HEADER_HEIGHT: f32 = 46.0;
/// A line of code in the file view, `--diffs-line-height`.
const LINE_HEIGHT: f32 = 20.0;

fn scope_words(scope: &str) -> (&'static str, &'static str) {
    SCOPES.iter().find(|s| s.0 == scope).map_or((SCOPES[0].1, SCOPES[0].2), |s| (s.1, s.2))
}

/// A tab's Review: the scope it shows and that scope's changes, drawn by rune-kit's diff view.
pub struct Review {
    scope: String,
    files: Vec<FileChange>,
    diff: DiffState,
}

/// What the panel has read and how it draws.
/// A file the panel shows: what the core read, its lines' byte ranges, and its highlights in order,
/// worked out once when it arrives so each line on screen only looks its own up.
struct ShownFile {
    file: FileView,
    lines: Vec<std::ops::Range<usize>>,
    highlights: std::rc::Rc<[rune_kit::syntax::Highlight]>,
}

impl ShownFile {
    fn new(path: &str, file: FileView) -> ShownFile {
        let text = file.text.as_deref().unwrap_or("");
        let mut lines = Vec::new();
        let mut start = 0;
        for line in text.split_inclusive('\n') {
            let end = start + line.trim_end_matches(['\n', '\r']).len();
            lines.push(start..end);
            start += line.len();
        }
        // The extension names the language, as a fence's info word would.
        let lang = path.rsplit_once('.').map(|(_, ext)| ext);
        let highlights = rune_kit::syntax::highlight(lang, text);
        ShownFile { file, lines, highlights }
    }

    /// The spans that colour line `i`, measured from its start.
    fn line_spans(&self, i: usize, theme: &rune_kit::syntax::SyntaxTheme) -> Vec<rune::Span> {
        let line = &self.lines[i];
        // The highlights are in order and do not overlap, so the line's start from a binary search.
        let first = self.highlights.partition_point(|(r, _)| r.end <= line.start);
        let clipped: Vec<rune_kit::syntax::Highlight> = self.highlights[first..]
            .iter()
            .take_while(|(r, _)| r.start < line.end)
            .map(|(r, p)| (r.start.max(line.start) - line.start..r.end.min(line.end) - line.start, *p))
            .collect();
        theme.spans(&clipped, 0)
    }
}

#[derive(Default)]
pub struct Panel {
    reviews: HashMap<String, Review>,
    /// The review last asked for, by tab and scope, so it is asked again only when something changes.
    asked: Option<(String, String)>,
    /// Files read for the panel, by project and path.
    files: HashMap<(String, String), ShownFile>,
    /// The file tab last read, so a file reads again each time it comes to the front.
    file_shown: Option<String>,
    /// How diffs draw, in every tab.
    split: bool,
    scope_open: bool,
}

impl Desk {
    /// The scope Review shows in `tab`: its own choice, else the thread's changes.
    fn scope(tab: &TabInfo) -> &str {
        tab.review_scope.as_deref().unwrap_or("thread")
    }

    pub fn take_review(&mut self, tab: String, scope: String, files: Vec<FileChange>) {
        let Some(info) = self.workspace.tabs.iter().find(|t| t.id == tab) else { return };
        // An answer for a scope the tab has since left is stale.
        if Desk::scope(info) != scope {
            return;
        }
        let diffs = files.iter().flat_map(|f| parse(&f.patch)).collect::<Vec<_>>();
        let mut diff = DiffState::new(diffs);
        diff.set_mode(if self.panel.split { DiffMode::Split } else { DiffMode::Unified });
        if files.len() > OPEN_FILE_LIMIT {
            for i in 0..diff.files().len() {
                diff.set_collapsed(i, true);
            }
        }
        self.panel.reviews.insert(tab, Review { scope, files, diff });
    }

    pub fn take_file(&mut self, project: String, path: String, file: FileView) {
        let shown = ShownFile::new(&path, file);
        self.panel.files.insert((project, path), shown);
    }

    /// A turn ended, so Review reads the changes again.
    pub fn turn_ended(&mut self, tab: &str) {
        if self.panel.asked.as_ref().is_some_and(|(t, _)| t == tab) {
            self.panel.asked = None;
        }
    }

    /// Asks the core for what the active tab's panel shows, when it changed: Review's changes, or the file in front.
    pub fn sync_panel(&mut self) {
        self.load_layout();
        let Some(tab) = self.workspace.active_tab().cloned() else { return };
        if tab.panel_open != Some(true) {
            self.panel.file_shown = None;
            return;
        }
        self.open_terminals();
        let plugin_panel = self.plugins.layouts.get(&tab.id).is_some_and(|l| l.panels.iter().any(|p| Some(&p.id) == tab.panel_active.as_ref()));
        if plugin_panel || tab.terminals.iter().any(|t| Some(&t.id) == tab.panel_active.as_ref()) {
            self.panel.file_shown = None;
            return;
        }
        match tab.files.iter().find(|f| Some(&f.id) == tab.panel_active.as_ref()) {
            Some(file) => {
                if self.panel.file_shown.as_ref() != Some(&file.id) {
                    self.panel.file_shown = Some(file.id.clone());
                    self.core.send(&ClientMessage::FileRead { project: tab.project.clone(), path: file.path.clone() });
                }
            }
            None => {
                self.panel.file_shown = None;
                let wanted = (tab.id.clone(), Desk::scope(&tab).to_owned());
                if self.panel.asked.as_ref() != Some(&wanted) {
                    self.core.send(&ClientMessage::ReviewGet { tab_id: wanted.0.clone(), scope: wanted.1.clone() });
                    self.panel.asked = Some(wanted);
                }
            }
        }
    }

    /// Opens or closes the active tab's view pane, as ⌘\\ does.
    pub fn toggle_panel(&mut self) {
        let Some(tab) = self.workspace.active_tab() else { return };
        let (id, open) = (tab.id.clone(), tab.panel_open != Some(true));
        self.workspace.set_panel_open(&id, open, &self.core);
        self.sync_panel();
    }

    /// Opens the tab's pane on Review, comparing with `scope`.
    pub fn open_review(&mut self, tab: &str, scope: &str) {
        let scope = scope.to_owned();
        self.workspace.change_tab(
            tab,
            |t| {
                t.panel_open = Some(true);
                t.panel_active = None;
                t.review_scope = Some(scope);
            },
            &self.core,
        );
        self.workspace.settings_page = None;
        self.sync_panel();
    }

    /// Shows a file from the thread in the tab's panel. A relative path is in the project.
    pub fn open_file(&mut self, tab: &str, path: &str, line: Option<u32>) {
        let Some(project) = self.workspace.tabs.iter().find(|t| t.id == tab).map(|t| t.project.clone()) else { return };
        let absolute = match path.strip_prefix("~/") {
            Some(rest) => format!("{}/{rest}", std::env::var("HOME").unwrap_or_default()),
            None if path.starts_with('/') => path.to_owned(),
            None => format!("{}/{}", project.trim_end_matches('/'), path.trim_start_matches("./")),
        };
        self.workspace.open_file_tab(tab, &absolute, line, &self.core);
        self.sync_panel();
    }

    /// Shows a tab of the pane at once, with no fade of its parts, as a tab bar switches.
    fn show_panel_tab(&mut self, tab: &str, panel: Option<String>, tx: &mut Tx) {
        self.workspace.show_panel_tab(tab, panel, &self.core);
        self.sync_panel();
        tx.instant();
    }

    fn set_split(&mut self, split: bool) {
        self.panel.split = split;
        for review in self.panel.reviews.values_mut() {
            review.diff.set_mode(if split { DiffMode::Split } else { DiffMode::Unified });
        }
    }
}

/// The toggle in the top corner, which opens and closes the pane. Its glyph fills its right side while open.
pub fn toggle(open: bool, k: &Kit) -> El {
    IconButton::new(if open { &crate::icons::PANEL_OPEN } else { &crate::icons::PANEL })
        .variant(IconButtonVariant::GhostMuted)
        .control_size(ControlSize::Large)
        .label("Toggle panel")
        .help("Panel ⌘\\\\")
        .on_press(|s: &mut Desk| s.toggle_panel())
        .build(k)
        .expanded(open)
        .key("panel-toggle")
}

pub fn panel(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let shown = tab.files.iter().find(|f| Some(&f.id) == tab.panel_active.as_ref());
    let terminal = tab.terminals.iter().find(|t| Some(&t.id) == tab.panel_active.as_ref());
    let plugin_panels: &[crate::protocol::DrawnView] = s.plugins.layouts.get(&tab.id).map_or(&[], |l| l.panels.as_slice());
    let plugin_panel = plugin_panels.iter().find(|p| Some(&p.id) == tab.panel_active.as_ref());
    let tab_button = |key: String, label: El, active: bool, on: El| {
        row()
            .key(key)
            .h(32.0)
            .gap(7.0)
            .items_center()
            .px(10.0)
            .radius(8.0)
            .fill(if active { k.c.layer_02 } else { rune::Color::TRANSPARENT })
            .hover(k.c.hover)
            .child(label)
            .child(on)
    };
    let review_id = tab.id.clone();
    let on_review = shown.is_none() && terminal.is_none() && plugin_panel.is_none();
    let review = tab_button(
        "panel-review".into(),
        row().gap(7.0).items_center().child(icon(&ic::REVIEW, 15.0).color(k.c.text_muted)).child(text("Review").font(crate::theme::medium(13.0)).color(if on_review { k.c.text_base } else { k.c.text_muted })),
        on_review,
        el(),
    )
    .role("tab")
    .on_press_tx(move |s: &mut Desk, tx| s.show_panel_tab(&review_id, None, tx));
    let files = tab.files.iter().map(|file| {
        let active = shown.is_some_and(|f| f.id == file.id);
        let name = file.path.rsplit('/').next().unwrap_or(&file.path).to_owned();
        let (show_tab, show_id, close_tab, close_id) = (tab.id.clone(), file.id.clone(), tab.id.clone(), file.id.clone());
        let close = IconButton::new(&ic::XMARK_SMALL)
            .variant(IconButtonVariant::GhostMuted)
            .control_size(ControlSize::Small)
            .label(format!("Close {name}"))
            .on_press_tx(move |s: &mut Desk, tx| {
                s.workspace.close_file_tab(&close_tab, &close_id, &s.core);
                s.sync_panel();
                tx.instant();
            })
            .build(k);
        tab_button(
            format!("panel-{}", file.id),
            row().gap(7.0).items_center().child(icon(crate::icons::file_icon(&file.path), 14.0)).child(text(name).font(crate::theme::medium(13.0)).color(if active { k.c.text_base } else { k.c.text_muted })),
            active,
            close,
        )
        .role("tab")
        .on_press_tx(move |s: &mut Desk, tx| s.show_panel_tab(&show_tab, Some(show_id.clone()), tx))
    });
    let terminals = tab.terminals.iter().map(|t| {
        let active = terminal.is_some_and(|x| x.id == t.id);
        let (show_tab, show_id, close_tab, close_id) = (tab.id.clone(), t.id.clone(), tab.id.clone(), t.id.clone());
        let close = IconButton::new(&ic::XMARK_SMALL)
            .variant(IconButtonVariant::GhostMuted)
            .control_size(ControlSize::Small)
            .label("Close terminal")
            .on_press_tx(move |s: &mut Desk, tx| {
                s.workspace.close_terminal(&close_tab, &close_id, &s.core);
                s.sync_panel();
                tx.instant();
            })
            .build(k);
        tab_button(
            format!("panel-{}", t.id),
            row().gap(7.0).items_center().child(icon(&ic::TERMINAL, 15.0).color(k.c.text_muted)).child(text(t.title.clone()).font(crate::theme::medium(13.0)).color(if active { k.c.text_base } else { k.c.text_muted })),
            active,
            close,
        )
        .role("tab")
        .on_press_tx(move |s: &mut Desk, tx| s.show_panel_tab(&show_tab, Some(show_id.clone()), tx))
    });
    // Plugin panels sit at the front, in the order they opened.
    let plugin_tabs = plugin_panels.iter().map(|p| {
        let active = plugin_panel.is_some_and(|x| x.id == p.id);
        let (show_tab, show_id, close_tab, close_id) = (tab.id.clone(), p.id.clone(), tab.id.clone(), p.id.clone());
        let close = IconButton::new(&ic::XMARK_SMALL)
            .variant(IconButtonVariant::GhostMuted)
            .control_size(ControlSize::Small)
            .label("Close panel")
            .on_press(move |s: &mut Desk| s.core.send(&ClientMessage::PanelClose { tab_id: close_tab.clone(), id: close_id.clone() }))
            .build(k);
        tab_button(format!("panel-{}", p.id), text(p.title.clone()).font(crate::theme::medium(13.0)).color(if active { k.c.text_base } else { k.c.text_muted }), active, close)
            .role("tab")
            .on_press_tx(move |s: &mut Desk, tx| s.show_panel_tab(&show_tab, Some(show_id.clone()), tx))
    });
    let new_terminal = IconButton::new(&ic::PLUS).variant(IconButtonVariant::GhostMuted).control_size(ControlSize::Large).label("New terminal").help("New terminal").on_press(|s: &mut Desk| s.new_terminal()).build(k);
    let header = row()
        .key("panel-header")
        .w_full()
        .h(HEADER_HEIGHT)
        .items_center()
        .gap(4.0)
        .pl(8.0)
        .pr(10.0)
        .children(plugin_tabs.collect::<Vec<_>>())
        .child(review)
        .children(terminals)
        .children(files)
        // The tabs take the free width, so the new terminal button sits at the end, beside the toggle.
        .child(row().grow(1.0))
        .child(new_terminal)
        // The toggle sits in the pane's corner, 11 points past the new terminal button.
        .child(toggle(true, k).ml(7.0));
    // Each tab of the pane is its own element, which swaps in at once: unkeyed, Rune would morph one tab's
    // parts into the next one's, and keyed with its default fade, it would crossfade them.
    let body_key = format!("panel-body-{}", tab.panel_active.as_deref().unwrap_or("review"));
    let body = match (terminal, shown) {
        _ if plugin_panel.is_some() => col().w_full().grow(1.0).min_h(0.0).px(12.0).pb(12.0).child(crate::plugins::view(s, plugin_panel.expect("checked"), &tab.project, crate::plugins::Frame::Pane, k)),
        (Some(t), _) => crate::terminal_view::terminal(s, &t.id, k),
        (None, Some(file)) => file_view(s, tab, &file.path, file.line, k),
        (None, None) => review_view(s, tab, k, layer),
    };
    let body = col().key(body_key).transition(rune::Transition::none()).w_full().grow(1.0).min_h(0.0).child(body);
    col().key("panel").w_full().h_full().min_h(0.0).child(header).child(body)
}

fn review_view(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let scope = Desk::scope(tab);
    let review = s.panel.reviews.get(&tab.id).filter(|r| r.scope == scope);
    let labels: Vec<&str> = SCOPES.iter().map(|s| s.1).collect();
    let id = tab.id.clone();
    let select = Select::new("review-scope", &labels)
        .current(Some(scope_words(scope).0))
        .open(s.panel.scope_open)
        .on_toggle(|s: &mut Desk| s.panel.scope_open = !s.panel.scope_open)
        .on_close(|s: &mut Desk| s.panel.scope_open = false)
        .on_choose(move |s: &mut Desk, label: &str, _| {
            s.panel.scope_open = false;
            if let Some((value, ..)) = SCOPES.iter().find(|x| x.1 == label) {
                s.workspace.set_review_scope(&id, value, &s.core);
                s.sync_panel();
            }
        })
        .build(k, layer);
    let counts = review.filter(|r| !r.files.is_empty()).map(|r| {
        let (added, removed) = r.files.iter().fold((0, 0), |(a, d), f| (a + f.additions, d + f.deletions));
        row()
            .gap(8.0)
            .items_center()
            .child(text(format::plural(r.files.len(), "file")).font(crate::theme::text(13.0)).color(k.c.text_faint))
            .child(crate::ui::diff_changes(k, added, removed))
    });
    let style = crate::ui::segmented(
        k,
        "Diff view",
        &[
            crate::ui::Segment { icon: Some(&ic::UNIFIED), words: None, name: "Unified diff" },
            crate::ui::Segment { icon: Some(&ic::SPLIT), words: None, name: "Split diff" },
        ],
        usize::from(s.panel.split),
        |s: &mut Desk, i| s.set_split(i == 1),
    );
    // Folds every file, or opens them all again once they are all folded.
    let fold_all = review.filter(|r| !r.files.is_empty()).map(|r| {
        let all_open = (0..r.diff.files().len()).all(|f| !r.diff.collapsed(f));
        let id = tab.id.clone();
        IconButton::new(if all_open { &ic::COLLAPSE } else { &ic::EXPAND })
            .variant(IconButtonVariant::GhostMuted)
            .label(if all_open { "Collapse all" } else { "Expand all" })
            .help(if all_open { "Collapse all" } else { "Expand all" })
            .on_press_tx(move |s: &mut Desk, tx| {
                if let Some(review) = s.panel.reviews.get_mut(&id) {
                    for f in 0..review.diff.files().len() {
                        review.diff.set_collapsed(f, all_open);
                    }
                }
                // Files fold and open at once. Rune's growth stack cannot grow virtual rows open, and
                // holds removed ones for 0.15 s before closing up, so a glide reads as a cut and a lag.
                tx.instant();
            })
            .build(k)
    });
    let controls = row().w_full().gap(8.0).items_center().px(12.0).pb(8.0).pt(2.0).child(select).children(counts).child(row().grow(1.0)).children(fold_all).child(style);
    let content = match review {
        None => centred(k, "Loading changes…"),
        Some(r) if r.files.is_empty() => centred(k, scope_words(scope).1),
        Some(_) => {
            let (get, get_mut) = (tab.id.clone(), tab.id.clone());
            DiffView::new(move |s: &Desk| &s.panel.reviews[&get].diff, move |s: &mut Desk| &mut s.panel.reviews.get_mut(&get_mut).expect("a review that showed").diff)
                .key(format!("review-{}", tab.id))
                .file_header(file_header(tab.id.clone(), k.dark))
                .syntax_theme(crate::theme::code_colors(k.dark))
                .code_font(crate::theme::mono(12.0))
                .build(s, crate::theme::review_kit(k.dark))
                .grow(1.0)
                .min_h(0.0)
        }
    };
    col().w_full().grow(1.0).min_h(0.0).child(controls).child(content)
}

/// A file's header in Review: the chevron, the file's icon, its folder
/// muted and its name, a quiet status, its line counts and a button to open it. The whole header folds
/// the file.
fn file_header(tab: String, dark: bool) -> impl Fn(&Desk, usize, bool) -> El + 'static {
    move |s: &Desk, f: usize, collapsed: bool| {
        let k = crate::theme::kit(dark);
        let Some(file) = s.panel.reviews.get(&tab).and_then(|r| r.diff.files().get(f)) else { return el() };
        let path = file.path().to_owned();
        let (dir, name) = path.rsplit_once('/').map_or((None, path.as_str()), |(d, n)| (Some(d), n));
        let status = match file.status {
            FileStatus::Added => Some("added"),
            FileStatus::Deleted => Some("deleted"),
            FileStatus::Renamed => Some("renamed"),
            FileStatus::Copied => Some("copied"),
            FileStatus::Modified => None,
        };
        let (toggle_tab, open_tab, open_path) = (tab.clone(), tab.clone(), path.clone());
        let open = IconButton::new(&ic::ARROW_UP_RIGHT)
            .variant(IconButtonVariant::GhostMuted)
            .control_size(ControlSize::Small)
            .label(format!("Open {name}"))
            .on_press(move |s: &mut Desk| s.open_file(&open_tab, &open_path, None))
            .build(k);
        row()
            .key("review-file-header")
            .w_full()
            .h_full()
            .gap(8.0)
            .items_center()
            .px(12.0)
            .hover(k.c.hover)
            .role("button")
            .expanded(!collapsed)
            .label(format!("{} {path}", if collapsed { "Expand" } else { "Collapse" }))
            .on_press_tx(move |s: &mut Desk, tx| {
                if let Some(review) = s.panel.reviews.get_mut(&toggle_tab) {
                    review.diff.set_collapsed(f, !collapsed);
                }
                // At once, as Collapse all does.
                tx.instant();
            })
            .child(crate::icons::chevron(k, !collapsed))
            .child(icon(crate::icons::file_icon(&path), crate::icons::SIZE))
            .child(
                row()
                    .min_w(0.0)
                    .shrink()
                    .children(dir.map(|d| text(format!("{d}/")).font(crate::theme::text(13.0)).color(k.c.text_faint).truncate_head().min_w(0.0).shrink()))
                    .child(text(name.to_owned()).font(crate::theme::text(13.0)).color(k.c.text_base)),
            )
            .children(status.map(|w| text(w).font(crate::theme::text(13.0)).color(k.c.text_faint)))
            .child(row().grow(1.0))
            .child(crate::ui::diff_changes(k, file.additions() as u32, file.deletions() as u32))
            .child(open)
    }
}

fn centred(k: &Kit, words: &str) -> El {
    col().w_full().grow(1.0).center().px(24.0).child(text(words.to_owned()).font(crate::theme::text(13.0)).color(k.c.text_faint).wrap())
}

/// A file open in the panel, after OpenCode: its path, a button to open it in the editor, then its lines.
fn file_view(s: &Desk, tab: &TabInfo, path: &str, line: Option<u32>, k: &Kit) -> El {
    let (project, open_path) = (tab.project.clone(), path.to_owned());
    let head = row()
        .w_full()
        .gap(8.0)
        .items_center()
        .px(12.0)
        .pb(8.0)
        .pt(2.0)
        .child(text(path.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_faint).truncate().grow(1.0))
        .child(
            crate::theme::small_button("Open in editor")
                .variant(ButtonVariant::Ghost)
                .on_press(move |s: &mut Desk| s.core.send(&ClientMessage::FileOpen { project: project.clone(), path: open_path.clone(), line }))
                .build(k),
        );
    let body = match s.panel.files.get(&(tab.project.clone(), path.to_owned())) {
        None => centred(k, "Reading the file…"),
        Some(shown) if shown.file.binary => centred(k, "This is a binary file. Open it in the editor to see it."),
        Some(shown) => code(tab, path, shown, line, k),
    };
    col().w_full().grow(1.0).min_h(0.0).child(head).child(body)
}

/// A file's text, one numbered line per row, with `line` marked, in Desk's code colours.
/// Rows mount only while on screen.
fn code(tab: &TabInfo, path: &str, shown: &ShownFile, line: Option<u32>, k: &Kit) -> El {
    let count = shown.lines.len();
    // Pierre's gutter: 2ch in, the number at least 2ch wide, 1ch after it, and the code 1ch further in.
    const CH: f32 = 7.2;
    let width = 2.0 * CH + (count.max(1).to_string().len().max(2) as f32) * CH + CH;
    let truncated = shown.file.truncated.then(|| text("The file is long, so only its first megabyte shows.").font(crate::theme::text(12.0)).color(k.c.text_faint).px(12.0).pb(8.0));
    let key = (tab.project.clone(), path.to_owned());
    let dark = k.dark;
    // The line a file opened at, Desk's `--color-accent-soft`.
    let mark = k.c.text_accent.alpha(0.14);
    // Pierre's colours: code in its foreground, numbers in that mixed 65% with the panel.
    let ink = crate::theme::code_foreground(dark);
    let dim = ink.mix(k.c.bg_base, 0.35);
    let mono = crate::theme::mono(12.0);
    // Rune virtualizes a list only on an element that grows.
    let rows = col().w_full().growth(rune::GrowthSpec::default()).virtual_rows(
        count,
        LINE_HEIGHT,
        |_: &Desk, i| std::borrow::Cow::Owned(i.to_string()),
        move |s: &Desk, i| {
            let Some(shown) = s.panel.files.get(&key) else { return rune::el() };
            let words = shown.file.text.as_deref().map_or("", |t| &t[shown.lines[i].clone()]).to_owned();
            let spans = shown.line_spans(i, &crate::theme::code_colors(dark));
            let number = i as u32 + 1;
            row()
                .w_full()
                .h(LINE_HEIGHT)
                .items_center()
                .fill(if line == Some(number) { mark } else { rune::Color::TRANSPARENT })
                .child(row().w(width).pr(CH).justify_end().child(text(number.to_string()).font(mono).color(dim)))
                .child(text(words).spans(spans).font(mono).color(ink).selectable(true).pl(CH))
        },
    );
    col().key(format!("file-{}-{path}", tab.id)).w_full().grow(1.0).min_h(0.0).children(truncated).child(col().w_full().grow(1.0).min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_line_takes_the_highlights_inside_it_measured_from_its_start() {
        let text = "let a = 1;\n// two\nlet b = \"x\";\n";
        let shown = ShownFile::new("main.rs", FileView { path: "main.rs".into(), text: Some(text.into()), binary: false, truncated: false });
        assert_eq!(shown.lines, vec![0..10, 11..17, 18..30]);
        let theme = crate::theme::code_colors(true);
        // The comment covers the whole second line, from its own start.
        let comment = shown.line_spans(1, &theme);
        assert!(comment.iter().any(|s| s.start == 0 && s.end == 6));
        // The third line's string sits where it does in that line, not in the file.
        let third = shown.line_spans(2, &theme);
        assert!(third.iter().all(|s| s.end <= 12), "spans stay inside the line: {third:?}");
        assert!(third.iter().any(|s| s.start == 8 && s.end == 11));
    }
}
