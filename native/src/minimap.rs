//! The thread's minimap, after T3 Code: a mark per message the
//! user sent, evenly spaced down a rail in the thread's left gutter. A mark is darker while its turn is on
//! screen. Marks near the pointer grow, the nearest previews the message and the start of the agent's answer,
//! and a click jumps to it. A wide gutter shows the minimap all the time, and a narrow one on hover.

use crate::protocol::ThreadItem;
use crate::shell::Desk;
use crate::threads::Thread;
use rune::{El, col, el, text};
use rune_kit::Kit;

/// One mark: a message the user sent, and the start of the agent's final answer to it.
#[derive(Clone, Debug, PartialEq)]
pub struct Mark {
    pub id: String,
    pub text: String,
    pub answer: Option<String>,
}

/// The fewest messages a thread needs before its minimap shows.
const MIN_MARKS: usize = 2;
/// The gap between marks.
const SPACING: f32 = 8.0;
/// The rail leaves this much of the session's height free, `calc(100vh - 18rem)`.
const RAIL_SPARE: f32 = 288.0;
/// A gutter at least this wide shows the minimap all the time.
const PERSISTENT_GUTTER: f32 = 48.0;
/// The rail sits this far into the gutter.
const RAIL_LEFT: f32 = 12.0;
/// The preview's width, `w-80`.
const PREVIEW_WIDTH: f32 = 320.0;

/// The minimap's marks: one per message the user sent, with the last text the agent wrote before the next one.
/// A turn the agent started itself gets no mark.
pub fn marks(items: &[ThreadItem]) -> Vec<Mark> {
    let mut out: Vec<Mark> = Vec::new();
    for item in items {
        match item {
            ThreadItem::User { id, text, self_started: false, .. } => {
                let line = crate::format::one_line(text);
                out.push(Mark { id: id.clone(), text: if line.is_empty() { "User message".into() } else { line }, answer: None });
            }
            ThreadItem::Text { text, .. } => {
                if let Some(last) = out.last_mut() {
                    last.answer = Some(crate::format::one_line(text));
                }
            }
            _ => {}
        }
    }
    out
}

/// The mark nearest a point down the rail, given as a fraction of its height.
fn mark_at(fraction: f32, count: usize) -> usize {
    ((fraction.clamp(0.0, 1.0) * (count - 1) as f32).round() as usize).min(count - 1)
}

/// The rows of `thread` on screen, and the minimap's pointer, which the view reads.
#[derive(Default)]
pub struct Minimap {
    pub visible: std::ops::Range<usize>,
    active: Option<usize>,
}

/// The minimap of `tab`, in a gutter `gutter` wide, over a thread `height` tall.
pub fn minimap(s: &Desk, tab: &str, thread: &Thread, gutter: f32, height: f32, k: &Kit) -> Option<El> {
    let marks = marks(&thread.items);
    if marks.len() < MIN_MARKS || gutter < RAIL_LEFT {
        return None;
    }
    let count = marks.len();
    let rail_height = ((count - 1) as f32 * SPACING).min(height - RAIL_SPARE).max(SPACING);
    let top_of = |i: usize| i as f32 / (count - 1) as f32 * rail_height;
    // A turn is on screen when its message's row is.
    let visible: Vec<&str> = thread.rows.get(s.minimap.visible.clone()).into_iter().flatten().map(|r| r.id()).collect();
    let active = s.minimap.active;
    let strip = (gutter - RAIL_LEFT).clamp(0.0, 40.0);
    let rail_marks = marks.iter().enumerate().map(|(i, mark)| {
        let distance = active.map(|a| a.abs_diff(i));
        let scale = match distance {
            Some(0) => 1.0,
            Some(1) => 0.667,
            Some(2) => 0.417,
            _ => 0.333,
        };
        let on_screen = visible.contains(&mark.id.as_str());
        let alpha = if distance == Some(0) || on_screen { 0.6 } else { 0.25 };
        el().absolute(0.0, top_of(i) - 1.0).size(24.0 * scale, 2.0).radius(1.0).fill(k.c.text_faint.alpha(alpha))
    });
    let preview = active.and_then(|i| marks.get(i)).map(|mark| {
        let y = match active {
            Some(0) => 0.0,
            Some(i) if i == count - 1 => -1.0,
            _ => -0.5,
        };
        col()
            .absolute(32.0, top_of(active.unwrap_or(0)) + y * 64.0)
            .w(PREVIEW_WIDTH)
            .padding(12.0)
            .radius(12.0)
            .fill(k.c.layer_01.alpha(0.95))
            .child(text(mark.text.clone()).font(k.ty.body_medium).color(k.c.text_base).truncate())
            .children(mark.answer.clone().map(|a| text(a).font(k.ty.body).color(k.c.text_faint).wrap().max_lines(3).mt(4.0)))
    });
    let press_tab = tab.to_owned();
    let ids: Vec<String> = marks.iter().map(|m| m.id.clone()).collect();
    let hit = el()
        .key("minimap-rail")
        .w(if active.is_some() { 352.0 } else { strip })
        .h(rail_height)
        .role("button")
        .label("Jump to a message")
        .on_pointer_move_local(move |s: &mut Desk, p, _| s.minimap.active = Some(mark_at(p.y / rail_height, count)))
        .on_hover_change(|s: &mut Desk, hovered, _| {
            if !hovered {
                s.minimap.active = None;
            }
        })
        .on_press_tx(move |s: &mut Desk, tx| {
            if let Some(i) = s.minimap.active {
                tx.scroll_into_view_in(format!("thread-{press_tab}"), ids[i].clone());
            }
        })
        .child(el().absolute(12.0, 0.0).size(1.0, rail_height).fill(k.c.border_base.alpha(0.15)))
        .children(rail_marks)
        .children(preview);
    let rail = el().pin(Some(RAIL_LEFT), Some((height - rail_height) / 2.0), None, None).child(hit);
    let shown = col().key("minimap").pin(Some(0.0), Some(0.0), None, Some(0.0)).w(72.0).child(rail);
    Some(if gutter >= PERSISTENT_GUTTER { shown } else { shown.hover_group().group_opacity(0.0, 1.0) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(id: &str, text: &str, self_started: bool) -> ThreadItem {
        ThreadItem::User { id: id.into(), text: text.into(), images: vec![], at: None, steered: false, waiting: false, self_started }
    }

    #[test]
    fn a_mark_per_message_with_the_last_answer_before_the_next() {
        let reply = |id: &str, text: &str| ThreadItem::Text { id: id.into(), text: text.into(), done: true, at: None, interrupted: false };
        let items = [user("u1", "Fix  the\nform", false), reply("x1", "first"), reply("x2", "Done,  fixed."), user("u2", "A task ended", true), user("u3", "  ", false)];
        let found = marks(&items);
        assert_eq!(found.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["u1", "u3"]);
        assert_eq!(found[0].answer.as_deref(), Some("Done, fixed."));
        assert_eq!(found[1].text, "User message");
        assert_eq!(mark_at(0.49, 3), 1);
        assert_eq!(mark_at(2.0, 3), 2);
    }
}
