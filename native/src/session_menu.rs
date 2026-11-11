//! The menu beside a session's title: rename the session, fork it, copy its id or delete it. Rename and
//! Delete ask in a dialog first. Each action needs a session, so the menu shows once the thread has started.

use crate::protocol::{ClientMessage, TabInfo};
use crate::shell::Desk;
use crate::workspace::Place;
use rune::{El, TextEdit, col, row, text};
use rune_kit::{ButtonVariant, ControlSize, Dialog, IconButton, IconButtonVariant, Kit, Menu, MenuItem, Placement, TextInput};
use rune_theme_opencode::icons as ic;

#[derive(Default)]
pub struct SessionMenu {
    /// Whether the active tab's menu is open.
    open: bool,
    /// The tab being renamed, and the name typed so far.
    renaming: Option<(String, TextEdit)>,
    /// The tab whose session waits for the user to confirm its deletion.
    deleting: Option<String>,
}

/// The menu's button, with its menu and dialogs in `layer`. None until the tab's session has started.
pub fn button(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> Option<El> {
    let session = s.threads.get(&tab.id)?.session_id.clone()?;
    let trigger = IconButton::new(&ic::OUTLINE_DOTS)
        .variant(IconButtonVariant::GhostMuted)
        .control_size(ControlSize::Regular)
        .label("Session actions")
        .on_press(|s: &mut Desk| s.session_menu.open = !s.session_menu.open)
        .build(k);
    let (rename, fork, delete) = (tab.clone(), tab.id.clone(), tab.id.clone());
    let menu = Menu::new("session-menu")
        .trigger(trigger)
        .open(s.session_menu.open)
        .placement(Placement::BottomStart)
        .min_width(200.0)
        .on_close(|s: &mut Desk| s.session_menu.open = false)
        .item(MenuItem::new("Rename").icon(&ic::EDIT).on_select(move |s: &mut Desk| {
            s.session_menu.open = false;
            s.session_menu.renaming = Some((rename.id.clone(), TextEdit::new(rename.title.clone())));
        }))
        .item(MenuItem::new("Fork").icon(&ic::FORK).on_select(move |s: &mut Desk| {
            s.session_menu.open = false;
            s.core.send(&ClientMessage::ThreadFork { tab_id: fork.clone() });
        }))
        .item(MenuItem::new("Copy session ID").icon(&ic::COPY).on_select_tx(move |s: &mut Desk, tx| {
            s.session_menu.open = false;
            tx.copy(session.clone());
            s.toasts.show("Copied the session ID.", false);
        }))
        .separator()
        .item(MenuItem::new("Delete").icon(&ic::TRASH).danger(true).on_select(move |s: &mut Desk| {
            s.session_menu.open = false;
            s.session_menu.deleting = Some(delete.clone());
        }))
        .build(k, layer);
    rename_dialog(s, tab, k, layer);
    delete_dialog(s, tab, k, layer);
    Some(menu)
}

fn rename_dialog(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) {
    let Some((_, edit)) = s.session_menu.renaming.as_ref().filter(|(id, _)| *id == tab.id) else { return };
    let input = TextInput::new(edit)
        .label("Name")
        .width(None)
        .on_edit(|s: &mut Desk| &mut s.session_menu.renaming.as_mut().expect("the rename dialog is open").1)
        .on_submit(|s: &mut Desk, _| s.rename_session())
        .build(k);
    let footer = row()
        .w_full()
        .gap(8.0)
        .child(row().grow(1.0))
        .child(crate::theme::button("Cancel").variant(ButtonVariant::Ghost).on_press(|s: &mut Desk| s.session_menu.renaming = None).build(k))
        .child(crate::theme::button("Rename").variant(ButtonVariant::Submit).disabled(edit.text.trim().is_empty()).on_press(|s: &mut Desk| s.rename_session()).build(k));
    Dialog::new("rename-session", "Rename session")
        .open(true)
        .fit()
        .on_close(|s: &mut Desk| s.session_menu.renaming = None)
        .child(col().w_full().gap(12.0).px(16.0).pb(16.0).child(input).child(footer))
        .build(k, layer);
}

fn delete_dialog(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) {
    if s.session_menu.deleting.as_deref() != Some(tab.id.as_str()) {
        return;
    }
    let footer = row()
        .w_full()
        .gap(8.0)
        .child(row().grow(1.0))
        .child(crate::theme::button("Cancel").variant(ButtonVariant::Ghost).on_press(|s: &mut Desk| s.session_menu.deleting = None).build(k))
        .child(crate::theme::button("Delete").variant(ButtonVariant::Danger).on_press(|s: &mut Desk| s.delete_session()).build(k));
    // The dialog's description keeps to one line and runs past the panel, so the warning sits in the body, where it wraps.
    let warning = text(format!("“{}” and its transcript are deleted from this Mac. If Claude is working, it stops. This cannot be undone.", tab.title))
        .font(crate::theme::text(13.0))
        .color(k.c.text_muted)
        .wrap();
    Dialog::new("delete-session", "Delete session?")
        .open(true)
        .fit()
        .on_close(|s: &mut Desk| s.session_menu.deleting = None)
        .child(col().w_full().gap(16.0).px(16.0).pb(16.0).child(warning).child(footer))
        .build(k, layer);
}

impl Desk {
    /// Names the session as typed. An empty name keeps the dialog open.
    fn rename_session(&mut self) {
        let Some((tab, edit)) = self.session_menu.renaming.as_ref() else { return };
        let title = edit.text.trim().to_owned();
        if title.is_empty() {
            return;
        }
        self.core.send(&ClientMessage::ThreadRename { tab_id: tab.clone(), title });
        self.session_menu.renaming = None;
    }

    /// Deletes the session the user confirmed. The tab starts afresh, so it takes a new tab's name until its next message.
    fn delete_session(&mut self) {
        let Some(tab) = self.session_menu.deleting.take() else { return };
        self.core.send(&ClientMessage::ThreadDelete { tab_id: tab.clone() });
        self.workspace.change_tab(&tab, |t| t.title = crate::workspace::NEW_TAB_TITLE.into(), &self.core);
        if let Some(project) = self.workspace.tabs.iter().find(|t| t.id == tab).map(|t| t.project.clone()) {
            self.core.send(&ClientMessage::ProjectGet { project, part: "threads".into() });
        }
    }

    /// Opens a forked session in a new tab beside the one it came from.
    pub fn open_fork(&mut self, from: &str, thread: String, title: &str) {
        let Some(project) = self.workspace.tabs.iter().find(|t| t.id == from).map(|t| t.project.clone()) else { return };
        let Ok(tab) = self.workspace.new_tab(Place::Next, Some(project.clone()), &self.account, &self.core) else { return };
        self.workspace.name_tab(&tab, title, &self.core);
        self.core.send(&ClientMessage::ThreadResume { tab_id: tab, thread_id: thread });
        self.core.send(&ClientMessage::ProjectGet { project, part: "threads".into() });
    }
}

#[cfg(test)]
mod tests {
    use crate::core::Event;
    use crate::protocol::CoreMessage;
    use crate::shell::Desk;

    fn desk() -> Desk {
        let mut s = Desk::default();
        let messages = serde_json::json!([
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "Fix the login form", "project": "/code/web", "terminals": [], "model": "default", "permissionMode": "auto" }] }
        ]);
        for m in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(m)).unwrap();
        }
        let _ = s.core.sent();
        s
    }

    fn session(s: &mut Desk, id: Option<&str>) {
        let message = serde_json::json!({ "type": "thread.session", "tabId": "t", "sessionId": id });
        s.receive(Event::Message(serde_json::from_value(message).unwrap())).unwrap();
    }

    #[test]
    fn the_menu_shows_once_the_session_has_started_and_leaves_with_it() {
        let mut s = desk();
        let tab = s.workspace.tabs[0].clone();
        let k = crate::theme::kit(true);
        assert!(super::button(&s, &tab, k, &mut Vec::new()).is_none());
        session(&mut s, Some("s1"));
        assert!(super::button(&s, &tab, k, &mut Vec::new()).is_some());
        session(&mut s, None);
        assert!(super::button(&s, &tab, k, &mut Vec::new()).is_none());
    }

    #[test]
    fn a_rename_sends_the_trimmed_name_and_an_empty_one_waits() {
        let mut s = desk();
        s.session_menu.renaming = Some(("t".into(), rune::TextEdit::new("  ")));
        s.rename_session();
        assert!(s.session_menu.renaming.is_some(), "an empty name keeps the dialog open");
        s.session_menu.renaming = Some(("t".into(), rune::TextEdit::new("  Login fix ")));
        s.rename_session();
        assert!(s.session_menu.renaming.is_none());
        assert!(s.core.sent().iter().any(|m| m["type"] == "thread.rename" && m["title"] == "Login fix"));
    }

    #[test]
    fn a_confirmed_delete_starts_the_tab_as_a_new_one() {
        let mut s = desk();
        s.session_menu.deleting = Some("t".into());
        s.delete_session();
        assert!(s.core.sent().iter().any(|m| m["type"] == "thread.delete" && m["tabId"] == "t"));
        assert_eq!(s.workspace.tabs[0].title, crate::workspace::NEW_TAB_TITLE);
    }

    #[test]
    fn a_fork_opens_beside_its_tab_and_resumes_there() {
        let mut s = desk();
        let message = serde_json::json!({ "type": "thread.forked", "tabId": "t", "threadId": "s2", "title": "Fix the login form (fork)" });
        s.receive(Event::Message(serde_json::from_value(message).unwrap())).unwrap();
        let titles: Vec<_> = s.workspace.tabs.iter().map(|t| (t.title.clone(), t.project.clone())).collect();
        assert_eq!(titles, [("Fix the login form".into(), "/code/web".into()), ("Fix the login form (fork)".into(), "/code/web".into())]);
        let forked = s.workspace.tabs[1].id.clone();
        assert!(s.core.sent().iter().any(|m| m["type"] == "thread.resume" && m["tabId"] == forked.as_str() && m["threadId"] == "s2"));
    }
}
