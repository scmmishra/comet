//! Worktrees, after T3 Code. A new tab picks the checkout its thread starts in from the start screen: the
//! repo's main checkout, a worktree that exists, or a new worktree, which the core makes when the first
//! message goes out. A tab in a worktree shows it on the Space card, which can remove it. The core also
//! moves a tab whose agent moved its thread into a worktree.

use crate::format;
use crate::protocol::{ClientMessage, ImageAttachment, Space, TabInfo};
use crate::shell::Desk;
use rune::{El, icon, row, text};
use rune_kit::{ButtonVariant, ControlSize, Dialog, IconButton, IconButtonVariant, Kit, Menu, MenuItem, Placement};
use rune_theme_opencode::icons as ic;
use std::collections::{HashMap, HashSet};

/// What a tab's first message makes a worktree from, when no message says.
const UNNAMED: &str = "worktree";

#[derive(Default)]
pub struct Worktrees {
    /// Tabs whose first message makes a new worktree, as the checkout menu chose.
    new_for: HashSet<String>,
    /// First messages waiting for their tab's new worktree, by tab.
    waiting: HashMap<String, (String, Vec<ImageAttachment>)>,
    /// Whether the start screen's checkout menu is open.
    menu: bool,
    /// The tab whose worktree waits for the user to confirm its removal.
    removing: Option<String>,
}

impl Desk {
    /// Whether a tab's first message makes a new worktree before it goes out.
    pub fn makes_worktree(&self, tab: &str) -> bool {
        self.worktrees.new_for.contains(tab)
    }

    /// Asks the core for the tab's new worktree, named from its first message, which waits for it.
    pub fn create_worktree(&mut self, tab: &str, text: String, images: Vec<ImageAttachment>) {
        let Some(project) = self.workspace.tabs.iter().find(|t| t.id == tab).map(|t| t.project.clone()) else { return };
        self.worktrees.new_for.remove(tab);
        let name = if text.is_empty() { UNNAMED.to_owned() } else { text.clone() };
        self.core.send(&ClientMessage::WorktreeCreate { tab_id: tab.to_owned(), project, name });
        self.worktrees.waiting.insert(tab.to_owned(), (text, images));
    }

    /// The core made a tab's worktree. The tab moves there, and its first message goes out.
    pub fn worktree_created(&mut self, tab: &str, project: String) {
        self.move_tab(tab, project);
        let Some((text, images)) = self.worktrees.waiting.remove(tab) else { return };
        self.threads.new_turn(tab);
        self.core.send(&ClientMessage::SessionSend { tab_id: tab.to_owned(), text, images, follow_up: None });
    }

    /// Moves a tab into another checkout of its repo, as the core or the checkout menu asked, and reads what it shows there.
    pub fn move_tab(&mut self, tab: &str, project: String) {
        self.workspace.change_tab(tab, |t| t.project = project, &self.core);
        if self.workspace.active.as_deref() == Some(tab) {
            self.read_start();
        }
    }

    /// Something failed, and the core does not say what. A first message that waits for its worktree goes
    /// back into its composer, and the tab makes a worktree again on the next send.
    pub fn worktree_failed(&mut self) {
        for (tab, (text, images)) in std::mem::take(&mut self.worktrees.waiting) {
            self.drafts.restore(&tab, text, images);
            self.worktrees.new_for.insert(tab);
        }
    }

    /// Picks the checkout a tab's thread starts in: a folder in a checkout that exists, or None for a new worktree.
    pub fn pick_checkout(&mut self, tab: &str, project: Option<String>) {
        self.worktrees.menu = false;
        match project {
            Some(project) => {
                self.worktrees.new_for.remove(tab);
                self.move_tab(tab, project);
            }
            None => {
                self.worktrees.new_for.insert(tab.to_owned());
            }
        }
    }

    fn remove_worktree(&mut self) {
        if let Some(tab) = self.worktrees.removing.take() {
            self.core.send(&ClientMessage::WorktreeRemove { tab_id: tab });
        }
    }
}

/// The start screen's checkout menu, beside the project: the checkout the tab's thread starts in. A folder
/// outside a Git repo has none.
pub fn checkout_menu(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> Option<El> {
    let project = s.projects.get(&tab.project)?;
    let space = project.space.as_ref()?;
    let (mark, words) = if s.worktrees.waiting.contains_key(&tab.id) {
        (&ic::OUTLINE_WORKTREE, "Creating worktree…".to_owned())
    } else if s.makes_worktree(&tab.id) {
        (&ic::OUTLINE_WORKTREE, format!("New worktree from {}", space.branch))
    } else if space.worktree.is_some() {
        (&ic::OUTLINE_WORKTREE, space.branch.clone())
    } else {
        (&ic::BRANCH, space.branch.clone())
    };
    let trigger = row()
        .key("checkout-menu")
        .h(32.0)
        .gap(6.0)
        .items_center()
        .px(6.0)
        .radius(8.0)
        .hover(k.c.hover)
        .role("button")
        .on_press(|s: &mut Desk| s.worktrees.menu = !s.worktrees.menu)
        .child(icon(mark, 15.0).color(k.c.text_muted))
        .child(text(words).font(crate::theme::text(13.0)).color(k.c.text_muted))
        .child(icon(&ic::CHEVRON_DOWN, crate::icons::SIZE).color(k.c.text_faint));
    let mut menu = Menu::new("checkout-list")
        .trigger(trigger)
        .open(s.worktrees.menu)
        .placement(Placement::BottomStart)
        .gutter(8.0)
        .min_width(280.0)
        .group_label("Checkouts")
        .on_close(|s: &mut Desk| s.worktrees.menu = false);
    let new = s.makes_worktree(&tab.id);
    // Before the list is read, the menu offers the tab's own checkout.
    let listed = project.worktrees.clone().unwrap_or_default();
    for worktree in listed {
        let name = if worktree.main { "Local".to_owned() } else { format::project_name(&worktree.path).to_owned() };
        let label = match &worktree.branch {
            Some(branch) => format!("{name} · {branch}"),
            None => name,
        };
        let mark = if worktree.main { &ic::BRANCH } else { &ic::OUTLINE_WORKTREE };
        let (id, path) = (tab.id.clone(), worktree.path.clone());
        menu = menu.item(MenuItem::new(label).lead(icon(mark, 15.0).color(k.c.text_muted)).checked(!new && worktree.path == tab.project).on_select(move |s: &mut Desk| s.pick_checkout(&id, Some(path.clone()))));
    }
    let id = tab.id.clone();
    Some(menu.separator().item(MenuItem::new(format!("New worktree from {}", space.branch)).lead(icon(&ic::OUTLINE_WORKTREE, 15.0).color(k.c.text_muted)).checked(new).on_select(move |s: &mut Desk| s.pick_checkout(&id, None))).build(k, layer))
}

/// The Space card's line for a worktree: its folder's name, the checkout it came from, and a button that removes it.
pub fn space_line(space: &Space, tab: &str, k: &Kit) -> Option<El> {
    let main = space.worktree.as_ref()?;
    let id = tab.to_owned();
    let remove = IconButton::new(&ic::TRASH)
        .variant(IconButtonVariant::GhostMuted)
        .control_size(ControlSize::Small)
        .label("Remove worktree")
        .on_press(move |s: &mut Desk| s.worktrees.removing = Some(id.clone()))
        .build(k)
        .key("remove-worktree");
    Some(
        row()
            .w_full()
            .gap(10.0)
            .items_center()
            .px(8.0)
            .py(4.0)
            .child(icon(&ic::OUTLINE_WORKTREE, 15.0).color(k.c.text_muted))
            .child(text(format::project_name(&space.root).to_owned()).font(crate::theme::text(13.0)).color(k.c.text_base).truncate().grow(1.0))
            .child(text(format!("from {}", format::project_name(&main.main))).font(crate::theme::text(13.0)).color(k.c.text_faint))
            .child(remove),
    )
}

/// The confirmation before a tab's worktree goes, with what is uncommitted in it.
pub fn remove_dialog(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) {
    if s.worktrees.removing.as_deref() != Some(tab.id.as_str()) {
        return;
    }
    let Some(space) = s.projects.get(&tab.project).and_then(|p| p.space.as_ref()) else { return };
    let mut words = format!("Desk deletes {} and closes this tab. The branch {} stays.", format::short_path(&space.root), space.branch);
    if space.changes.files > 0 {
        let files = if space.changes.files == 1 { "file".to_owned() } else { "files".to_owned() };
        words.push_str(&format!(" The {} uncommitted {files} in it will be lost.", space.changes.files));
    }
    let footer = row()
        .w_full()
        .gap(8.0)
        .child(row().grow(1.0))
        .child(crate::theme::button("Cancel").variant(ButtonVariant::Ghost).on_press(|s: &mut Desk| s.worktrees.removing = None).build(k))
        .child(crate::theme::button("Remove worktree").variant(ButtonVariant::Danger).on_press(|s: &mut Desk| s.remove_worktree()).build(k));
    Dialog::new("remove-worktree", "Remove this worktree?")
        .open(true)
        .fit()
        .on_close(|s: &mut Desk| s.worktrees.removing = None)
        .child(rune::col().w_full().gap(16.0).px(16.0).pb(16.0).child(text(words).font(crate::theme::text(13.0)).color(k.c.text_muted).wrap()).child(footer))
        .build(k, layer);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::Event;
    use crate::protocol::CoreMessage;

    /// Two tabs in a repo's main checkout, the first one active.
    fn desk() -> Desk {
        let mut s = Desk::default();
        let tab = |id: &str| serde_json::json!({ "id": id, "title": "New session", "project": "/code/web", "terminals": [], "agent": "claude", "model": "default", "permissionMode": "auto" });
        let messages = serde_json::json!([{ "type": "tabs", "active": "t", "tabs": [tab("t"), tab("u")] }]);
        for message in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(message)).unwrap();
        }
        let _ = s.core.sent();
        s
    }

    fn project(s: &Desk, tab: &str) -> String {
        s.workspace.tabs.iter().find(|t| t.id == tab).unwrap().project.clone()
    }

    #[test]
    fn a_new_worktree_is_made_before_the_first_message_goes_out_there() {
        let mut s = desk();
        s.pick_checkout("t", None);
        assert!(s.makes_worktree("t"));
        s.create_worktree("t", "Add tests".into(), vec![]);
        let sent = s.core.sent();
        assert_eq!(sent.iter().map(|m| m["type"].as_str().unwrap()).collect::<Vec<_>>(), ["worktree.create"]);
        assert_eq!(sent[0], serde_json::json!({ "type": "worktree.create", "tabId": "t", "project": "/code/web", "name": "Add tests" }));
        assert!(!s.makes_worktree("t"), "the next message goes out as usual");
        s.receive(Event::Message(CoreMessage::WorktreeCreated { tab_id: "t".into(), project: "/w/add-tests".into() })).unwrap();
        assert_eq!(project(&s, "t"), "/w/add-tests");
        let sent = s.core.sent();
        // The tab moves before its message goes out, so the core runs the thread in the worktree.
        let saved = sent.iter().position(|m| m["type"] == "tabs.save").unwrap();
        let message = sent.iter().position(|m| m["type"] == "session.send").unwrap();
        assert!(saved < message);
        assert_eq!(sent[message]["text"], "Add tests");
    }

    #[test]
    fn a_worktree_that_could_not_be_made_gives_the_message_back() {
        let mut s = desk();
        s.pick_checkout("t", None);
        s.create_worktree("t", "Add tests".into(), vec![]);
        s.receive(Event::Message(CoreMessage::Error { message: "Desk could not make the worktree".into(), detail: None })).unwrap();
        assert!(s.drafts.has_content("t"));
        assert!(s.makes_worktree("t"), "sending again makes the worktree again");
        assert_eq!(project(&s, "t"), "/code/web");
    }

    #[test]
    fn a_tab_follows_its_thread_and_picks_a_checkout_that_exists() {
        let mut s = desk();
        s.pick_checkout("t", None);
        s.pick_checkout("t", Some("/w/side".into()));
        assert!(!s.makes_worktree("t"));
        assert_eq!(project(&s, "t"), "/w/side");
        s.receive(Event::Message(CoreMessage::TabMoved { tab_id: "u".into(), project: "/w/other".into() })).unwrap();
        assert_eq!(project(&s, "u"), "/w/other");
    }

    #[test]
    fn a_removed_worktree_closes_its_tab_once_confirmed() {
        let mut s = desk();
        s.worktrees.removing = Some("t".into());
        s.remove_worktree();
        assert_eq!(s.core.sent(), [serde_json::json!({ "type": "worktree.remove", "tabId": "t" })]);
        s.receive(Event::Message(CoreMessage::WorktreeRemoved { tab_id: "t".into() })).unwrap();
        assert_eq!(s.workspace.tabs.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["u"]);
    }
}
