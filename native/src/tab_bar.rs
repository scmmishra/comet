//! The window's tabs: 210 point tabs with the
//! project's mark, the title in 12 point text and a spinner while the agent works, and a close button
//! on the active tab and the one under the pointer. Rune's TabStrip sets its titles in the kit's
//! medium weight and shrinks its tabs to fit, so Comet draws its own.

use crate::shell::{Comet, tab_mark};
use crate::workspace::Place;
use rune::{Anim, Color, Drag, El, Phase, Tx, el, row, text};
use rune_kit::{ControlSize, IconButton, IconButtonVariant, Kit, Spinner};
use rune_theme_opencode::icons as ic;

const TAB_WIDTH: f32 = 210.0;
const TAB_HEIGHT: f32 = 32.0;
const TAB_RADIUS: f32 = 8.0;
/// The space between tabs, and around the strip.
const GAP: f32 = 4.0;
/// How far a pressed tab moves before it drags. A press that moves less stays a click.
const DRAG_THRESHOLD: f32 = 4.0;
/// The distance from one tab's start to the next.
const PITCH: f32 = TAB_WIDTH + GAP;
/// The title fades out over its last fifth when it runs long, as `.comet-fade-end` masks it.
const TITLE_FADE: f32 = 30.0;

/// The tab being dragged, and the tab the strip last scrolled to.
#[derive(Default)]
pub struct TabBar {
    drag: Option<TabDrag>,
    shown: Option<String>,
}

/// A tab dragged along the strip. The tabs keep their order until the drop: the dragged tab
/// follows the pointer and the tabs it passes step aside, as Rune's TabStrip does.
#[derive(Clone, Debug, PartialEq)]
struct TabDrag {
    id: String,
    /// The tab's place at the press.
    from: usize,
    /// The place it takes if it is dropped now.
    to: usize,
    /// How far the pointer moved along the strip, held to the strip's ends.
    dx: f32,
}

impl TabDrag {
    /// How far the tab at `index` sits from its place: the dragged tab with the pointer, and the
    /// tabs between its place and its target one pitch toward the gap it left.
    fn shift(&self, index: usize) -> f32 {
        let (from, to) = (self.from, self.to);
        if index == from {
            self.dx
        } else if from < index && index <= to {
            -PITCH
        } else if to <= index && index < from {
            PITCH
        } else {
            0.0
        }
    }
}

/// Keeps the active tab in sight: a tab opened, reopened or chosen past the strip's edge scrolls in.
pub fn follow_active(s: &mut Comet, tx: &mut Tx) {
    if s.workspace.active != s.tab_bar.shown {
        s.tab_bar.shown = s.workspace.active.clone();
        if let Some(id) = &s.tab_bar.shown {
            tx.scroll_into_view_in("tabs", format!("tab-{id}"));
        }
    }
}

/// The strip of tabs and the new tab button, for the window's title bar.
pub fn tab_bar(s: &Comet, k: &Kit) -> El {
    let w = &s.workspace;
    // Settings show in place of the active tab, so while they are open no tab is marked active.
    let shown = w.active.as_deref().filter(|_| w.settings_page.is_none());
    let dragging = s.tab_bar.drag.as_ref();
    // While the model picker is open, ⌘1 to ⌘9 pick models, so the tabs show no numbers.
    let numbered = s.tab_numbers.shown() && !s.digits_pick_models();
    let tabs = w.tabs.iter().enumerate().map(|(index, tab)| {
        let active = shown == Some(tab.id.as_str());
        let busy = s.threads.get(&tab.id).is_some_and(|t| t.busy);
        let close_id = tab.id.clone();
        let middle_id = tab.id.clone();
        let close = IconButton::new(&ic::XMARK_SMALL)
            .variant(IconButtonVariant::GhostMuted)
            .control_size(ControlSize::Small)
            .label("Close tab")
            .on_press_tx(move |s: &mut Comet, tx: &mut Tx| s.close_tab(&close_id, tx))
            .build(k);
        let close = row().absolute(TAB_WIDTH - 20.0 - 6.0, (TAB_HEIGHT - 20.0) / 2.0).child(close);
        let close = if active { close } else { close.group_opacity(0.0, 1.0) };
        let title = text(tab.title.clone())
            .font(crate::theme::text(12.0))
            .color(if active { k.c.text_base } else { k.c.text_faint })
            .truncate_fade_width(TITLE_FADE / 12.0)
            .grow(1.0)
            .min_w(0.0);
        let body = row()
            .w_full()
            .h_full()
            .gap(8.0)
            .items_center()
            .pl(8.0)
            .pr(28.0)
            .child(tab_mark(s, &tab.project, crate::workspace::tab_number(index), numbered, k))
            .child(title)
            .children(busy.then(|| Spinner::new().size(14.0).color(k.c.text_accent).build(k)));
        let id = tab.id.clone();
        let lifted = dragging.is_some_and(|d| d.id == tab.id);
        let mut slot = row()
            .key(format!("tab-{}", tab.id))
            .w(TAB_WIDTH)
            .h(TAB_HEIGHT)
            .radius(TAB_RADIUS)
            .hover_group()
            .role("tab")
            .checked(active)
            .label(tab.title.clone())
            .no_window_drag()
            .opacity(if lifted { 0.7 } else { 1.0 })
            // Tabs step aside on a quick spring while a tab drags. A drop, and tabs that open,
            // close or move otherwise, reflow.
            .motion(if dragging.is_some() { rune::tok::motion::SNAP } else { rune::tok::motion::REFLOW })
            .offset(dragging.map_or(0.0, |d| d.shift(index)), 0.0)
            .on_drag(move |s: &mut Comet, d: &mut Drag, _: &mut Tx| drag(s, &id, index, d))
            // A middle click closes the tab, as the close button does.
            .on_middle_press(move |s: &mut Comet, tx: &mut Tx| s.close_tab(&middle_id, tx))
            .child(body)
            .child(close);
        if lifted {
            // It follows the pointer exactly, over its neighbours.
            slot = slot.raise().offset_motion(Anim::INSTANT);
        }
        slot = if active {
            slot.fill(crate::theme::tab(k.dark)).border(1.0, crate::theme::outline(k.dark))
        } else {
            slot.hover(crate::theme::tab_hover(k.dark))
        };
        slot
    });
    let plus = IconButton::new(&ic::PLUS)
        .control_size(ControlSize::Large)
        .variant(IconButtonVariant::GhostMuted)
        .label("New tab")
        .help("New tab. ⌘-click opens it next to this one.")
        .on_press_tx(|s: &mut Comet, tx: &mut Tx| s.new_tab(if s.cmd_held() { Place::Next } else { Place::End }, None, tx))
        .build(k)
        .key("new-tab")
        .no_window_drag();
    row()
        .key("tabs")
        .grow(1.0)
        .min_w(0.0)
        .h_full()
        .gap(GAP)
        .px(GAP)
        .items_center()
        .scroll_x()
        .children(tabs)
        .child(plus)
        .child(el().grow(1.0).h_full().fill(Color::TRANSPARENT))
}

/// A press that moves past the threshold drags the tab along the strip. A drop moves it to the place
/// it was over. A press that does not move selects the tab.
fn drag(s: &mut Comet, id: &str, index: usize, d: &mut Drag) {
    match d.phase {
        Phase::Down => {}
        Phase::Move => {
            if s.tab_bar.drag.is_none() && d.dx.abs() < DRAG_THRESHOLD {
                return;
            }
            s.tab_bar.drag = Some(follow(index, s.workspace.tabs.len(), id, d.dx));
        }
        Phase::Up => match s.tab_bar.drag.take() {
            Some(drag) if !d.cancelled() => {
                // A tab opened or closed during the drag leaves `from` stale, so find the tab again.
                if let Some(from) = s.workspace.tabs.iter().position(|t| t.id == drag.id) {
                    let to = drag.to.min(s.workspace.tabs.len().saturating_sub(1));
                    s.workspace.move_tab(from, to, &s.core);
                }
            }
            Some(_) => {}
            None if !d.cancelled() => s.show_tab(id),
            None => {}
        },
    }
}

/// The drag of the tab at `from`, among `count` tabs, `dx` from the press. The tab takes the place
/// of each tab it passes the middle of.
fn follow(from: usize, count: usize, id: &str, dx: f32) -> TabDrag {
    let last = count.saturating_sub(1);
    let dx = dx.clamp(-(from as f32) * PITCH, last.saturating_sub(from) as f32 * PITCH);
    let to = (from as f32 + (dx / PITCH).round()).clamp(0.0, last as f32) as usize;
    TabDrag { id: id.to_owned(), from, to, dx }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabs_between_the_place_and_the_target_step_aside() {
        let d = follow(1, 5, "t", 1.6 * PITCH);
        assert_eq!(d.to, 3);
        let shifts: Vec<f32> = (0..5).map(|i| d.shift(i)).collect();
        assert_eq!(shifts, [0.0, 1.6 * PITCH, -PITCH, -PITCH, 0.0]);
        let d = follow(3, 5, "t", -1.4 * PITCH);
        assert_eq!(d.to, 2, "a tab moves once it passes the middle of the next");
        assert_eq!(d.shift(2), PITCH);
    }

    #[test]
    fn the_dragged_tab_stays_inside_the_strip() {
        let d = follow(1, 3, "t", -5.0 * PITCH);
        assert_eq!((d.to, d.dx), (0, -PITCH));
        let d = follow(1, 3, "t", 5.0 * PITCH);
        assert_eq!((d.to, d.dx), (2, PITCH));
    }
}
