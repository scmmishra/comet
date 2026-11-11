//! A new tab, as `app/src/renderer/start-screen.tsx` draws it: the wordmark, the composer, the project and
//! branch it works in, and threads to pick up again.

use crate::composer;
use crate::format;
use crate::protocol::{ClientMessage, TabInfo, ThreadSummary};
use crate::shell::{self, Desk};
use crate::cards::Lane;
use crate::workspace::Place;
use rune::{El, ScrollSpec, col, icon, row, text};
use rune_kit::{Kit, Menu, MenuItem, Placement};
use rune_theme_opencode::icons as ic;

/// Threads the start screen offers to pick up again.
const RECENT_THREADS: usize = 8;
/// The wordmark is a fifth of the window's width, from 120 to 240 points, `clamp(120px, 20vw, 240px)`.
const WORDMARK_SIZES: (f32, f32) = (120.0, 240.0);
/// The screen starts 6% of the window's height down, `pt-[6vh]`.
const TOP: f32 = 0.06;
/// How strongly the wordmark shows over the panel, `color-mix(… 9.6%)`.
const WORDMARK_ALPHA: f32 = 0.096;

impl Desk {
    /// Continues a past thread: in its tab if one has it open, else in the active tab when that tab works
    /// in the project and has not started a thread, else in a new tab.
    pub fn open_thread(&mut self, thread: &ThreadSummary, project: &str, tx: &mut rune::Tx) {
        if let Some(tab) = &thread.tab_id {
            return self.workspace.show_tab(tab, &self.core);
        }
        let active = self.workspace.active_tab().filter(|t| t.project == project && self.threads.get(&t.id).is_none_or(|th| th.items.is_empty())).map(|t| t.id.clone());
        let tab = match active {
            Some(tab) => tab,
            None => match self.workspace.new_tab(Place::End, Some(project.to_owned()), &self.account, &self.core) {
                Ok(tab) => tab,
                Err(_) => return shell::open_folder(tx),
            },
        };
        self.workspace.show_tab(&tab, &self.core);
        self.workspace.name_tab(&tab, &thread.title, &self.core);
        self.core.send(&ClientMessage::ThreadResume { tab_id: tab, thread_id: thread.id.clone() });
        self.core.send(&ClientMessage::ProjectGet { project: project.to_owned(), part: "threads".into() });
    }
}

/// A new tab, on the thread's lane: the wordmark, the composer, the project and branch it works in, and threads to pick up again.
pub fn start_screen(s: &Desk, tab: &TabInfo, lane: Option<Lane>, window: Option<[f32; 2]>, k: &Kit, layer: &mut Vec<El>) -> El {
    let [width, height] = window.unwrap_or([1280.0, 820.0]);
    let size = (width * 0.2).clamp(WORDMARK_SIZES.0, WORDMARK_SIZES.1);
    let wordmark = text("desk")
        .font(rune::TextStyle { size, weight: 600.0, line_height: size, tracking: -0.06 * size, ..k.ty.body })
        .color(k.c.text_base.alpha(WORDMARK_ALPHA))
        .a11y_hidden()
        .mb(-18.0 - 0.26 * size);
    let project = s.projects.get(&tab.project);
    let branch = project.and_then(|p| p.space.as_ref()).map(|space| {
        row()
            .gap(4.0)
            .items_center()
            .child(text("/").font(crate::theme::text(13.0)).color(k.c.text_faint))
            .child(row().gap(6.0).items_center().px(6.0).child(icon(&ic::BRANCH, 15.0).color(k.c.text_muted)).child(text(space.branch.clone()).font(crate::theme::text(13.0)).color(k.c.text_muted)))
    });
    let place = row().gap(4.0).items_center().px(2.0).child(project_switcher(s, tab, k, layer)).children(branch);
    let content = col()
        .w_full()
        .gap(18.0)
        .child(row().w_full().justify_center().child(wordmark))
        .child(composer::composer(s, tab, composer::ListAt::Below, k, layer))
        .child(place)
        .children(recent_threads(s, tab, k));
    col().key(format!("start-{}", tab.id)).w_full().grow(1.0).min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).pt(TOP * height).pb(24.0).child(crate::thread_view::in_lane(content, lane))
}

/// Moves this tab to another project. Its thread has not started, so nothing is lost.
fn project_switcher(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let name = s.account.project_label(&tab.project);
    let trigger = row()
        .key("project-switcher")
        .h(32.0)
        .gap(8.0)
        .items_center()
        .px(6.0)
        .radius(8.0)
        .hover(k.c.hover)
        .role("button")
        .on_press(|s: &mut Desk| s.start.project_menu = !s.start.project_menu)
        .child(shell::project_mark(s, &tab.project, k))
        .child(text(name).font(crate::theme::text(13.0)).color(k.c.text_muted))
        .child(icon(&ic::CHEVRON_DOWN, crate::icons::SIZE).color(k.c.text_faint));
    let mut menu = Menu::new("project-menu").trigger(trigger).open(s.start.project_menu).placement(Placement::BottomStart).gutter(8.0).min_width(280.0).group_label("Projects").on_close(|s: &mut Desk| s.start.project_menu = false);
    for project in &s.workspace.recent {
        let (id, dir) = (tab.id.clone(), project.clone());
        // Each project with its mark, as the Electron app's switcher shows it.
        menu = menu.item(MenuItem::new(s.account.project_label(project)).lead(shell::project_mark(s, project, k)).checked(*project == tab.project).on_select(move |s: &mut Desk| {
            let dir = dir.clone();
            s.workspace.change_tab(&id, |t| t.project = dir, &s.core);
            s.start.project_menu = false;
            s.read_start();
        }));
    }
    let id = tab.id.clone();
    menu.separator()
        .item(MenuItem::new("Open folder…").on_select_tx(move |s: &mut Desk, tx| {
            s.start.project_menu = false;
            let id = id.clone();
            tx.open_folder(rune::FileDialogOptions { title: "Open Folder".into(), ..Default::default() }, move |s: &mut Desk, result, _| {
                if let Ok(Some(dir)) = result {
                    let dir = dir.to_string_lossy().into_owned();
                    s.workspace.change_tab(&id, |t| t.project = dir, &s.core);
                    s.read_start();
                }
            });
        }))
        .build(k, layer)
}

/// Threads in this tab's project that no tab has open. Picking one continues it in this tab.
fn recent_threads(s: &Desk, tab: &TabInfo, k: &Kit) -> Option<El> {
    let project = s.projects.get(&tab.project)?;
    let closed: Vec<&ThreadSummary> = project.threads.as_ref()?.iter().filter(|t| t.tab_id.is_none()).take(RECENT_THREADS).collect();
    if closed.is_empty() {
        return None;
    }
    let current = project.space.as_ref().map(|space| space.branch.as_str());
    let now = format::now_ms();
    let rows = closed.into_iter().map(|thread| {
        // A thread's branch shows when it differs from the branch the project is on now.
        let other = thread.branch.as_deref().filter(|b| Some(*b) != current).map(|b| {
            row().gap(4.0).items_center().child(icon(&ic::BRANCH, crate::icons::SIZE).color(k.c.text_faint)).child(text(b.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_faint))
        });
        let (summary, dir) = (thread.clone(), tab.project.clone());
        row()
            .key(format!("thread-{}", thread.id))
            .h(36.0)
            .w_full()
            .gap(12.0)
            .items_center()
            .px(8.0)
            .radius(7.0)
            .hover(k.c.hover)
            .hover_group()
            .role("button")
            .on_press_tx(move |s: &mut Desk, tx| s.open_thread(&summary, &dir, tx))
            .child(text(thread.title.clone()).font(crate::theme::text(13.0)).color(k.c.text_muted).group_color(k.c.text_base).truncate().grow(1.0))
            .children(other)
            // `w-12 text-right`: times end on one edge, whatever their length.
            .child(row().w(48.0).justify_end().child(text(format::ago(thread.updated_at, now)).font(crate::theme::text(12.0)).color(k.c.text_faint)))
    });
    Some(col().w_full().gap(4.0).pt(8.0).child(text("Recent threads").font(crate::theme::text(12.0)).color(k.c.text_faint).px(8.0).pb(4.0)).children(rows))
}

/// What the start screen has open.
#[derive(Default)]
pub struct Start {
    project_menu: bool,
    /// The tab whose project the start screen last read, so switching back reads it again.
    read_for: Option<String>,
}

impl Desk {
    /// Reads the active tab's project for the start screen whenever another tab comes to the front.
    pub fn sync_start(&mut self) {
        let Some(tab) = self.workspace.active_tab() else { return };
        if self.start.read_for.as_deref() == Some(tab.id.as_str()) {
            return;
        }
        self.start.read_for = Some(tab.id.clone());
        self.read_start();
    }

    /// Asks the core for what the start screen shows about the active tab's project.
    pub fn read_start(&mut self) {
        let Some(tab) = self.workspace.active_tab() else { return };
        for part in crate::projects::START_PARTS {
            self.core.send(&ClientMessage::ProjectGet { project: tab.project.clone(), part: part.into() });
        }
    }
}
