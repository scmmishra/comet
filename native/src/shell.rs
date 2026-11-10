//! The window: the tab bar, which doubles as the title bar, and the main panel under it.

use crate::account::Account;
use crate::composer::{self, Drafts};
use crate::core::{Core, Event};
use crate::format;
use crate::protocol::{ClientMessage, CoreMessage, TabInfo, ThemeChoice, ThreadRow};
use crate::theme;
use crate::thread_view;
use crate::threads::Threads;
use crate::workspace::{NeedsFolder, Place, Workspace};
use rune::{Color, Cx, El, FileDialogOptions, Tx, col, row, text};
use std::time::Duration;
use rune_kit::shell::{TabDragState, TabItem, TabOrientation, TabReorder, TabStrip, WindowTitlebar};
use rune_kit::{ControlSize, IconButton, IconButtonVariant};
use rune_theme_opencode::icons as ic;

/// The tab bar's height. The window's buttons sit centred in it.
pub const TITLEBAR_HEIGHT: f32 = 44.0;
/// The ground shown around the main panel, on its sides and below it.
const PANEL_INSET: f32 = 8.0;
/// The main panel's corners, Desk's `rounded-3xl`.
const PANEL_RADIUS: f32 = 12.0;
/// The session's header, `h-[46px]`.
const HEADER_HEIGHT: f32 = 46.0;
/// The project mark in the session's header, `size-[18px]`.
const HEADER_MARK: f32 = 18.0;

#[derive(Debug, Default, PartialEq)]
pub enum CoreState {
    #[default]
    Starting,
    Ready,
    Failed(String),
}

#[derive(Default)]
pub struct Desk {
    pub core: Core,
    pub status: CoreState,
    pub account: Account,
    pub workspace: Workspace,
    pub threads: Threads,
    pub drafts: Drafts,
    pub picker: crate::model_picker::Picker,
    pub projects: crate::projects::Projects,
    pub start: crate::start_screen::Start,
    pub images: crate::images::Images,
    /// The wall clock, in milliseconds since the epoch, as of the last tick. It ticks each second
    /// while a turn runs, for the working head.
    pub now_ms: f64,
    /// The last error the core reported for something the user asked.
    pub error: Option<String>,
    /// Whether ⌘ is held, so the new tab button opens its tab next to the active one.
    cmd_held: bool,
    strip: TabDragState,
}

impl Desk {
    pub fn new(core: Core) -> Desk {
        Desk { core, drafts: Drafts::load(), ..Desk::default() }
    }

    /// Takes what the core said. An empty window with no project needs a folder, which the caller asks for.
    pub fn receive(&mut self, event: Event) -> Result<(), NeedsFolder> {
        match event {
            Event::Ready => self.status = CoreState::Ready,
            Event::Failed(reason) => self.status = CoreState::Failed(reason),
            Event::Message(message) => return self.read(message),
        }
        Ok(())
    }

    /// Takes what the core said, as the event loop runs it, asking for a folder when one is needed.
    pub fn receive_in(&mut self, event: Event, tx: &mut Tx) {
        if self.receive(event).is_err() {
            open_folder(tx);
        }
    }

    fn read(&mut self, message: CoreMessage) -> Result<(), NeedsFolder> {
        let (w, account, core) = (&mut self.workspace, &self.account, &self.core);
        let mut result = Ok(());
        match message {
            CoreMessage::Settings { settings } => self.account.settings = Some(settings),
            CoreMessage::Models { models } => self.account.models = models,
            CoreMessage::Recent { projects } => w.recent = projects,
            CoreMessage::Tabs { tabs, active } => result = w.restore(tabs, active, account, core),
            CoreMessage::TabReopened { tab, index } => w.reopened(tab, index, core),
            CoreMessage::TabTitle { tab_id, title } => w.name_tab(&tab_id, &title, core),
            CoreMessage::SessionHistory { tab_id, items, context } => {
                for item in &items {
                    self.remember_images(item);
                }
                self.threads.history(&tab_id, items, context);
            }
            CoreMessage::SessionRows { tab_id, rows } => self.threads.rows(&tab_id, rows),
            CoreMessage::SessionEvent { tab_id, event } => {
                if let crate::protocol::ThreadEvent::Item { item } = &event {
                    self.remember_images(item);
                }
                self.threads.apply(&tab_id, event);
            }
            CoreMessage::Queue { tab_id, messages, held } => {
                for image in messages.iter().flat_map(|m| &m.images) {
                    self.images.remember(image);
                }
                self.threads.queue(&tab_id, messages, held);
            }
            CoreMessage::Project { project, part, value } => self.projects.read(project, &part, value),
            CoreMessage::FilesFound { project, query, paths } => self.found_files(project, query, paths),
            CoreMessage::Error { message } => self.error = Some(message),
            CoreMessage::Other => {}
        }
        let tabs: Vec<String> = self.workspace.tabs.iter().map(|t| t.id.clone()).collect();
        self.threads.keep(&tabs);
        self.sync_start();
        result
    }

    /// Opens a tab, or asks for a folder when the window has no project yet.
    fn new_tab(&mut self, place: Place, project: Option<String>, tx: &mut Tx) {
        if let Err(NeedsFolder) = self.workspace.new_tab(place, project, &self.account, &self.core) {
            open_folder(tx);
        }
        self.sync_start();
    }

    fn close_tab(&mut self, id: &str, tx: &mut Tx) {
        if let Err(NeedsFolder) = self.workspace.close_tab(id, &self.account, &self.core) {
            open_folder(tx);
        }
        self.sync_start();
    }

    fn remember_images(&mut self, item: &crate::protocol::ThreadItem) {
        if let crate::protocol::ThreadItem::User { images, .. } = item {
            for image in images {
                self.images.remember(image);
            }
        }
    }

    pub fn cmd_held(&self) -> bool {
        self.cmd_held
    }

    /// Answers a permission request in a tab.
    pub fn answer_permission(&self, tab: &str, request_id: &str, answer: &str) {
        self.core.send(&ClientMessage::PermissionAnswer { tab_id: tab.to_owned(), request_id: request_id.to_owned(), answer: answer.to_owned() });
    }

    /// Whether the active tab's turn is running, so its head counts seconds.
    fn working(&self) -> bool {
        let thread = self.workspace.active.as_deref().and_then(|tab| self.threads.get(tab));
        thread.is_some_and(|t| t.rows.iter().any(|r| matches!(r, ThreadRow::Working { .. })))
    }

    fn dark(&self, cx: &Cx<Desk>) -> bool {
        match self.account.theme() {
            ThemeChoice::Dark => true,
            ThemeChoice::Light => false,
            ThemeChoice::Auto => cx.system_dark(),
        }
    }
}

/// Asks for a folder and opens a tab in it.
pub fn open_folder(tx: &mut Tx) {
    let options = FileDialogOptions { title: "Open Folder".into(), ..Default::default() };
    tx.open_folder(options, |s: &mut Desk, result, tx| match result {
        Ok(Some(dir)) => s.new_tab(Place::End, Some(dir.to_string_lossy().into_owned()), tx),
        Ok(None) => {}
        Err(e) => s.error = Some(e.to_string()),
    });
}

/// What the menus run. Each is the same action as the Electron app's command of that id.
pub mod commands {
    use super::*;

    pub fn new_session(s: &mut Desk, tx: &mut Tx) {
        s.new_tab(Place::End, None, tx);
    }

    pub fn open_folder(_: &mut Desk, tx: &mut Tx) {
        super::open_folder(tx);
    }

    pub fn close_tab(s: &mut Desk, tx: &mut Tx) {
        if let Some(id) = s.workspace.active.clone() {
            s.close_tab(&id, tx);
        }
    }

    pub fn reopen_tab(s: &mut Desk, _: &mut Tx) {
        s.core.send(&ClientMessage::TabReopen);
    }

    pub fn show_tab<const INDEX: usize>(s: &mut Desk, _: &mut Tx) {
        s.workspace.show_tab_at(INDEX, &s.core);
        s.sync_start();
    }
}

/// Ticks the clock each second while a turn runs. A still window does no work.
pub fn poll(s: &mut Desk, _: f64, tx: &mut Tx) -> bool {
    let composed = composer::poll(s, tx);
    if !s.working() {
        return composed;
    }
    let now = format::now_ms();
    let ticked = (now / 1000.0).floor() != (s.now_ms / 1000.0).floor();
    s.now_ms = now;
    tx.wake_after(Duration::from_millis(1000 - (now as u64 % 1000)));
    ticked || composed
}

/// Hears the modifier keys held down each time they change.
pub fn modifiers(s: &mut Desk, mods: rune::Mods, _: &mut Tx) {
    s.cmd_held = mods.cmd;
}

fn select(s: &mut Desk, id: &str, _: &mut Tx) {
    s.workspace.show_tab(id, &s.core);
    s.sync_start();
}

fn close(s: &mut Desk, id: &str, tx: &mut Tx) {
    s.close_tab(id, tx);
}

fn reorder(s: &mut Desk, r: TabReorder, _: &mut Tx) {
    s.workspace.move_tab(r.from, r.to, &s.core);
}

pub fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    let k = theme::kit(s.dark(cx));
    let mut layer = Vec::new();
    let w = &s.workspace;
    let plus = IconButton::new(&ic::PLUS)
        .control_size(ControlSize::Large)
        .variant(IconButtonVariant::GhostMuted)
        .label("New tab")
        .help("New tab. ⌘-click opens it next to this one.")
        .on_press_tx(|s: &mut Desk, tx: &mut Tx| s.new_tab(if s.cmd_held { Place::Next } else { Place::End }, None, tx))
        .build(k)
        .key("new-tab");
    let strip = TabStrip::new("tabs", TabOrientation::Horizontal)
        .tabs(w.tabs.iter().map(|t| TabItem::new(t.id.as_str(), t.title.as_str())))
        .active(w.active.as_deref())
        .viewport_width(cx.layout_size("tabs").map(|size| size[0]))
        .drag_state(&s.strip, |s: &mut Desk| &mut s.strip)
        .close_icon(&ic::XMARK_SMALL)
        .trailing_action(plus)
        .on_select(select)
        .on_close(close)
        .on_reorder(reorder)
        .build_layered(k, &mut layer);
    let titlebar = WindowTitlebar::from_insets(cx.chrome_insets(), 1.0).tabs(strip).build(k);

    let dark = s.dark(cx);
    let line = |words: String| text(words).font(k.ty.ui).color(k.c.text_muted);
    let content = match (&s.status, w.active_tab()) {
        (CoreState::Ready, Some(tab)) => session(s, tab, dark, &mut layer),
        (status, _) => {
            let words = match status {
                CoreState::Starting => line("Starting…".into()),
                CoreState::Failed(reason) => text(reason.clone()).font(k.ty.ui).color(k.c.danger.fg),
                CoreState::Ready => line("No tabs".into()),
            };
            col().w_full().grow(1.0).center().child(words.key("status"))
        }
    };
    let body = col()
        .key("body")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .fill(k.c.bg_base)
        .radius(PANEL_RADIUS)
        .clip_rounded(PANEL_RADIUS)
        .border(1.0, k.c.border_muted)
        .child(content)
        .children(s.error.clone().map(|e| text(e).key("error").font(k.ty.ui).color(k.c.danger.fg).px(16.0).pb(8.0)));
    let main = col().key("main").w_full().grow(1.0).min_h(0.0).px(PANEL_INSET).pb(PANEL_INSET).child(body);
    rune_kit::root(col().key("window").w_full().h_full().fill(k.c.bg_deep).child(titlebar).child(main), layer)
}

/// A tab's session: its header and its thread.
fn session(s: &Desk, tab: &TabInfo, dark: bool, layer: &mut Vec<El>) -> El {
    let k = theme::kit(dark);
    let name = format::project_name(&tab.project);
    let header = row()
        .key("session-header")
        .w_full()
        .h(HEADER_HEIGHT)
        .items_center()
        .pl(16.0)
        .pr(48.0)
        .gap(7.0)
        .child(project_mark(name, k))
        .child(text(name.to_owned()).font(k.ty.ui).color(k.c.text_muted))
        .child(text("/").font(k.ty.ui).color(k.c.text_faint))
        .child(text(tab.title.clone()).font(k.ty.ui_medium).color(k.c.text_base).truncate());
    let started = s.threads.get(&tab.id).is_some_and(|t| !t.items.is_empty());
    let body = if started {
        col().w_full().grow(1.0).min_h(0.0).child(thread_view::thread(s, &tab.id, dark)).child(composer::composer(s, tab, composer::ListAt::Above, k, layer))
    } else {
        crate::start_screen::start_screen(s, tab, k, layer)
    };
    col().key(format!("session-{}", tab.id)).w_full().grow(1.0).min_h(0.0).child(header).child(body)
}

/// A project's mark: its initial on a small tile. `@opencode/ui`'s avatar draws generated art in its place.
pub fn project_mark(name: &str, k: &rune_kit::Kit) -> El {
    let initial = name.chars().next().unwrap_or(' ').to_uppercase().to_string();
    row()
        .size(HEADER_MARK, HEADER_MARK)
        .radius(4.0)
        .center()
        .fill(k.c.layer_03)
        .border(0.5, Color::WHITE.alpha(0.08))
        .child(text(initial).font(rune::TextStyle { size: 11.0, weight: 530.0, line_height: 11.0, ..k.ty.small }).color(k.c.text_base))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::TabInfo;
    use rune::{Env, Runtime};
    use serde_json::Map;

    fn tab(id: &str, title: &str) -> TabInfo {
        TabInfo { id: id.into(), title: title.into(), project: format!("/code/{id}"), terminals: vec![], model: "default".into(), effort: None, fast: None, permission_mode: "auto".into(), rest: Map::new() }
    }

    fn runtime(tabs: Vec<TabInfo>, active: &str) -> Runtime<Desk> {
        let mut rt = Runtime::new(Desk { status: CoreState::Ready, ..Desk::default() }, view, (1280.0, 820.0), Env { system_dark: true, scale: 2.0 });
        let message = CoreMessage::Tabs { tabs, active: Some(active.into()) };
        rt.update(move |s, tx| s.receive_in(Event::Message(message), tx));
        rt.frame(0.0);
        rt
    }

    fn texts(rt: &Runtime<Desk>) -> Vec<String> {
        rt.elements().into_iter().filter_map(|e| e.text).collect()
    }

    #[test]
    fn the_tab_bar_shows_each_tab_and_the_header_its_project() {
        let rt = runtime(vec![tab("a", "Fix the login form"), tab("b", "New session")], "b");
        let texts = texts(&rt);
        for words in ["Fix the login form", "New session", "b"] {
            assert!(texts.iter().any(|t| t == words), "{words:?} shows in {texts:?}");
        }
    }

    #[test]
    fn the_plus_button_opens_a_tab_in_the_active_project() {
        let mut rt = runtime(vec![tab("a", "First")], "a");
        let (x, y) = rt.find("new-tab").expect("the new tab button");
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.frame(1.0 / 60.0);
        assert_eq!(rt.state.workspace.tabs.len(), 2);
        assert_eq!(rt.state.workspace.tabs[1].project, "/code/a");
        let sent = rt.state.core.sent();
        assert!(sent.iter().any(|m| m["type"] == "tabs.save"), "the new tab is saved");
        assert!(sent.iter().any(|m| m["type"] == "project.get" && m["part"] == "threads"), "its start screen reads the project's threads");
    }

    #[test]
    fn an_empty_window_with_no_project_asks_for_a_folder() {
        let mut rt = runtime(vec![], "none");
        rt.frame(1.0 / 60.0);
        assert!(rt.file_dialog().is_some(), "a folder dialog opens");
        rt.resolve_file_dialog(Some("/code/picked".into())).expect("the dialog was open");
        rt.frame(1.0 / 60.0);
        assert_eq!(rt.state.workspace.tabs.iter().map(|t| t.project.as_str()).collect::<Vec<_>>(), ["/code/picked"]);
    }
}
