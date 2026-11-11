//! The window's tabs, as the Electron app's `TabBar` in `app.tsx` draws them: 210 point tabs with the
//! project's mark, the title in 12 point text and a spinner while Claude works, and a close button
//! on the active tab and the one under the pointer. Rune's TabStrip sets its titles in the kit's
//! medium weight and shrinks its tabs to fit, so Desk draws its own, as the Electron app does.

use crate::shell::{Desk, project_mark};
use crate::workspace::Place;
use rune::{Color, Drag, El, Phase, Tx, el, row, text};
use rune_kit::{ControlSize, IconButton, IconButtonVariant, Kit, Spinner};
use rune_theme_opencode::icons as ic;

const TAB_WIDTH: f32 = 210.0;
const TAB_HEIGHT: f32 = 32.0;
const TAB_RADIUS: f32 = 8.0;
/// The space between tabs, and around the strip.
const GAP: f32 = 4.0;
/// How far a pressed tab moves before it drags. A press that moves less stays a click.
const DRAG_THRESHOLD: f32 = 4.0;
/// The title fades out over its last fifth when it runs long, as `.desk-fade-end` masks it.
const TITLE_FADE: f32 = 30.0;

/// The tab being dragged, and the tab the strip last scrolled to.
#[derive(Default)]
pub struct TabBar {
    dragging: Option<String>,
    shown: Option<String>,
}

/// Keeps the active tab in sight: a tab opened, reopened or chosen past the strip's edge scrolls in,
/// as the Electron app's tab bar does.
pub fn follow_active(s: &mut Desk, tx: &mut Tx) {
    if s.workspace.active != s.tab_bar.shown {
        s.tab_bar.shown = s.workspace.active.clone();
        if let Some(id) = &s.tab_bar.shown {
            tx.scroll_into_view_in("tabs", format!("tab-{id}"));
        }
    }
}

/// The strip of tabs and the new tab button, for the window's title bar.
pub fn tab_bar(s: &Desk, k: &Kit) -> El {
    let w = &s.workspace;
    // Settings show in place of the active tab, so while they are open no tab is marked active.
    let shown = w.active.as_deref().filter(|_| w.settings_page.is_none());
    let count = w.tabs.len();
    let tabs = w.tabs.iter().enumerate().map(|(index, tab)| {
        let active = shown == Some(tab.id.as_str());
        let busy = s.threads.get(&tab.id).is_some_and(|t| t.busy);
        let close_id = tab.id.clone();
        let close = IconButton::new(&ic::XMARK_SMALL)
            .variant(IconButtonVariant::GhostMuted)
            .control_size(ControlSize::Small)
            .label("Close tab")
            .on_press_tx(move |s: &mut Desk, tx: &mut Tx| s.close_tab(&close_id, tx))
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
            .child(project_mark(s, &tab.project, k))
            .child(title)
            .children(busy.then(|| Spinner::new().size(14.0).color(k.c.text_accent).build(k)));
        let id = tab.id.clone();
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
            .opacity(if s.tab_bar.dragging.as_deref() == Some(tab.id.as_str()) { 0.7 } else { 1.0 })
            .on_drag(move |s: &mut Desk, d: &mut Drag, _: &mut Tx| drag(s, &id, index, count, d))
            .child(body)
            .child(close);
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
        .on_press_tx(|s: &mut Desk, tx: &mut Tx| s.new_tab(if s.cmd_held() { Place::Next } else { Place::End }, None, tx))
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

/// A press that moves past the threshold drags the tab: it takes the place of the tabs it passes the
/// middle of, as the Electron app's `dropIndex` places it. A press that does not move selects the tab.
fn drag(s: &mut Desk, id: &str, index: usize, count: usize, d: &mut Drag) {
    let pitch = TAB_WIDTH + GAP;
    match d.phase {
        // The tab's place at the press, as the drag moves it.
        Phase::Down => d.data = index as f32,
        Phase::Move => {
            if s.tab_bar.dragging.is_none() && d.dx.abs() < DRAG_THRESHOLD {
                return;
            }
            s.tab_bar.dragging = Some(id.to_owned());
            // The pointer's place in the strip, and the middles of the other tabs, which sit one pitch apart.
            let pointer = d.data * pitch + d.start_x + d.dx;
            let to = ((pointer - TAB_WIDTH / 2.0) / pitch).floor() + 1.0;
            let to = (to.max(0.0) as usize).min(count.saturating_sub(1));
            if let Some(from) = s.workspace.tabs.iter().position(|t| t.id == id)
                && from != to
            {
                s.workspace.move_tab(from, to, &s.core);
            }
        }
        Phase::Up => {
            let dragged = s.tab_bar.dragging.take().is_some();
            if !dragged && !d.cancelled() {
                s.show_tab(id);
            }
        }
    }
}
