//! The view pane's new button: a press opens a terminal, and its arrow opens a menu of what else the pane
//! can open, the plugin panels that need no parameters. A split button keeps a new terminal one press away.

use crate::protocol::{ClientMessage, TabInfo};
use crate::shell::Comet;
use rune::{El, row};
use rune_kit::{ControlSize, IconButton, IconButtonVariant, Kit, Menu, MenuItem, Placement};
use rune_theme_opencode::icons as ic;

#[derive(Default)]
pub struct NewMenu {
    /// Whether the active tab's menu is open.
    open: bool,
}

impl Comet {
    /// Opens or closes the menu. Reading what the plugins offer starts them, so it waits for the menu, as the palette does.
    fn toggle_new_menu(&mut self) {
        self.new_menu.open = !self.new_menu.open;
        if let Some(project) = self.new_menu.open.then(|| self.workspace.active_tab().map(|t| t.project.clone())).flatten() {
            self.core.send(&ClientMessage::ProjectGet { project, part: "plugins".into() });
        }
    }
}

/// The new terminal button and its menu's arrow, with the menu in `layer`.
pub fn button(s: &Comet, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let new_terminal = IconButton::new(&ic::PLUS).variant(IconButtonVariant::GhostMuted).control_size(ControlSize::Large).label("New terminal").help("New terminal").on_press(|s: &mut Comet| s.new_terminal()).build(k);
    let arrow = IconButton::new(&ic::CHEVRON_DOWN).variant(IconButtonVariant::GhostMuted).control_size(ControlSize::Small).label("Open in the pane").help("Open in the pane").on_press(|s: &mut Comet| s.toggle_new_menu()).build(k);
    let mut menu = Menu::new("new-menu").trigger(arrow).open(s.new_menu.open).placement(Placement::BottomEnd).min_width(200.0).on_close(|s: &mut Comet| s.new_menu.open = false);
    menu = menu.item(MenuItem::new("New terminal").icon(&ic::TERMINAL).on_select(|s: &mut Comet| {
        s.new_menu.open = false;
        s.new_terminal();
    }));
    let panels = s.projects.get(&tab.project).and_then(|p| p.plugins.as_ref()).map_or(&[][..], |o| o.panels.as_slice());
    if !panels.is_empty() {
        menu = menu.separator();
    }
    for panel in panels {
        let (tab_id, id) = (tab.id.clone(), panel.id.clone());
        menu = menu.item(MenuItem::new(panel.title.clone()).icon(&crate::icons::PANEL).on_select(move |s: &mut Comet| {
            s.new_menu.open = false;
            s.core.send(&ClientMessage::PanelOpen { tab_id: tab_id.clone(), panel: id.clone() });
        }));
    }
    row().key("new-button").items_center().child(new_terminal).child(menu.build(k, layer))
}

#[cfg(test)]
mod tests {
    use crate::core::Event;
    use crate::protocol::CoreMessage;
    use crate::shell::Comet;

    fn comet() -> Comet {
        let mut s = Comet::default();
        let messages = serde_json::json!([
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "Guide", "project": "/code/web", "terminals": [], "agent": "claude", "model": "default", "permissionMode": "auto" }] }
        ]);
        for m in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(m)).unwrap();
        }
        let _ = s.core.sent();
        s
    }

    #[test]
    fn opening_the_menu_reads_what_the_projects_plugins_offer_and_closing_it_reads_nothing() {
        let mut s = comet();
        s.toggle_new_menu();
        assert!(s.new_menu.open);
        let sent = s.core.sent();
        assert!(sent.iter().any(|m| m["type"] == "project.get" && m["project"] == "/code/web" && m["part"] == "plugins"), "{sent:?}");
        s.toggle_new_menu();
        assert!(!s.new_menu.open);
        assert!(s.core.sent().is_empty());
    }

    #[test]
    fn the_button_draws_with_and_without_panels_on_offer() {
        let mut s = comet();
        let tab = s.workspace.tabs[0].clone();
        let k = crate::theme::kit(true);
        let _ = super::button(&s, &tab, k, &mut Vec::new());
        let offers = serde_json::json!({ "type": "project", "project": "/code/web", "part": "plugins", "value": { "panels": [{ "id": "reviews.branch", "title": "Branch guide" }], "setups": [], "commands": [] } });
        s.receive(Event::Message(serde_json::from_value(offers).unwrap())).unwrap();
        assert_eq!(s.projects.get("/code/web").and_then(|p| p.plugins.as_ref()).map(|o| o.panels.len()), Some(1));
        s.toggle_new_menu();
        let mut layer = Vec::new();
        let _ = super::button(&s, &tab, k, &mut layer);
        assert!(!layer.is_empty(), "the open menu draws in the layer");
    }
}
