//! The notice that the project left the branch a tab's thread last ran on, after T3 Code. It shows above
//! the composer once the user types, and stays for that change of branch until the user dismisses it or
//! the branches match again. Restore branch switches the project back, and asks first when uncommitted
//! changes would come along.
//!
//! rune-kit has no notice row for a composer, so this one is Comet's own, drawn as the queue's line is.

use crate::protocol::{ClientMessage, TabInfo};
use crate::shell::Comet;
use rune::{El, icon, row, text};
use rune_kit::{ButtonVariant, ControlSize, Dialog, IconButton, IconButtonVariant, Kit};
use rune_theme_opencode::icons as ic;
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub struct BranchNotices {
    /// The changes of branch the user dismissed, by tab. They stay dismissed while Comet runs.
    dismissed: HashSet<(String, Mismatch)>,
    /// The change of branch each tab's notice last showed for. The notice stays once the composer empties, as after a send.
    shown: HashMap<String, Mismatch>,
    /// Projects switching back to a thread's branch, until the core sends their Space or an error.
    restoring: HashSet<String>,
    /// The tab whose restore waits for the user to confirm it.
    confirming: Option<String>,
}

impl BranchNotices {
    /// The core read a project's Space again, so a restore in it has ended.
    pub fn space_read(&mut self, project: &str) {
        self.restoring.remove(project);
    }

    /// Something failed. The core's error does not say what, so no restore waits any more.
    pub fn failed(&mut self) {
        self.restoring.clear();
    }
}

/// The branch a thread last ran on, and the branch its project is on now.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Mismatch {
    pub thread: String,
    pub current: String,
}

/// The change of branch, when the project is on another branch than the thread last ran on.
fn mismatch(thread: Option<&str>, current: Option<&str>) -> Option<Mismatch> {
    match (thread, current) {
        (Some(thread), Some(current)) if thread != current => Some(Mismatch { thread: thread.to_owned(), current: current.to_owned() }),
        _ => None,
    }
}

/// T3 Code's `shouldShowBranchMismatchBanner`. The composer takes focus on its own, so focus does not show
/// that the user means to send. Text in it does.
fn should_show(dismissed: bool, has_content: bool, shown_before: bool) -> bool {
    !dismissed && (has_content || shown_before)
}

impl Comet {
    /// The change of branch the notice shows for `tab`, if it shows.
    fn branch_notice(&self, tab: &TabInfo) -> Option<Mismatch> {
        let thread = self.threads.get(&tab.id).and_then(|t| t.branch.as_deref());
        let current = self.projects.get(&tab.project).and_then(|p| p.space.as_ref()).map(|space| space.branch.as_str());
        let found = mismatch(thread, current)?;
        let notices = &self.branch_notices;
        let dismissed = notices.dismissed.contains(&(tab.id.clone(), found.clone()));
        should_show(dismissed, self.drafts.has_content(&tab.id), notices.shown.get(&tab.id) == Some(&found)).then_some(found)
    }

    /// Notes the change of branch the active tab's notice shows for, so the notice stays after a send.
    pub fn sync_branch_notice(&mut self) {
        let Some(tab) = self.workspace.active_tab() else { return };
        if let Some(found) = self.branch_notice(tab) {
            let id = tab.id.clone();
            self.branch_notices.shown.insert(id, found);
        }
    }

    fn dismiss_branch_notice(&mut self, tab: &str, found: Mismatch) {
        self.branch_notices.dismissed.insert((tab.to_owned(), found));
    }

    /// Switches the project back to the thread's branch. With uncommitted changes, the user confirms first.
    pub fn restore_branch(&mut self, tab: &str) {
        let Some(info) = self.workspace.tabs.iter().find(|t| t.id == tab) else { return };
        let changed = self.projects.get(&info.project).and_then(|p| p.space.as_ref()).is_some_and(|space| space.changes.files > 0);
        if changed {
            self.branch_notices.confirming = Some(tab.to_owned());
        } else {
            self.send_restore(tab);
        }
    }

    fn confirm_restore(&mut self) {
        if let Some(tab) = self.branch_notices.confirming.take() {
            self.send_restore(&tab);
        }
    }

    fn send_restore(&mut self, tab: &str) {
        let Some(info) = self.workspace.tabs.iter().find(|t| t.id == tab) else { return };
        self.branch_notices.restoring.insert(info.project.clone());
        self.core.send(&ClientMessage::BranchRestore { tab_id: tab.to_owned() });
    }
}

/// The notice above `tab`'s composer, while it shows.
pub fn notice(s: &Comet, tab: &TabInfo, k: &Kit) -> Option<El> {
    let found = s.branch_notice(tab)?;
    let restoring = s.branch_notices.restoring.contains(&tab.project);
    let explain = format!("This thread last ran on {}. Sending will continue on {}.", found.thread, found.current);
    let words = row()
        .grow(1.0)
        .min_w(0.0)
        .gap(6.0)
        .items_center()
        .child(text("Branch changed from").font(crate::theme::text(12.0)).color(k.c.text_muted))
        .child(text(found.thread.clone()).font(crate::theme::mono(12.0)).color(k.c.text_base).truncate().shrink().min_w(0.0).help(explain));
    let id = tab.id.clone();
    let restore = crate::theme::small_button(if restoring { "Restoring…" } else { "Restore branch" })
        .variant(ButtonVariant::Ghost)
        .disabled(restoring)
        .on_press(move |s: &mut Comet| s.restore_branch(&id))
        .build(k)
        .key("restore-branch");
    let id = tab.id.clone();
    let dismiss = IconButton::new(&ic::XMARK_SMALL)
        .variant(IconButtonVariant::GhostMuted)
        .control_size(ControlSize::Small)
        .label("Dismiss branch change notice")
        .on_press(move |s: &mut Comet| s.dismiss_branch_notice(&id, found.clone()))
        .build(k)
        .key("dismiss-branch-notice");
    // A design border takes room, and Rune's does not, so the padding grows by its width.
    Some(
        row()
            .key("branch-notice")
            .w_full()
            .gap(8.0)
            .items_center()
            .pl(13.0)
            .pr(5.0)
            .py(5.0)
            .mb(8.0)
            .radius(10.0)
            .fill(k.c.layer_01)
            .border(1.0, k.c.border_base)
            .child(icon(&ic::BRANCH, crate::icons::SIZE).color(k.c.text_faint))
            .child(words)
            .child(restore)
            .child(dismiss),
    )
}

/// The confirmation before a restore carries uncommitted changes to the other branch, for the tab it was asked in.
pub fn dialog(s: &Comet, tab: &str, k: &Kit, layer: &mut Vec<El>) {
    if s.branch_notices.confirming.as_deref() != Some(tab) {
        return;
    }
    let Some(branch) = s.threads.get(tab).and_then(|t| t.branch.clone()) else { return };
    // The dialog's description keeps to one line, so the explanation sits in the body, where it wraps.
    let explain = text("You have uncommitted changes. They'll carry over to the other branch, or block the switch if they conflict.").font(crate::theme::text(13.0)).color(k.c.text_muted).wrap();
    let footer = row()
        .w_full()
        .gap(8.0)
        .child(row().grow(1.0))
        .child(crate::theme::button("Cancel").variant(ButtonVariant::Ghost).on_press(|s: &mut Comet| s.branch_notices.confirming = None).build(k))
        .child(crate::theme::button("Switch branch").variant(ButtonVariant::Submit).on_press(|s: &mut Comet| s.confirm_restore()).build(k));
    Dialog::new("restore-branch", format!("Switch to {branch}?"))
        .open(true)
        .fit()
        .on_close(|s: &mut Comet| s.branch_notices.confirming = None)
        .child(rune::col().w_full().gap(16.0).px(16.0).pb(16.0).child(explain).child(footer))
        .build(k, layer);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::Event;
    use crate::protocol::CoreMessage;

    /// A tab whose thread last ran on `login`, in a project now on `main` with `changed` uncommitted files.
    fn comet(changed: u32) -> Comet {
        let mut s = Comet::default();
        let messages = serde_json::json!([
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "Fix the login form", "project": "/code/web", "terminals": [], "agent": "claude", "model": "default", "permissionMode": "auto" }] },
            { "type": "thread.branch", "tabId": "t", "branch": "login" },
            { "type": "project", "project": "/code/web", "part": "space", "value": { "root": "/code/web", "branch": "main", "changes": { "files": changed } } }
        ]);
        for message in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(message)).unwrap();
        }
        let _ = s.core.sent();
        s
    }

    fn shown(s: &Comet) -> Option<Mismatch> {
        s.branch_notice(s.workspace.active_tab().unwrap())
    }

    fn type_text(s: &mut Comet, words: &str) {
        s.put_in_draft("t", words, &[]);
    }

    #[test]
    fn only_another_branch_is_a_change() {
        assert_eq!(mismatch(Some("login"), Some("main")), Some(Mismatch { thread: "login".into(), current: "main".into() }));
        assert_eq!(mismatch(Some("main"), Some("main")), None);
        assert_eq!(mismatch(None, Some("main")), None, "a thread that never ran has no branch");
        assert_eq!(mismatch(Some("login"), None), None, "a folder outside Git has no branch");
    }

    #[test]
    fn the_notice_shows_once_the_user_types_and_stays_after_the_composer_empties() {
        let mut s = comet(0);
        assert_eq!(shown(&s), None, "an empty composer shows no notice");
        type_text(&mut s, "Go on");
        s.sync_branch_notice();
        assert!(shown(&s).is_some());
        // A send empties the composer.
        s.drafts = Default::default();
        assert!(shown(&s).is_some(), "it stays for the same change of branch once the composer empties");
        s.receive(Event::Message(serde_json::from_value(serde_json::json!({ "type": "thread.branch", "tabId": "t", "branch": "main" })).unwrap())).unwrap();
        assert_eq!(shown(&s), None, "the thread ran on the current branch");
    }

    #[test]
    fn a_dismissed_notice_stays_hidden_for_that_change_of_branch() {
        let mut s = comet(0);
        type_text(&mut s, "Go on");
        let found = shown(&s).unwrap();
        s.dismiss_branch_notice("t", found);
        assert_eq!(shown(&s), None);
        s.receive(Event::Message(serde_json::from_value(serde_json::json!({ "type": "thread.branch", "tabId": "t", "branch": "theme" })).unwrap())).unwrap();
        assert!(shown(&s).is_some(), "another change of branch shows again");
    }

    #[test]
    fn a_clean_checkout_restores_at_once_and_waits_for_the_space() {
        let mut s = comet(0);
        s.restore_branch("t");
        assert!(s.core.sent().iter().any(|m| m["type"] == "branch.restore" && m["tabId"] == "t"));
        assert!(s.branch_notices.restoring.contains("/code/web"));
        s.receive(Event::Message(serde_json::from_value(serde_json::json!({ "type": "project", "project": "/code/web", "part": "space", "value": { "root": "/code/web", "branch": "login", "changes": {} } })).unwrap())).unwrap();
        assert!(s.branch_notices.restoring.is_empty());
    }

    #[test]
    fn uncommitted_changes_ask_first() {
        let mut s = comet(2);
        s.restore_branch("t");
        assert!(s.core.sent().is_empty(), "nothing goes before the user confirms");
        assert_eq!(s.branch_notices.confirming.as_deref(), Some("t"));
        s.confirm_restore();
        assert!(s.core.sent().iter().any(|m| m["type"] == "branch.restore"));
        s.receive(Event::Message(CoreMessage::Error { message: "Git could not switch".into(), detail: None })).unwrap();
        assert!(s.branch_notices.restoring.is_empty(), "a failure ends the wait");
    }
}
