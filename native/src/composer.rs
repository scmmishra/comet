//! The message box under the thread, as `app/src/renderer/composer.tsx` lays it out after T3 Code: a tall
//! text area in a card, then a row with the send button. While Claude works, the button stops the turn,
//! or sends a follow-up once there is one to send.

use crate::protocol::ClientMessage;
use crate::shell::Desk;
use crate::theme;
use crate::thread_view::COLUMN;
use rune::{El, Key, KeyEvent, TextEdit, auto_grow, col, row, text_input};
use rune_kit::{ControlSize, IconButton, IconButtonVariant, Kit};
use rune_theme_opencode::icons as ic;
use std::collections::HashMap;
use std::time::Instant;

/// The card's corners, `rounded-3xl`.
const CARD_RADIUS: f32 = 12.0;
/// The text area grows from two lines to this many, then scrolls.
const MAX_LINES: usize = 12;
/// A second Escape within this long stops Claude.
const STOP_AGAIN: std::time::Duration = std::time::Duration::from_millis(1500);
const PLACEHOLDER: &str = "Ask anything, @ to add files, / for commands";

/// What a message sent while Claude works does, and the other choice, which ⌘ picks.
#[derive(Clone, Copy, Debug, PartialEq)]
enum FollowUp {
    Steer,
    Queue,
}

impl FollowUp {
    fn from_setting(value: &str) -> FollowUp {
        if value == "queue" { FollowUp::Queue } else { FollowUp::Steer }
    }

    fn other(self) -> FollowUp {
        match self {
            FollowUp::Steer => FollowUp::Queue,
            FollowUp::Queue => FollowUp::Steer,
        }
    }

    fn name(self) -> &'static str {
        match self {
            FollowUp::Steer => "steer",
            FollowUp::Queue => "queue",
        }
    }

    fn label(self) -> &'static str {
        match self {
            FollowUp::Steer => "Steer message",
            FollowUp::Queue => "Queue message",
        }
    }

    fn icon(self) -> &'static rune::Icon {
        match self {
            FollowUp::Steer => &ic::ARROW_UP_RIGHT,
            FollowUp::Queue => &ic::OUTLINE_LIST_CHANGELOG,
        }
    }

    /// A slash command is a turn Claude Code runs on its own, so steering one in would cut the running
    /// turn short. It always waits in the queue (`followUpFor` in the protocol).
    fn for_text(self, text: &str) -> FollowUp {
        if text.trim_start().starts_with('/') { FollowUp::Queue } else { self }
    }
}

/// Each tab's unsent message, and when Escape was last pressed.
#[derive(Default)]
pub struct Drafts {
    by_tab: HashMap<String, TextEdit>,
    escaped_at: Option<Instant>,
}

impl Drafts {
    fn edit(&mut self, tab: &str) -> &mut TextEdit {
        self.by_tab.entry(tab.to_owned()).or_insert_with(|| TextEdit::new(""))
    }

    fn text(&self, tab: &str) -> &str {
        self.by_tab.get(tab).map_or("", |e| e.text.as_str())
    }
}

impl Desk {
    fn follow_up(&self, alternate: bool) -> FollowUp {
        let chosen = FollowUp::from_setting(self.account.settings.as_ref().map_or("steer", |s| s.claude.follow_up.as_str()));
        if alternate { chosen.other() } else { chosen }
    }

    fn busy(&self, tab: &str) -> bool {
        self.threads.get(tab).is_some_and(|t| t.busy)
    }

    /// Sends the active tab's message. While Claude works, it steers or queues, and ⌘ picks the other.
    /// A tab with no name takes it from the message.
    fn submit(&mut self, alternate: bool) {
        let Some(tab) = self.workspace.active.clone() else { return };
        let text = self.drafts.text(&tab).trim().to_owned();
        if text.is_empty() {
            return;
        }
        if self.workspace.active_tab().is_some_and(crate::workspace::is_untitled) {
            self.workspace.name_tab(&tab, &text, &self.core);
        }
        let follow_up = self.busy(&tab).then(|| self.follow_up(alternate).for_text(&text).name().to_owned());
        self.core.send(&ClientMessage::SessionSend { tab_id: tab.clone(), text, follow_up });
        self.drafts.edit(&tab).clear();
    }

    pub fn interrupt(&mut self, tab: &str) {
        if self.busy(tab) {
            self.core.send(&ClientMessage::SessionInterrupt { tab_id: tab.to_owned() });
        }
    }

    /// Escape stops Claude only when pressed twice, so a reflexive Escape does not cut a turn short.
    fn escape(&mut self, tab: &str) {
        if !self.busy(tab) {
            return;
        }
        match self.drafts.escaped_at.take() {
            Some(at) if at.elapsed() < STOP_AGAIN => self.interrupt(tab),
            _ => self.drafts.escaped_at = Some(Instant::now()),
        }
    }
}

/// The composer of `tab`, centred in the thread's column.
pub fn composer(s: &Desk, tab: &str, k: &Kit) -> El {
    let edit = s.drafts.by_tab.get(tab).cloned().unwrap_or_else(|| TextEdit::new(""));
    let empty = edit.text.trim().is_empty();
    let field = text_input(&edit, theme::thread_text(k, s.account.text_size()))
        .key("composer-input")
        .w_full()
        .color(k.c.text_base)
        .placeholder(PLACEHOLDER, k.c.text_faint)
        .caret(k.c.text_base, k.selection())
        .on_edit(|s: &mut Desk| {
            let tab = s.workspace.active.clone().unwrap_or_default();
            s.drafts.edit(&tab)
        })
        .on_submit(|s: &mut Desk, _| {
            let alternate = s.cmd_held();
            s.submit(alternate);
        })
        .on_input_key(|s: &mut Desk, key: &KeyEvent, _| {
            if key.key != Key::Escape {
                return false;
            }
            if let Some(tab) = s.workspace.active.clone() {
                s.escape(&tab);
            }
            true
        });
    let input = col().w_full().px(16.0).pt(14.0).child(auto_grow(field, 2, MAX_LINES));
    let actions = row().w_full().items_center().gap(4.0).px(10.0).pb(10.0).pt(4.0).child(row().grow(1.0)).child(send_button(s, tab, empty, k));
    let border = if edit.focused { k.c.layer_03 } else { k.c.border_base };
    let card = col().key("composer").w_full().radius(CARD_RADIUS).fill(k.c.layer_01).border(1.0, border).child(input).child(actions);
    col().w_full().items_center().child(col().w_full().max_w(COLUMN).pt(6.0).pb(16.0).child(card))
}

fn send_button(s: &Desk, tab: &str, empty: bool, k: &Kit) -> El {
    let round = |b: IconButton| b.control_size(ControlSize::Large).build(k).radius(16.0);
    if !s.busy(tab) {
        return round(IconButton::new(&ic::ARROW_UP).variant(IconButtonVariant::Submit).label("Send").disabled(empty).on_press_tx(|s: &mut Desk, _| {
            let alternate = s.cmd_held();
            s.submit(alternate);
        }))
        .key("send");
    }
    if empty {
        let tab = tab.to_owned();
        return round(IconButton::new(&ic::STOP).variant(IconButtonVariant::Contrast).label("Stop").on_press_tx(move |s: &mut Desk, _| s.interrupt(&tab))).key("stop");
    }
    let follow = s.follow_up(false);
    round(
        IconButton::new(follow.icon())
            .variant(IconButtonVariant::Submit)
            .label(follow.label())
            .help(format!("Click to {}, ⌘-click or ⌘Enter to {}", follow.name(), follow.other().name()))
            .on_press_tx(|s: &mut Desk, _| {
                let alternate = s.cmd_held();
                s.submit(alternate);
            }),
    )
    .key("follow-up")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::Event;
    use crate::protocol::{CoreMessage, TabInfo, ThreadEvent};
    use serde_json::Map;

    /// A window with one untitled tab, as restored from the core.
    fn desk() -> Desk {
        let mut s = Desk::default();
        let tab = TabInfo { id: "t".into(), title: crate::workspace::NEW_TAB_TITLE.into(), project: "/code/x".into(), terminals: vec![], model: "default".into(), effort: None, fast: None, permission_mode: "auto".into(), rest: Map::new() };
        s.receive(Event::Message(CoreMessage::Tabs { tabs: vec![tab], active: Some("t".into()) })).unwrap();
        let _ = s.core.sent();
        s
    }

    fn type_text(s: &mut Desk, words: &str) {
        s.drafts.edit("t").text = words.into();
    }

    #[test]
    fn sending_names_an_untitled_tab_and_clears_the_draft() {
        let mut s = desk();
        type_text(&mut s, "  Fix the login form  ");
        s.submit(false);
        let sent = s.core.sent();
        let send = sent.iter().find(|m| m["type"] == "session.send").expect("a send");
        assert_eq!(send["text"], "Fix the login form");
        assert!(send.get("followUp").is_none(), "an idle tab starts a turn");
        assert_eq!(s.workspace.tabs[0].title, "Fix the login form");
        assert_eq!(s.drafts.text("t"), "");
    }

    #[test]
    fn while_claude_works_a_message_steers_and_cmd_queues() {
        let mut s = desk();
        s.threads.apply("t", ThreadEvent::Status { busy: true });
        type_text(&mut s, "go on");
        s.submit(false);
        type_text(&mut s, "and then this");
        s.submit(true);
        let follow: Vec<_> = s.core.sent().into_iter().filter(|m| m["type"] == "session.send").map(|m| m["followUp"].clone()).collect();
        assert_eq!(follow, ["steer", "queue"]);
    }

    #[test]
    fn escape_stops_claude_only_when_pressed_twice() {
        let mut s = desk();
        s.threads.apply("t", ThreadEvent::Status { busy: true });
        s.escape("t");
        assert!(s.core.sent().is_empty());
        s.escape("t");
        assert_eq!(s.core.sent()[0]["type"], "session.interrupt");
    }

    #[test]
    fn a_slash_command_always_waits_in_the_queue() {
        assert_eq!(FollowUp::Steer.for_text("/compact"), FollowUp::Queue);
        assert_eq!(FollowUp::Steer.for_text("go on"), FollowUp::Steer);
        assert_eq!(FollowUp::Steer.other(), FollowUp::Queue);
    }
}
