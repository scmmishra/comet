//! The widths of the window's panes, and the handles that drag them. One set of widths serves every tab,
//! as OpenCode keeps one layout. The core saves them in the window's file.
//!
//! rune-kit's resize grip lives inside its `SplitView`, a whole window of another shape, so the handle
//! here is Comet's own, after `@opencode/ui`'s `ResizeHandle`.

use crate::core::Core;
use crate::protocol::{ClientMessage, PaneWidths};
use crate::shell::Comet;
use rune::{Anim, CubicBezier, Curve, Cursor, Drag, Easing, El, Phase, Tx, col, el};
use rune_kit::Kit;

/// The room between the cards in a row, which a handle fills.
pub const GAP: f32 = 8.0;
/// A plugin's sidebar until it is dragged, `w-[320px]`.
const SIDEBAR_WIDTH: f32 = 320.0;
/// How far a plugin's sidebar drags, as OpenCode's sidebar does.
const SIDEBAR_MIN: f32 = 136.0;
const SIDEBAR_MAX: f32 = 640.0;
/// The narrowest the session drags to beside the view pane, and the room it leaves the pane, after OpenCode's
/// `SESSION_PANEL_WIDTH_MIN` and `SIDE_PANE_WIDTH_MIN`.
const SESSION_MIN: f32 = 400.0;
const VIEW_PANE_MIN: f32 = 320.0;
/// The pill drawn on a handle under the pointer: 4 by 40 points.
const PILL: (f32, f32) = (4.0, 40.0);
/// The pill shows once the pointer rests on the handle, so crossing between panes stays quiet.
const PILL_DELAY: f32 = 0.2;
const PILL_IN: f32 = 0.15;
const PILL_OUT: f32 = 0.11;

/// The edge a handle drags.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Edge {
    Sidebar,
    Session,
}

#[derive(Debug, Default)]
pub struct Panes {
    widths: PaneWidths,
    /// A drag under way: its edge, and the widths before it, which a cancelled drag puts back.
    held: Option<(Edge, PaneWidths)>,
}

/// Where a row's panes sit this frame, in points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    /// The plugin's sidebar, while the tab shows one.
    pub sidebar: Option<f32>,
    /// The session, while the view pane is open beside it. None until the row is measured, while the
    /// session has not been dragged: the two cards then share the row equally.
    pub session: Option<f32>,
    /// The widest the session drags to, once the row is measured. Its handle shows from then.
    session_max: Option<f32>,
}

impl Panes {
    /// Takes the widths the core saved.
    pub fn restore(&mut self, widths: PaneWidths) {
        self.widths = widths;
    }

    /// Places a row `row` points wide, or not yet measured, with or without a sidebar and the view pane.
    /// The saved widths stay as they are. A window too narrow for one only clamps it while it lasts.
    pub fn place(&self, row: Option<f32>, sidebar: bool, pane: bool) -> Placed {
        let sidebar = sidebar.then(|| self.widths.sidebar.unwrap_or(SIDEBAR_WIDTH).clamp(SIDEBAR_MIN, SIDEBAR_MAX));
        // The room the session and the view pane share.
        let room = row.map(|w| w - sidebar.map_or(0.0, |s| s + GAP) - GAP);
        let session_max = room.filter(|_| pane).map(|r| (r - VIEW_PANE_MIN).max(SESSION_MIN));
        let session = match (self.widths.session, room) {
            _ if !pane => None,
            (Some(w), _) => Some(session_max.map_or(w.max(SESSION_MIN), |max| w.clamp(SESSION_MIN, max))),
            (None, room) => room.map(|r| r / 2.0),
        };
        Placed { sidebar, session, session_max }
    }

    /// The handles on the right edges of the sidebar and the session, pinned in the row's gaps.
    pub fn handles(&self, placed: Placed, k: &Kit) -> Vec<El> {
        let sidebar = placed.sidebar.map(|w| self.handle(Edge::Sidebar, w, w, SIDEBAR_MIN, SIDEBAR_MAX, k));
        let session = placed.session.zip(placed.session_max).map(|(w, max)| {
            let left = placed.sidebar.map_or(0.0, |s| s + GAP) + w;
            self.handle(Edge::Session, left, w, SESSION_MIN, max, k)
        });
        sidebar.into_iter().chain(session).collect()
    }

    /// A handle `GAP` wide whose left edge is `left` points into the row, for a pane `width` wide that
    /// drags from `min` to `max`.
    fn handle(&self, edge: Edge, left: f32, width: f32, min: f32, max: f32, k: &Kit) -> El {
        let held = self.held.is_some_and(|(e, _)| e == edge);
        let pill = el().w(PILL.0).h(PILL.1).radius(PILL.0 / 2.0);
        let pill = if held { pill.fill(k.c.icon_base) } else { pill.fill(k.c.icon_muted).group_opacity(0.0, 1.0) };
        let (key, label) = match edge {
            Edge::Sidebar => ("sidebar-handle", "Resize sidebar"),
            Edge::Session => ("session-handle", "Resize view pane"),
        };
        let ease = Easing::CubicBezier(CubicBezier::new(0.2, 0.8, 0.2, 1.0));
        let show = Anim { delay: PILL_DELAY, ..Anim::new(Curve::tween(PILL_IN, ease)) };
        let hide = Anim::new(Curve::tween(PILL_OUT, Easing::CubicBezier(CubicBezier::new(0.4, 0.0, 1.0, 1.0))));
        col()
            .key(key)
            .role("separator")
            .label_static(label)
            .range_value(f64::from(width), f64::from(min), f64::from(max))
            .pin(Some(left), Some(0.0), None, Some(0.0))
            .w(GAP)
            .center()
            .cursor(Cursor::ResizeColumn)
            .hover_group()
            .hover_motion(show, hide)
            .on_drag(move |s: &mut Comet, d: &mut Drag, _: &mut Tx| s.panes.drag(edge, d, width, min, max, &s.core))
            .child(pill)
    }

    /// Follows a drag on `edge`'s handle, from a pane `start` wide, held between `min` and `max`. The core
    /// saves the widths when a drag that changed them ends.
    fn drag(&mut self, edge: Edge, d: &mut Drag, start: f32, min: f32, max: f32, core: &Core) {
        match d.phase {
            Phase::Down => {
                self.held = Some((edge, self.widths));
                d.data = start;
            }
            Phase::Move => {
                let width = Some((d.data + d.dx).clamp(min, max));
                match edge {
                    Edge::Sidebar => self.widths.sidebar = width,
                    Edge::Session => self.widths.session = width,
                }
            }
            Phase::Up => {
                let Some((_, before)) = self.held.take() else { return };
                if d.cancelled() {
                    self.widths = before;
                } else if self.widths != before {
                    core.send(&ClientMessage::WidthsSave { widths: self.widths });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn panes(sidebar: Option<f32>, session: Option<f32>) -> Panes {
        Panes { widths: PaneWidths { sidebar, session }, held: None }
    }

    #[test]
    fn an_undragged_session_shares_the_row_with_the_view_pane() {
        let placed = panes(None, None).place(Some(1208.0), false, true);
        assert_eq!(placed.session, Some(600.0));
        assert_eq!(panes(None, None).place(None, false, true).session, None);
        // Before the row is measured, a dragged session keeps its width, so the first frame does not jump.
        assert_eq!(panes(None, Some(700.0)).place(None, false, true).session, Some(700.0));
    }

    #[test]
    fn a_dragged_session_keeps_its_width_and_leaves_the_view_pane_its_minimum() {
        assert_eq!(panes(None, Some(700.0)).place(Some(1208.0), false, true).session, Some(700.0));
        // 1208 less the gap leaves 1200, and the view pane keeps 320 of it.
        assert_eq!(panes(None, Some(1100.0)).place(Some(1208.0), false, true).session, Some(880.0));
        assert_eq!(panes(None, Some(100.0)).place(Some(1208.0), false, true).session, Some(SESSION_MIN));
        // A window too narrow for both minimums keeps the session's.
        assert_eq!(panes(None, Some(700.0)).place(Some(600.0), false, true).session, Some(SESSION_MIN));
    }

    #[test]
    fn the_sidebar_holds_between_its_bounds_and_takes_its_room_from_the_session() {
        let placed = panes(Some(900.0), Some(2000.0)).place(Some(1500.0), true, true);
        assert_eq!(placed.sidebar, Some(SIDEBAR_MAX));
        // 1500 less the sidebar and two gaps leaves 844, and the view pane keeps 320 of it.
        assert_eq!(placed.session, Some(524.0));
        assert_eq!(panes(Some(10.0), None).place(Some(1500.0), true, false).sidebar, Some(SIDEBAR_MIN));
        assert_eq!(panes(None, None).place(Some(1500.0), true, false).sidebar, Some(SIDEBAR_WIDTH));
    }

    #[test]
    fn a_closed_view_pane_gives_the_session_the_row() {
        let placed = panes(None, Some(700.0)).place(Some(1208.0), true, false);
        assert_eq!(placed.session, None);
    }
}
