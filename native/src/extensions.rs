//! The session header's MCP servers and skills, after OpenCode's session details: a button beside the
//! context ring opens a menu with a row for each list, and a row opens its list beside the menu. It shows
//! what the tab's agent loads in the project, for an agent that has `mcp`.
//!
//! The list is a `PopupList`, not the menu's own submenu: Rune does not fit a surface beside its anchor
//! to the window, and a submenu takes no height limit, so a long list would run off the window.

use crate::protocol::{ClientMessage, McpServer, Skill, TabInfo};
use crate::shell::Comet;
use rune::{Align, El, Side, el, icon};
use rune_kit::{ControlSize, IconButton, IconButtonVariant, Kit, Menu, MenuItem, Placement, PopupItem, PopupList, State, Switch};
use rune_theme_opencode::icons as ic;

const LABEL: &str = "MCP servers and skills";
const MENU: &str = "extensions";
/// The width of OpenCode's details card and of its lists.
const WIDTH: f32 = 280.0;
/// How tall a list grows before it scrolls, as OpenCode's.
const LIST_HEIGHT: f32 = 480.0;

/// The list a row opens beside the menu.
#[derive(Clone, Copy, PartialEq)]
pub enum List {
    Mcp,
    Skills,
}

impl List {
    /// The menu row the list opens beside. rune-kit keys a menu's entries by the menu and their place,
    /// and the agent's name comes first.
    fn row_key(self) -> String {
        format!("{MENU}-item{}", if self == List::Mcp { 1 } else { 2 })
    }
}

/// The tab whose menu is open, the list open beside it, and the list's row under the pointer.
#[derive(Default)]
pub struct Extensions {
    open: Option<String>,
    list: Option<List>,
    active: Option<usize>,
}

impl Comet {
    /// Opens the menu for a tab, reading its agent's servers again, since they connect and fail over
    /// time. Skills are read once per project, as the composer reads them.
    pub fn open_extensions(&mut self, tab: &TabInfo) {
        self.extensions = Extensions { open: Some(tab.id.clone()), ..Extensions::default() };
        self.core.send(&ClientMessage::McpGet { project: tab.project.clone(), agent: tab.agent.clone() });
        if self.projects.get(&tab.project).is_none_or(|p| p.skills.is_none()) {
            self.core.send(&ClientMessage::ProjectGet { project: tab.project.clone(), part: "skills".into() });
        }
    }

    /// Opens a list beside the menu, or closes it when it is open.
    pub fn show_extensions_list(&mut self, list: List) {
        self.extensions.list = if self.extensions.list == Some(list) { None } else { Some(list) };
        self.extensions.active = None;
    }

    fn close_extensions(&mut self) {
        self.extensions = Extensions::default();
    }
}

/// The header button, and its menu while open. None for an agent without `mcp`.
pub fn button(s: &Comet, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> Option<El> {
    if !s.account.can(&tab.agent, "mcp") {
        return None;
    }
    let open = s.extensions.open.as_deref() == Some(tab.id.as_str());
    let opened = tab.clone();
    let trigger = IconButton::new(&ic::WINDOW_ANALYTICS)
        .variant(IconButtonVariant::GhostMuted)
        .control_size(ControlSize::Large)
        .label(LABEL)
        .help(LABEL)
        .on_press(move |s: &mut Comet| if s.extensions.open.is_some() { s.close_extensions() } else { s.open_extensions(&opened) })
        .build(k);
    let project = s.projects.get(&tab.project);
    let servers = project.and_then(|p| p.mcp.get(&tab.agent));
    let skills = project.and_then(|p| p.skills.as_ref().map(|_| p.skills_of(&tab.agent)));
    let shown = s.extensions.list;
    let menu = Menu::new(MENU)
        .trigger(trigger)
        .open(open)
        .placement(Placement::BottomEnd)
        .min_width(WIDTH)
        .group_label(s.agent_name(&tab.agent))
        .item(list_row("MCP servers", &ic::MCP, servers.and_then(|x| x.as_ref().map(Vec::len)), List::Mcp, shown))
        .item(list_row("Skills", &ic::GRADUATION_CAP, skills.flatten().map(|x| skills_of(x).count()), List::Skills, shown))
        .on_close(|s: &mut Comet| s.close_extensions())
        .build(k, layer);
    if let (true, Some(list)) = (open, shown) {
        let popup = PopupList::new(format!("{MENU}-list"), list.row_key())
            .side(Side::Left)
            .align(Align::Start)
            .gutter(4.0)
            .width(WIDTH)
            .max_height(LIST_HEIGHT)
            .padding(2.0)
            .active(s.extensions.active)
            .on_active(|s: &mut Comet, i| s.extensions.active = Some(i));
        match list {
            List::Mcp => mcp_list(popup, s, tab, servers, k),
            List::Skills => skill_list(popup, s, tab, skills, k),
        }
        .build(k, layer);
    }
    Some(menu)
}

/// A row of the menu, with how many its list holds once read. It stays lit while its list is open.
fn list_row(label: &str, mark: &'static rune::Icon, count: Option<usize>, list: List, shown: Option<List>) -> MenuItem {
    // A closed submenu draws the menu's chevron, which says the row leads to a list.
    let row = MenuItem::new(label).icon(mark).submenu(Vec::new(), false).on_select(move |s: &mut Comet| s.show_extensions_list(list));
    let row = if shown == Some(list) { row.state(State::Hover) } else { row };
    match count {
        Some(n) => row.badge(n.to_string()),
        None => row,
    }
}

/// Each server: its dot, its name, why it is not connected, and a switch for a server Comet can turn on or off.
fn mcp_list(popup: PopupList<Comet>, s: &Comet, tab: &TabInfo, read: Option<&Option<Vec<McpServer>>>, k: &Kit) -> PopupList<Comet> {
    match read {
        None => popup.empty_message("Starting the servers…"),
        Some(None) => popup.empty_message(format!("{} could not be asked", s.agent_name(&tab.agent))),
        Some(Some(list)) => popup.empty_message("No MCP servers").items(ordered(list, |x| x.own_project).map(|server| server_item(tab, server, k)).collect::<Vec<_>>()),
    }
}

fn server_item(tab: &TabInfo, server: &McpServer, k: &Kit) -> PopupItem {
    let why = match server.status.as_str() {
        "failed" => server.error.clone().unwrap_or_else(|| "Failed".into()),
        "needs-auth" => "Needs sign-in".into(),
        "not-started" => "Starts with a thread".into(),
        _ => String::new(),
    };
    let item = PopupItem::new(server.name.clone(), server.name.clone()).leading(dot(server, k)).description(why);
    if !server.toggleable {
        return item;
    }
    let enabled = server.status != "disabled";
    let (project, agent, name) = (tab.project.clone(), tab.agent.clone(), server.name.clone());
    let switch = Switch::new(enabled)
        .web()
        .label(format!("Use {}", server.name))
        .hide_label()
        .on_toggle(move |s: &mut Comet| s.core.send(&ClientMessage::McpToggle { project: project.clone(), agent: agent.clone(), name: name.clone(), enabled: !enabled }))
        .build(k);
    item.trailing(switch)
}

/// OpenCode's 6 point status dot, in a 16 point box. A server that is off shows a ring.
fn dot(server: &McpServer, k: &Kit) -> El {
    let dot = el().size(6.0, 6.0).radius(3.0);
    let dot = match server.status.as_str() {
        "connected" => dot.fill(k.c.success.fg),
        "failed" => dot.fill(k.c.danger.fg),
        "needs-auth" => dot.fill(k.c.warning.fg),
        "disabled" => dot.border(1.0, k.c.text_faint),
        _ => dot.fill(k.c.text_faint),
    };
    el().size(16.0, 16.0).center().child(dot)
}

/// The agent's skills, without its own commands such as /compact.
fn skills_of(list: &[Skill]) -> impl Iterator<Item = &Skill> {
    list.iter().filter(|x| !x.builtin)
}

/// Each skill: a file's mark and its name. A skill opens its file in the view pane, when Comet knows the file.
fn skill_list(popup: PopupList<Comet>, s: &Comet, tab: &TabInfo, read: Option<Option<&[Skill]>>, k: &Kit) -> PopupList<Comet> {
    let list = match read {
        None => return popup.empty_message("Reading skills…"),
        Some(None) => return popup.empty_message(format!("{} could not be asked", s.agent_name(&tab.agent))),
        Some(Some(list)) => list,
    };
    let skills: Vec<&Skill> = ordered(skills_of(list), |x| x.own_project).collect();
    let items: Vec<PopupItem> = skills.iter().map(|skill| PopupItem::new(skill.name.clone(), skill.name.clone()).leading(icon(&ic::FILE_DOCUMENT, 14.0).color(k.c.icon_base))).collect();
    let paths: Vec<(String, String)> = skills.iter().filter_map(|skill| Some((skill.name.clone(), skill.path.clone()?))).collect();
    let tab = tab.id.clone();
    popup.empty_message("No skills").items(items).on_choose(move |s: &mut Comet, name, _| {
        if let Some((_, path)) = paths.iter().find(|(n, _)| n == name) {
            s.close_extensions();
            s.open_file(&tab, path, None);
        }
    })
}

/// The project's own first, each part in the order the core gave.
fn ordered<'a, T: 'a>(items: impl IntoIterator<Item = &'a T>, own: fn(&T) -> bool) -> impl Iterator<Item = &'a T> {
    let (mine, shared): (Vec<&T>, Vec<&T>) = items.into_iter().partition(|x| own(x));
    mine.into_iter().chain(shared)
}

#[cfg(test)]
mod tests {
    use super::List;
    use crate::core::Event;
    use crate::protocol::CoreMessage;
    use crate::shell::Comet;

    fn comet(agent: &str) -> Comet {
        let mut s = Comet::default();
        let messages = serde_json::json!([
            { "type": "agents", "agents": [
                { "id": "claude", "name": "Claude Code", "state": "ready", "features": ["mcp", "slash-commands"], "models": [] },
                { "id": "antigravity", "name": "Antigravity", "state": "ready", "features": [], "models": [] }
            ] },
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "Fix login", "project": "/code/web", "terminals": [], "agent": agent, "model": "default", "permissionMode": "auto" }] }
        ]);
        for m in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(m)).unwrap();
        }
        let _ = s.core.sent();
        s
    }

    #[test]
    fn opening_reads_the_tab_agents_servers_each_time_and_its_skills_once() {
        let mut s = comet("claude");
        let tab = s.workspace.active_tab().unwrap().clone();
        s.open_extensions(&tab);
        let sent = s.core.sent();
        assert!(sent.iter().any(|m| m["type"] == "mcp.get" && m["agent"] == "claude" && m["project"] == "/code/web"));
        assert!(sent.iter().any(|m| m["type"] == "project.get" && m["part"] == "skills"));
        let skills = serde_json::json!({ "type": "project", "project": "/code/web", "part": "skills", "value": { "claude": [] } });
        s.receive(Event::Message(serde_json::from_value(skills).unwrap())).unwrap();
        s.open_extensions(&tab);
        let sent = s.core.sent();
        assert!(sent.iter().any(|m| m["type"] == "mcp.get"));
        assert!(!sent.iter().any(|m| m["type"] == "project.get"));
    }

    #[test]
    fn a_row_opens_its_list_and_again_closes_it() {
        let mut s = comet("claude");
        let tab = s.workspace.active_tab().unwrap().clone();
        s.open_extensions(&tab);
        s.show_extensions_list(List::Skills);
        assert!(s.extensions.list == Some(List::Skills));
        s.show_extensions_list(List::Mcp);
        assert!(s.extensions.list == Some(List::Mcp));
        s.show_extensions_list(List::Mcp);
        assert!(s.extensions.list.is_none());
    }

    #[test]
    fn keeps_each_agents_servers_apart() {
        let mut s = comet("claude");
        let servers = serde_json::json!({ "type": "mcp", "project": "/code/web", "agent": "codex", "servers": [{ "name": "github", "status": "connected", "ownProject": false, "tools": 3, "toggleable": true }] });
        s.receive(Event::Message(serde_json::from_value(servers).unwrap())).unwrap();
        let project = s.projects.get("/code/web").unwrap();
        assert_eq!(project.mcp["codex"].as_ref().unwrap()[0].name, "github");
        assert!(!project.mcp.contains_key("claude"));
    }

    #[test]
    fn shows_only_for_an_agent_that_lists_its_servers() {
        let k = crate::theme::kit(true);
        for (agent, shown) in [("claude", true), ("antigravity", false)] {
            let s = comet(agent);
            let tab = s.workspace.active_tab().unwrap().clone();
            assert_eq!(super::button(&s, &tab, k, &mut Vec::new()).is_some(), shown, "{agent}");
        }
    }
}
