//! The command palette, after T3 Code: one search over
//! actions, tabs and recent threads, with nested lists for threads, files and projects. ⌘K opens it,
//! ⌘⇧O opens it on the threads and ⌘P on the files.

use crate::format;
use crate::protocol::{ClientMessage, ThemeChoice, ThreadSummary};
use crate::shell::{self, Desk};
use crate::workspace::Place;
use rune::{El, Key, KeyEvent, TextEdit, Tx, col, icon, row, text, text_input};
use rune_kit::{Keybind, Kit, scrim};
use rune_theme_opencode::icons as ic;

/// Threads the root list shows before the user types.
const RECENT_THREADS: usize = 20;
/// The palette's measures, from `@opencode/ui`'s Dialog and SearchList: 576 points wide,
/// 14% of the window's height from its top, and a list that scrolls past 302 points.
const WIDTH: f32 = 576.0;
const TOP: f32 = 0.14;
const LIST_MAX: f32 = 302.0;
const RADIUS: f32 = 12.0;
/// SearchList's rows: 36 points tall, rounded to 0.5rem of Desk's 13 pixel root.
const ROW_HEIGHT: f32 = 36.0;
const ROW_RADIUS: f32 = 8.125;

/// A nested list, by what it lists.
#[derive(Clone, Debug, PartialEq)]
pub enum Page {
    Threads(String),
    Files(String),
    /// Projects, to start a session in one.
    NewSessionIn,
    /// Projects, to search one's threads.
    SearchThreadsIn,
    /// Setups plugins offer, across projects.
    Setups,
    /// Panels the active project's plugins offer.
    Panels,
    /// The themes.
    Themes,
    /// The settings pages.
    Settings,
    /// Text for a plugin command that runs on it: the command's id, title and prompt.
    Input(String, String, String),
}

impl Page {
    fn title(&self, account: &crate::account::Account) -> String {
        match self {
            Page::Threads(project) => format!("Threads in {}", account.project_label(project)),
            Page::Files(project) => format!("Search files in {}", account.project_label(project)),
            Page::NewSessionIn => "New session in".into(),
            Page::SearchThreadsIn => "Search threads in".into(),
            Page::Setups => "Open setup".into(),
            Page::Panels => "Open panel".into(),
            Page::Themes => "Change theme".into(),
            Page::Settings => "Open settings".into(),
            Page::Input(_, _, prompt) => prompt.clone(),
        }
    }
}

#[derive(Clone)]
enum Action {
    Run(fn(&mut Desk, &mut Tx)),
    Open(Page),
    Tab(String),
    Thread(String, ThreadSummary),
    File(String, String),
    NewSessionIn(String),
    Setup(String, String, String),
    Panel(String),
    Command(String, Option<String>),
    Theme(ThemeChoice),
    Settings(&'static str),
}

#[derive(Clone)]
struct Entry {
    section: String,
    title: String,
    detail: Option<String>,
    icon: Option<&'static rune::Icon>,
    /// A file's icon leads the row, in its own colours.
    file_icon: Option<&'static rune::Icon>,
    /// A project's mark leads the row.
    project: Option<String>,
    shortcut: Option<&'static [&'static str]>,
    /// Marks the current choice in a list of choices, such as the theme.
    checked: bool,
    action: Action,
}

impl Entry {
    fn new(section: &str, title: impl Into<String>, action: Action) -> Entry {
        Entry { section: section.into(), title: title.into(), detail: None, icon: None, file_icon: None, project: None, shortcut: None, checked: false, action }
    }
}

#[derive(Default)]
pub struct Palette {
    open: bool,
    /// The lists it opened on, which Escape does not leave. ⌘⇧O and Escape make a pair.
    start: usize,
    pages: Vec<Page>,
    query: TextEdit,
    /// The query as it stood when the list was last lined up. A new query highlights the top row again.
    /// Rune calls `on_edit` for every key the field sees, the arrows too, so the reset can't sit there.
    typed: String,
    active: usize,
    /// The file search last sent, by project and query, and what the core found for it.
    asked: Option<(String, String)>,
    found: Option<(String, String, Vec<String>)>,
}

impl Palette {
    pub fn is_open(&self) -> bool {
        self.open
    }
}

impl Desk {
    /// Opens the palette on `pages`, or closes it when it is open.
    pub fn toggle_palette(&mut self, pages: Vec<Page>, tx: &mut Tx) {
        if self.palette.open {
            self.palette = Palette::default();
            return;
        }
        self.show_palette(pages);
        tx.focus("palette-input", false);
    }

    /// Opens the palette on `pages`, reading what they list.
    pub fn show_palette(&mut self, pages: Vec<Page>) {
        for page in &pages {
            self.load_page(page);
        }
        // Reading what the plugins offer starts them, so it waits for the palette. A search from the root finds
        // setups too, so they are read now, not only when their list opens.
        if let Some(project) = self.active_project() {
            self.core.send(&ClientMessage::ProjectGet { project: project.clone(), part: "plugins".into() });
            self.core.send(&ClientMessage::SetupsGet { project });
        }
        self.palette = Palette { open: true, start: pages.len(), pages, ..Palette::default() };
    }

    fn active_project(&self) -> Option<String> {
        self.workspace.active_tab().map(|t| t.project.clone()).or_else(|| self.workspace.recent.first().cloned())
    }

    /// Asks the core for what a list shows, when the palette does not have it yet.
    fn load_page(&mut self, page: &Page) {
        if let Page::Threads(project) = page {
            self.core.send(&ClientMessage::ProjectGet { project: project.clone(), part: "threads".into() });
        }
    }

    /// What the active project's plugins offer.
    fn offered(&self) -> Option<&crate::protocol::PluginContributions> {
        self.projects.get(&self.active_project()?)?.plugins.as_ref()
    }

    /// Takes the paths the core found, for the query the palette asked about.
    pub fn palette_files(&mut self, project: &str, query: &str, paths: &[String]) {
        if self.palette.asked.as_ref().is_some_and(|(p, q)| p == project && q == query) {
            self.palette.found = Some((project.to_owned(), query.to_owned(), paths.to_vec()));
        }
    }

    fn entries(&self) -> Vec<Entry> {
        let threads = |project: &str| -> Vec<Entry> {
            let summaries = self.projects.get(project).and_then(|p| p.threads.as_ref());
            summaries.into_iter().flatten().map(|t| {
                let mut entry = Entry::new(&self.account.project_label(project), t.title.clone(), Action::Thread(project.to_owned(), t.clone()));
                entry.detail = Some(format::ago(t.updated_at, format::now_ms()));
                entry
            }).collect()
        };
        let projects = |action: fn(String) -> Action| -> Vec<Entry> {
            self.workspace.recent.iter().map(|p| {
                let mut entry = Entry::new("Projects", self.account.project_label(p), action(p.clone()));
                entry.project = Some(p.clone());
                entry.detail = Some(format::short_path(p));
                entry
            }).collect()
        };
        let theme = self.account.settings.as_ref().map(|x| x.appearance.theme);
        let themes = || -> Vec<Entry> {
            ThemeChoice::ALL.iter().map(|t| {
                let mut entry = Entry::new("Themes", t.label(), Action::Theme(*t));
                entry.icon = Some(if *t == ThemeChoice::Auto { &ic::MONITOR } else { &ic::APPEARANCE });
                entry.checked = theme == Some(*t);
                entry
            }).collect()
        };
        let settings = || -> Vec<Entry> {
            crate::settings::PAGES.iter().map(|(id, title, mark)| {
                let mut entry = Entry::new("Settings", *title, Action::Settings(id));
                entry.icon = Some(*mark);
                entry
            }).collect()
        };
        // Every project's setups, each opening in its own project, which the row names when it is not the active one.
        let active = self.active_project();
        let setups = || -> Vec<Entry> {
            self.plugins
                .setups
                .iter()
                .map(|setup| {
                    let mut entry = Entry::new("Setups", setup.title.clone(), Action::Setup(setup.project.clone(), setup.id.clone(), setup.title.clone()));
                    entry.detail = (active.as_ref() != Some(&setup.project)).then(|| self.account.project_label(&setup.project));
                    entry.project = Some(setup.project.clone());
                    entry
                })
                .collect()
        };
        let panels = || -> Vec<Entry> {
            self.offered().map(|o| o.panels.iter().map(|p| {
                let mut entry = Entry::new("Panels", p.title.clone(), Action::Panel(p.id.clone()));
                entry.icon = Some(&crate::icons::PANEL);
                entry
            }).collect()).unwrap_or_default()
        };
        match self.palette.pages.last() {
            Some(Page::Threads(project)) => threads(project),
            Some(Page::Themes) => themes(),
            Some(Page::Settings) => settings(),
            // The last answer shows until the next one arrives, so the list doesn't empty between keys
            // and the palette doesn't shrink and grow back as the query changes.
            Some(Page::Files(project)) => match &self.palette.found {
                Some((p, _, paths)) if p == project => paths
                    .iter()
                    .map(|path| {
                        let (dir, name) = path.rsplit_once('/').map_or(("", path.as_str()), |(d, n)| (d, n));
                        let mut entry = Entry::new(&self.account.project_label(project), name, Action::File(project.clone(), path.clone()));
                        entry.detail = (!dir.is_empty()).then(|| format!("{dir}/"));
                        entry.file_icon = Some(crate::icons::file_icon(path));
                        entry
                    })
                    .collect(),
                _ => Vec::new(),
            },
            Some(Page::NewSessionIn) => projects(Action::NewSessionIn),
            Some(Page::SearchThreadsIn) => projects(|p| Action::Open(Page::Threads(p))),
            Some(Page::Panels) => panels(),
            Some(Page::Input(id, title, _)) => {
                let query = self.palette.query.text.trim().to_owned();
                if query.is_empty() { Vec::new() } else { vec![Entry::new(title, query.clone(), Action::Command(id.clone(), Some(query)))] }
            }
            Some(Page::Setups) => setups(),
            None => {
                let project = self.active_project();
                let action = |title: &str, icon: &'static rune::Icon, shortcut: Option<&'static [&'static str]>, action: Action| {
                    let mut entry = Entry::new("Actions", title, action);
                    entry.icon = Some(icon);
                    entry.shortcut = shortcut;
                    entry
                };
                let panel_open = self.workspace.active_tab().is_some_and(|t| t.panel_open == Some(true));
                let mut root = vec![
                    action("New session", &ic::PLUS, Some(&["⌘", "T"]), Action::Run(shell::commands::new_session)),
                    action("New session in…", &ic::FOLDER_ADD_LEFT, None, Action::Open(Page::NewSessionIn)),
                ];
                if let Some(project) = &project {
                    root.push(action("Search threads", &ic::MAGNIFYING_GLASS, Some(&["⌘", "⇧", "O"]), Action::Open(Page::Threads(project.clone()))));
                }
                root.push(action("Search threads in…", &ic::MAGNIFYING_GLASS, None, Action::Open(Page::SearchThreadsIn)));
                if let Some(project) = &project {
                    root.push(action("Search files", &ic::MAGNIFYING_GLASS, Some(&["⌘", "P"]), Action::Open(Page::Files(project.clone()))));
                }
                root.push(action("New terminal", &ic::TERMINAL, Some(&["⌃", "`"]), Action::Run(shell::commands::new_terminal)));
                root.push(action(if panel_open { "Hide panel" } else { "Show panel" }, &crate::icons::PANEL, Some(&["⌘", "\\"]), Action::Run(shell::commands::toggle_panel)));
                root.push(action("Open folder…", &ic::FOLDER, Some(&["⌘", "O"]), Action::Run(shell::commands::open_folder)));
                root.push(action("Open setup…", &ic::WORKSPACE, None, Action::Open(Page::Setups)));
                root.push(action("Open panel…", &crate::icons::PANEL, None, Action::Open(Page::Panels)));
                root.push(action("Change theme…", &ic::APPEARANCE, None, Action::Open(Page::Themes)));
                root.push(action("Open settings…", &ic::SETTINGS_GEAR, None, Action::Open(Page::Settings)));
                root.extend(self.offered().into_iter().flat_map(|o| o.commands.iter()).map(|c| {
                    let run = match &c.input {
                        Some(prompt) => Action::Open(Page::Input(c.id.clone(), c.title.clone(), prompt.clone())),
                        None => Action::Command(c.id.clone(), None),
                    };
                    let mut entry = Entry::new("Plugins", c.title.clone(), run);
                    entry.icon = Some(&ic::CODE_SLASH);
                    entry
                }));
                root.extend(self.workspace.tabs.iter().map(|t| {
                    let mut entry = Entry::new("Tabs", t.title.clone(), Action::Tab(t.id.clone()));
                    entry.detail = Some(self.account.project_label(&t.project));
                    entry.project = Some(t.project.clone());
                    entry
                }));
                let recent = project.as_deref().map(threads).unwrap_or_default();
                if self.palette.query.text.trim().is_empty() {
                    root.extend(recent.into_iter().take(RECENT_THREADS));
                } else {
                    // A search from the root also finds what the nested lists hold.
                    root.extend(themes());
                    root.extend(settings());
                    root.extend(projects(Action::NewSessionIn));
                    root.extend(setups());
                    root.extend(panels());
                    root.extend(recent);
                }
                root
            }
        }
    }

    /// Every word must appear in the entry's title, its detail or its section. A list the core searched already matches.
    fn matches(&self) -> Vec<Entry> {
        let entries = self.entries();
        if matches!(self.palette.pages.last(), Some(Page::Files(_))) {
            return entries;
        }
        let query = self.palette.query.text.to_lowercase();
        let words: Vec<&str> = query.split_whitespace().collect();
        entries
            .into_iter()
            .filter(|e| {
                let haystack = format!("{} {} {}", e.title, e.detail.as_deref().unwrap_or(""), e.section).to_lowercase();
                words.iter().all(|w| haystack.contains(w))
            })
            .collect()
    }

    fn select(&mut self, entry: Entry, tx: &mut Tx) {
        if let Action::Open(page) = entry.action {
            self.load_page(&page);
            self.palette.pages.push(page);
            self.palette.query = TextEdit::new("");
            self.palette.active = 0;
            // A fresh query drops the field's focus. The keys only work there, so it takes focus back.
            tx.focus("palette-input", false);
            // A level opens whole, as the keyboard moves between them.
            tx.instant();
            return;
        }
        self.palette = Palette::default();
        match entry.action {
            Action::Run(run) => run(self, tx),
            Action::Tab(id) => {
                self.workspace.show_tab(&id, &self.core);
                self.sync_start();
                self.sync_panel();
            }
            Action::Thread(project, thread) => self.open_thread(&thread, &project, tx),
            Action::File(project, path) => {
                if let Some(tab) = self.workspace.active.clone() {
                    let absolute = format!("{}/{path}", project.trim_end_matches('/'));
                    self.workspace.open_file_tab(&tab, &absolute, None, &self.core);
                    self.sync_panel();
                }
            }
            Action::NewSessionIn(project) => {
                if self.workspace.new_tab(Place::End, Some(project), &self.account, &self.core).is_ok() {
                    self.sync_start();
                }
            }
            Action::Setup(project, id, title) => self.open_setup(&project, &id, &title),
            Action::Panel(panel) => {
                if let Some(tab) = self.workspace.active.clone() {
                    self.core.send(&ClientMessage::PanelOpen { tab_id: tab, panel });
                }
            }
            Action::Command(command, input) => {
                if let Some(tab) = self.workspace.active.clone() {
                    self.core.send(&ClientMessage::PluginCommand { tab_id: tab, command, input });
                }
            }
            Action::Theme(theme) => self.set_theme(theme.id()),
            Action::Settings(page) => {
                // Closed Settings slide up as they open. A page picked while they show swaps in whole,
                // with no fade or slide of its parts.
                if self.workspace.settings_page.is_some() {
                    tx.instant();
                }
                self.open_settings(page);
                tx.focus("settings", false);
            }
            Action::Open(_) => {}
        }
    }

    /// Arrows move, Enter picks, and Escape or Backspace in an empty field leaves a nested list before it closes.
    fn palette_key(&mut self, event: &KeyEvent, tx: &mut Tx) -> bool {
        let count = self.matches().len();
        match event.key {
            Key::Down | Key::Up if count > 0 => {
                self.palette.active = if event.key == Key::Down { (self.palette.active + 1) % count } else { (self.palette.active + count - 1) % count };
                // The list scrolls to keep the highlighted row in sight.
                tx.scroll_into_view_in("palette", format!("palette-{}", self.palette.active));
            }
            Key::Enter => {
                if let Some(entry) = self.matches().into_iter().nth(self.palette.active) {
                    self.select(entry, tx);
                }
            }
            Key::Escape | Key::Backspace if self.palette.pages.len() > self.palette.start && (event.key == Key::Escape || self.palette.query.text.is_empty()) => {
                self.palette.pages.pop();
                self.palette.query = TextEdit::new("");
                self.palette.active = 0;
                tx.instant();
            }
            Key::Escape => self.palette = Palette::default(),
            _ => return false,
        }
        true
    }

    /// Lines the list up with the query: a new query highlights the top row again, and on the files
    /// list asks the core for files.
    pub fn sync_palette(&mut self) {
        if self.palette.query.text != self.palette.typed {
            self.palette.typed = self.palette.query.text.clone();
            self.palette.active = 0;
        }
        if let Some(Page::Files(project)) = self.palette.pages.last().cloned() {
            let wanted = (project, self.palette.query.text.clone());
            if self.palette.asked.as_ref() != Some(&wanted) {
                self.core.send(&ClientMessage::FilesSearch { project: wanted.0.clone(), query: wanted.1.clone() });
                self.palette.asked = Some(wanted);
            }
        }
    }
}

/// A key for the level the palette shows. A page can hold a path, which a key must not, so it is hashed.
fn level_key(pages: &[Page]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    format!("{:?}", pages.last()).hash(&mut h);
    format!("palette-level-{}-{:x}", pages.len(), h.finish())
}

/// `window_height` places the palette 14% of the way down the window.
pub fn palette(s: &Desk, window_height: f32, k: &Kit, layer: &mut Vec<El>) {
    if !s.palette.open {
        return;
    }
    let placeholder = s.palette.pages.last().map_or_else(|| "Search actions, tabs and threads".to_owned(), |p| format!("{}…", p.title(&s.account)));
    let input = text_input(&s.palette.query, rune::TextStyle::new(14.0, 440.0).lh(16.0))
        .key("palette-input")
        .single_line()
        .w_full()
        .color(k.c.text_base)
        .placeholder(placeholder, k.c.text_faint)
        .caret(k.c.text_base, k.selection())
        .on_edit(|s: &mut Desk| &mut s.palette.query)
        .on_input_key(|s: &mut Desk, event: &KeyEvent, tx| s.palette_key(event, tx));
    // A 40 point field, 6 and 8 points in, over a border that takes a point of room in CSS and none in Rune.
    let field = row()
        .w_full()
        .h(53.0)
        .gap(12.0)
        .items_center()
        .px(20.0)
        .pb(1.0)
        .border_sides([0.0, 0.0, 1.0, 0.0], k.c.border_base)
        .child(icon(&ic::MAGNIFYING_GLASS, crate::icons::SIZE).color(k.c.text_faint))
        .child(input);
    let matches = s.matches();
    let active = s.palette.active.min(matches.len().saturating_sub(1));
    // Sections 16 points apart, their rows a point apart, under 26 point headers. Each level is its own list:
    // with one list for all, Rune would take a row of the last level for the row in its place in the next,
    // and animate one into the other.
    let mut list = col().key(level_key(&s.palette.pages)).w_full().px(8.0).pt(6.0).pb(8.0).gap(1.0);
    let mut section = None;
    for (i, entry) in matches.iter().enumerate() {
        let heading = s.palette.pages.last().map_or_else(|| entry.section.clone(), |p| p.title(&s.account));
        if section.as_ref() != Some(&heading) {
            let top = if section.is_some() { 16.0 } else { 0.0 };
            list = list.child(row().h(26.0).mt(top).items_center().px(10.0).child(text(heading.clone()).font(rune::TextStyle::new(12.0, 440.0).lh(16.0)).color(k.c.text_muted)));
            section = Some(heading);
        }
        list = list.child(entry_row(s, entry, i, i == active, k));
    }
    let empty = matches.is_empty().then(|| {
        let words = if s.palette.query.text.is_empty() { "Nothing to show yet." } else { "Nothing matches." };
        col().w_full().py(24.0).center().child(text(words).font(crate::theme::text(13.0)).color(k.c.text_faint))
    });
    let back = s.palette.pages.len() > s.palette.start;
    let hint = |keys: &[&str], label: &str| row().gap(6.0).items_center().child(Keybind::new(keys).build(k)).child(text(label.to_owned()).font(rune::TextStyle::new(12.0, 440.0).lh(16.0)).color(k.c.text_muted));
    let footer = row()
        .w_full()
        .h(35.0)
        .gap(16.0)
        .items_center()
        .px(16.0)
        .pt(1.0)
        .fill(k.c.text_base.alpha(0.025))
        .border_sides([1.0, 0.0, 0.0, 0.0], k.c.border_base)
        .child(hint(&["↑", "↓"], "Navigate"))
        .child(hint(&["↵"], "Select"))
        .child(hint(&["ESC"], if back { "Back" } else { "Close" }));
    let body = col()
        .key("palette")
        .w(WIDTH)
        .role("dialog")
        .label("Command palette")
        .child(field)
        .child(col().w_full().max_h(LIST_MAX).scroll(rune::ScrollSpec { stick_bottom: false }).child(list).children(empty))
        .child(footer);
    // The window dims behind the palette, as behind `@opencode/ui`'s dialogs.
    layer.push(scrim("palette-scrim", |s: &mut Desk| s.palette = Palette::default()).fill(k.c.scrim));
    let surface = k.elevate(body.radius(RADIUS).clip_rounded(RADIUS).fill(k.c.layer_01).border(1.0, crate::theme::outline(k.dark)), &k.elevation.overlay);
    layer.push(col().key("palette-layer").absolute(0.0, 0.0).w_full().pt(TOP * window_height).items_center().child(surface));
}

/// A row's shortcut as one word, such as ⌘T, as T3 Code prints it: a ghost Keybind's keys with no gap
/// between them, which rune-kit's Keybind does not offer.
fn shortcut(keys: &[&str], k: &Kit) -> El {
    text(keys.concat()).font(rune::TextStyle::new(11.0, 530.0).lh(14.0).tracking(0.05)).color(k.c.text_faint).px(1.0)
}

fn entry_row(s: &Desk, entry: &Entry, index: usize, active: bool, k: &Kit) -> El {
    let lead = match (&entry.project, entry.file_icon, entry.icon) {
        (Some(project), ..) => Some(shell::project_mark(s, project, k)),
        (None, Some(file), _) => Some(icon(file, crate::icons::SIZE)),
        (None, None, Some(mark)) => Some(icon(mark, crate::icons::SIZE).color(k.c.text_faint)),
        _ => None,
    };
    let picked = entry.clone();
    row()
        .key(format!("palette-{index}"))
        .h(ROW_HEIGHT)
        .w_full()
        .gap(12.0)
        .items_center()
        .px(12.0)
        .radius(ROW_RADIUS)
        // The active row: white at 10% on dark, Desk's hover colour on light.
        .fill(if !active { rune::Color::TRANSPARENT } else if k.dark { rune::Color::WHITE.alpha(0.1) } else { k.c.hover })
        .role("option")
        .on_press_tx(move |s: &mut Desk, tx| s.select(picked.clone(), tx))
        .children(lead)
        .child(text(entry.title.clone()).font(crate::theme::text(13.0)).color(k.c.text_base).truncate())
        .children(entry.detail.clone().map(|d| text(d).font(crate::theme::text(12.0)).color(k.c.text_faint).truncate()))
        .child(row().grow(1.0))
        .children(entry.shortcut.map(|keys| shortcut(keys, k)))
        .children(entry.checked.then(|| icon(&ic::CHECK, 15.0).color(k.c.text_base)))
        .children(matches!(entry.action, Action::Open(_)).then(|| icon(&ic::OUTLINE_CHEVRON_RIGHT, 15.0).color(k.c.text_faint)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::Event;
    use crate::protocol::CoreMessage;

    fn desk() -> Desk {
        let mut s = Desk::default();
        let messages = serde_json::json!([
            { "type": "recent", "projects": ["/code/web", "/code/api"] },
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "Fix login", "project": "/code/web", "terminals": [], "model": "default", "permissionMode": "auto" }] },
            { "type": "project", "project": "/code/web", "part": "threads", "value": [{ "id": "s1", "title": "Speed up the build", "updatedAt": 0.0 }] }
        ]);
        for m in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(m)).unwrap();
        }
        let _ = s.core.sent();
        s
    }

    fn titles(s: &Desk) -> Vec<String> {
        s.matches().into_iter().map(|e| e.title).collect()
    }

    #[test]
    fn the_root_lists_actions_tabs_and_recent_threads_and_every_word_must_match() {
        let mut s = desk();
        s.show_palette(Vec::new());
        let all = titles(&s);
        assert!(all.contains(&"New session".to_owned()) && all.contains(&"Fix login".to_owned()) && all.contains(&"Speed up the build".to_owned()));
        s.palette.query = TextEdit::new("build speed");
        assert_eq!(titles(&s), ["Speed up the build"]);
        s.palette.query = TextEdit::new("api");
        assert!(titles(&s).contains(&"api".to_owned()), "a search from the root finds projects too");
    }

    #[test]
    fn a_search_from_the_root_finds_setups_which_the_palette_reads_as_it_opens() {
        let mut s = desk();
        s.show_palette(Vec::new());
        assert!(s.core.sent().iter().any(|m| m["type"] == "setups.get"), "setups are read with the palette, not only with their list");
        let setup = |project: &str, title: &str| crate::protocol::ProjectSetup { project: project.into(), id: title.to_lowercase(), title: title.into() };
        s.plugins.setups = vec![setup("/code/web", "Support inbox"), setup("/code/api", "Support triage")];
        s.palette.query = TextEdit::new("support");
        let found: Vec<(String, Option<String>)> = s.matches().into_iter().map(|e| (e.title, e.detail)).collect();
        assert_eq!(found, [("Support inbox".into(), None), ("Support triage".into(), Some("api".into()))], "another project's setup names its project");
    }

    #[test]
    fn the_files_list_asks_the_core_and_shows_its_answer() {
        let mut s = desk();
        s.show_palette(vec![Page::Files("/code/web".into())]);
        s.palette.query = TextEdit::new("log");
        s.sync_palette();
        assert!(s.core.sent().iter().any(|m| m["type"] == "files.search" && m["query"] == "log"));
        s.found_files("/code/web".into(), "log".into(), vec!["src/login.ts".into()]);
        assert_eq!(titles(&s), ["login.ts"]);
    }

    #[test]
    fn the_files_list_keeps_its_last_answer_until_the_next_arrives() {
        let mut s = desk();
        s.show_palette(vec![Page::Files("/code/web".into())]);
        s.palette.query = TextEdit::new("log");
        s.sync_palette();
        s.found_files("/code/web".into(), "log".into(), vec!["src/login.ts".into()]);
        // A key typed before the core answers keeps the list, so the palette doesn't shrink and grow back.
        s.palette.query = TextEdit::new("logi");
        s.sync_palette();
        assert_eq!(titles(&s), ["login.ts"]);
        s.found_files("/code/web".into(), "logi".into(), vec![]);
        assert!(titles(&s).is_empty());
    }
}
