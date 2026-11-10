//! The window: the tab bar, which doubles as the title bar, and the main panel under it.

use crate::account::Account;
use crate::core::{Core, Event};
use crate::protocol::{ClientMessage, CoreMessage, ThemeChoice};
use crate::theme;
use crate::workspace::{NeedsFolder, Place, Workspace};
use rune::{Cx, El, FileDialogOptions, Tx, col, text};
use rune_kit::shell::{TabDragState, TabItem, TabOrientation, TabReorder, TabStrip, WindowTitlebar};
use rune_kit::{ControlSize, IconButton, IconButtonVariant};
use rune_theme_opencode::icons as ic;

/// The tab bar's height. The window's buttons sit centred in it.
pub const TITLEBAR_HEIGHT: f32 = 44.0;
/// The ground shown around the main panel, on its sides and below it.
const PANEL_INSET: f32 = 8.0;
/// The main panel's corners, Desk's `rounded-3xl`.
const PANEL_RADIUS: f32 = 12.0;

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
    /// The last error the core reported for something the user asked.
    pub error: Option<String>,
    /// Whether ⌘ is held, so the new tab button opens its tab next to the active one.
    cmd_held: bool,
    strip: TabDragState,
}

impl Desk {
    pub fn new(core: Core) -> Desk {
        Desk { core, ..Desk::default() }
    }

    pub fn receive(&mut self, event: Event, tx: &mut Tx) {
        match event {
            Event::Ready => self.status = CoreState::Ready,
            Event::Failed(reason) => self.status = CoreState::Failed(reason),
            Event::Message(message) => self.read(message, tx),
        }
    }

    fn read(&mut self, message: CoreMessage, tx: &mut Tx) {
        let (w, account, core) = (&mut self.workspace, &self.account, &self.core);
        match message {
            CoreMessage::Settings { settings } => self.account.settings = Some(settings),
            CoreMessage::Models { models } => self.account.models = models,
            CoreMessage::Recent { projects } => w.recent = projects,
            CoreMessage::Tabs { tabs, active } => {
                if w.restore(tabs, active, account, core).is_err() {
                    open_folder(tx);
                }
            }
            CoreMessage::TabReopened { tab, index } => w.reopened(tab, index, core),
            CoreMessage::TabTitle { tab_id, title } => w.name_tab(&tab_id, &title, core),
            CoreMessage::Error { message } => self.error = Some(message),
            CoreMessage::Other => {}
        }
    }

    /// Opens a tab, or asks for a folder when the window has no project yet.
    fn new_tab(&mut self, place: Place, project: Option<String>, tx: &mut Tx) {
        if let Err(NeedsFolder) = self.workspace.new_tab(place, project, &self.account, &self.core) {
            open_folder(tx);
        }
    }

    fn close_tab(&mut self, id: &str, tx: &mut Tx) {
        if let Err(NeedsFolder) = self.workspace.close_tab(id, &self.account, &self.core) {
            open_folder(tx);
        }
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
fn open_folder(tx: &mut Tx) {
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
    }
}

/// Hears the modifier keys held down each time they change.
pub fn modifiers(s: &mut Desk, mods: rune::Mods, _: &mut Tx) {
    s.cmd_held = mods.cmd;
}

fn select(s: &mut Desk, id: &str, _: &mut Tx) {
    s.workspace.show_tab(id, &s.core);
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

    let line = |words: String| text(words).font(k.ty.ui).color(k.c.text_muted);
    let status = match (&s.status, w.active_tab()) {
        (CoreState::Starting, _) => line("Starting…".into()),
        (CoreState::Failed(reason), _) => text(reason.clone()).font(k.ty.ui).color(k.c.danger.fg),
        (CoreState::Ready, Some(tab)) => line(tab.project.clone()),
        (CoreState::Ready, None) => line("No tabs".into()),
    };
    let body = col()
        .key("body")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .center()
        .gap(8.0)
        .fill(k.c.bg_base)
        .radius(PANEL_RADIUS)
        .border(1.0, k.c.border_muted)
        .child(status.key("status"))
        .children(s.error.clone().map(|e| text(e).key("error").font(k.ty.ui).color(k.c.danger.fg)));
    let main = col().key("main").w_full().grow(1.0).min_h(0.0).px(PANEL_INSET).pb(PANEL_INSET).child(body);
    rune_kit::root(col().key("window").w_full().h_full().fill(k.c.bg_deep).child(titlebar).child(main), layer)
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
        rt.update(move |s, tx| s.receive(Event::Message(message), tx));
        rt.frame(0.0);
        rt
    }

    fn texts(rt: &Runtime<Desk>) -> Vec<String> {
        rt.elements().into_iter().filter_map(|e| e.text).collect()
    }

    #[test]
    fn the_tab_bar_shows_each_tab_and_the_panel_its_project() {
        let rt = runtime(vec![tab("a", "Fix the login form"), tab("b", "New session")], "b");
        let texts = texts(&rt);
        for words in ["Fix the login form", "New session", "/code/b"] {
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
        assert_eq!(rt.state.core.sent().last().unwrap()["type"], "tabs.save");
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
