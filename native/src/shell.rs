//! The window: the tab bar, which doubles as the title bar, and the body under it.

use crate::core::Event;
use crate::protocol::{CoreMessage, TabInfo, ThemeChoice};
use crate::theme;
use rune::{Cx, El, Tx, col, text};
use rune_kit::shell::{TabDragState, TabItem, TabOrientation, TabStrip, WindowTitlebar};

/// The tab bar's height. The window's buttons sit centred in it.
pub const TITLEBAR_HEIGHT: f32 = 44.0;

#[derive(Debug, Default, PartialEq)]
pub enum CoreState {
    #[default]
    Starting,
    Ready,
    Failed(String),
}

#[derive(Default)]
pub struct Desk {
    pub core: CoreState,
    pub tabs: Vec<TabInfo>,
    pub active: Option<String>,
    pub theme: ThemeChoice,
    /// The last error the core reported for something the user asked.
    pub error: Option<String>,
    strip: TabDragState,
}

impl Desk {
    pub fn receive(&mut self, event: Event) {
        match event {
            Event::Ready => self.core = CoreState::Ready,
            Event::Failed(reason) => self.core = CoreState::Failed(reason),
            Event::Message(message) => self.read(message),
        }
    }

    fn read(&mut self, message: CoreMessage) {
        match message {
            CoreMessage::Settings { settings } => self.theme = settings.appearance.theme,
            CoreMessage::Tabs { tabs, active } => {
                self.active = active.filter(|id| tabs.iter().any(|t| &t.id == id)).or_else(|| tabs.first().map(|t| t.id.clone()));
                self.tabs = tabs;
            }
            CoreMessage::Error { message } => self.error = Some(message),
            CoreMessage::Other => {}
        }
    }

    /// Selects the tab at `index`, as ⌘1 to ⌘9 do. There is no tab past the last.
    pub fn select_index(&mut self, index: usize) {
        if let Some(tab) = self.tabs.get(index) {
            self.active = Some(tab.id.clone());
        }
    }

    fn active_tab(&self) -> Option<&TabInfo> {
        self.tabs.iter().find(|t| Some(&t.id) == self.active.as_ref())
    }

    fn dark(&self, cx: &Cx<Desk>) -> bool {
        match self.theme {
            ThemeChoice::Dark => true,
            ThemeChoice::Light => false,
            ThemeChoice::Auto => cx.system_dark(),
        }
    }
}

fn select(s: &mut Desk, id: &str, _: &mut Tx) {
    s.active = Some(id.to_owned());
}

pub fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    let k = theme::kit(s.dark(cx));
    let mut layer = Vec::new();
    let items = s.tabs.iter().map(|t| TabItem::new(t.id.as_str(), t.title.as_str()));
    let strip = TabStrip::new("tabs", TabOrientation::Horizontal)
        .tabs(items)
        .active(s.active.as_deref())
        .viewport_width(cx.layout_size("tabs").map(|size| size[0]))
        .drag_state(&s.strip, |s: &mut Desk| &mut s.strip)
        .on_select(select)
        .build_layered(k, &mut layer);
    let titlebar = WindowTitlebar::from_insets(cx.chrome_insets(), 1.0).tabs(strip).build(k);

    let line = |words: String| text(words).font(k.ty.ui).color(k.c.text_muted);
    let status = match (&s.core, s.active_tab()) {
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
        .child(status.key("status"))
        .children(s.error.clone().map(|e| text(e).key("error").font(k.ty.ui).color(k.c.danger.fg)));
    rune_kit::root(col().key("window").w_full().h_full().fill(k.c.bg_deep).child(titlebar).child(body), layer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::DeskSettings;

    fn tab(id: &str, title: &str) -> TabInfo {
        TabInfo { id: id.into(), title: title.into(), project: format!("/code/{id}") }
    }

    #[test]
    fn saved_tabs_keep_their_active_tab() {
        let mut desk = Desk::default();
        desk.receive(Event::Message(CoreMessage::Tabs { tabs: vec![tab("a", "A"), tab("b", "B")], active: Some("b".into()) }));
        assert_eq!(desk.active.as_deref(), Some("b"));
    }

    #[test]
    fn an_active_tab_that_is_gone_falls_back_to_the_first() {
        let mut desk = Desk::default();
        desk.receive(Event::Message(CoreMessage::Tabs { tabs: vec![tab("a", "A")], active: Some("gone".into()) }));
        assert_eq!(desk.active.as_deref(), Some("a"));
    }

    #[test]
    fn selecting_past_the_last_tab_changes_nothing() {
        let mut desk = Desk::default();
        desk.receive(Event::Message(CoreMessage::Tabs { tabs: vec![tab("a", "A"), tab("b", "B")], active: None }));
        desk.select_index(1);
        assert_eq!(desk.active.as_deref(), Some("b"));
        desk.select_index(8);
        assert_eq!(desk.active.as_deref(), Some("b"));
    }

    #[test]
    fn the_tab_bar_shows_each_tab_and_the_body_its_project() {
        use rune::{Env, Runtime};
        let mut desk = Desk { core: CoreState::Ready, ..Desk::default() };
        desk.receive(Event::Message(CoreMessage::Tabs { tabs: vec![tab("a", "Fix the login form"), tab("b", "New session")], active: Some("b".into()) }));
        let mut rt = Runtime::new(desk, view, (1280.0, 820.0), Env { system_dark: true, scale: 2.0 });
        rt.frame(0.0);
        let texts: Vec<String> = rt.elements().into_iter().filter_map(|e| e.text).collect();
        for words in ["Fix the login form", "New session", "/code/b"] {
            assert!(texts.iter().any(|t| t == words), "{words:?} shows in {texts:?}");
        }
    }

    #[test]
    fn settings_set_the_theme() {
        let mut desk = Desk::default();
        let settings: DeskSettings = serde_json::from_str(r#"{"appearance":{"theme":"auto"}}"#).unwrap();
        desk.receive(Event::Message(CoreMessage::Settings { settings }));
        assert_eq!(desk.theme, ThemeChoice::Auto);
    }
}
