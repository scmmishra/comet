//! Going back to one of the user's messages, after T3 Code. The pencil beside a message rewinds the
//! thread to before it and puts the message back in the composer, after the user confirms. The fork
//! beside it opens a copy of the thread, through that message's turn, in a new tab.

use crate::protocol::{ClientMessage, ImageAttachment};
use crate::shell::Comet;
use rune::{El, col, row};
use rune_kit::{ButtonVariant, Checkbox, Dialog, Kit};

#[derive(Default)]
pub struct Rewind {
    /// The rewind waiting for the user to confirm it.
    asking: Option<Ask>,
}

struct Ask {
    tab: String,
    message: String,
    text: String,
    images: Vec<ImageAttachment>,
    /// Whether to restore the files the agent's tools changed since the message. Off by default, since it changes files.
    restore_files: bool,
}

impl Comet {
    /// Asks before rewinding a tab's thread to before one of its messages.
    pub fn ask_rewind(&mut self, tab: &str, message: &str, text: &str, images: &[ImageAttachment]) {
        self.rewind.asking = Some(Ask { tab: tab.to_owned(), message: message.to_owned(), text: text.to_owned(), images: images.to_vec(), restore_files: false });
    }

    /// Rewinds as the user confirmed, and puts the message in the composer to change and send again.
    fn confirm_rewind(&mut self) {
        let Some(ask) = self.rewind.asking.take() else { return };
        self.core.send(&ClientMessage::ThreadRewind { tab_id: ask.tab.clone(), message_id: ask.message, restore_files: ask.restore_files });
        self.put_in_draft(&ask.tab, &ask.text, &ask.images);
    }

    /// Opens a copy of a tab's thread, through the turn one of its messages starts, in a new tab.
    pub fn fork_from(&self, tab: &str, message: &str) {
        self.core.send(&ClientMessage::ThreadFork { tab_id: tab.to_owned(), message_id: Some(message.to_owned()) });
    }
}

/// The confirmation, for the tab it was asked in.
pub fn dialog(s: &Comet, tab: &str, k: &Kit, layer: &mut Vec<El>) {
    let Some(ask) = s.rewind.asking.as_ref().filter(|ask| ask.tab == tab) else { return };
    let agent = s.agent_name(s.tab_agent(tab));
    // Only an agent that keeps a copy of each file it edits can take its changes back.
    let restore = s.tab_can(tab, "restore-files").then(|| Checkbox::new(ask.restore_files)
        .label(format!("Restore files {agent} changed since"))
        .description("Changes from commands it ran stay.")
        .on_toggle(|s: &mut Comet| {
            if let Some(ask) = s.rewind.asking.as_mut() {
                ask.restore_files = !ask.restore_files;
            }
        })
        .build(k));
    let footer = row()
        .w_full()
        .gap(8.0)
        .child(row().grow(1.0))
        .child(crate::theme::button("Cancel").variant(ButtonVariant::Ghost).on_press(|s: &mut Comet| s.rewind.asking = None).build(k))
        .child(crate::theme::button("Rewind").variant(ButtonVariant::Submit).on_press(|s: &mut Comet| s.confirm_rewind()).build(k));
    Dialog::new("rewind-thread", "Rewind to this message?")
        .description(format!("{agent} forgets this message and everything after it. The message goes back in the message box, so you can change it and send it again."))
        .open(true)
        .fit()
        .on_close(|s: &mut Comet| s.rewind.asking = None)
        .child(col().w_full().gap(16.0).px(16.0).pb(16.0).children(restore).child(footer))
        .build(k, layer);
}

#[cfg(test)]
mod tests {
    use crate::core::Event;
    use crate::protocol::{CoreMessage, ImageAttachment};
    use crate::shell::Comet;

    fn comet() -> Comet {
        let mut s = Comet::default();
        let tabs = serde_json::json!({ "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "Fix the login form", "project": "/code/web", "terminals": [], "agent": "claude", "model": "default", "permissionMode": "auto" }] });
        s.receive(Event::Message(serde_json::from_value::<CoreMessage>(tabs).unwrap())).unwrap();
        let _ = s.core.sent();
        s
    }

    #[test]
    fn a_confirmed_rewind_asks_the_core_with_the_users_choice() {
        let mut s = comet();
        let image = ImageAttachment { media_type: "image/png".into(), data: "iVBORw==".into() };
        s.ask_rewind("t", "u2", "Now add a test", &[image]);
        assert!(s.core.sent().is_empty(), "nothing goes before the user confirms");
        s.rewind.asking.as_mut().unwrap().restore_files = true;
        s.confirm_rewind();
        assert!(s.rewind.asking.is_none());
        assert!(s.core.sent().iter().any(|m| m["type"] == "thread.rewind" && m["messageId"] == "u2" && m["restoreFiles"] == true));
    }

    #[test]
    fn a_cancelled_rewind_sends_nothing() {
        let mut s = comet();
        s.ask_rewind("t", "u2", "Now add a test", &[]);
        s.rewind.asking = None;
        s.confirm_rewind();
        assert!(s.core.sent().is_empty());
    }

    #[test]
    fn a_fork_from_a_message_names_it() {
        let s = comet();
        s.fork_from("t", "u1");
        assert!(s.core.sent().iter().any(|m| m["type"] == "thread.fork" && m["messageId"] == "u1"));
    }
}
