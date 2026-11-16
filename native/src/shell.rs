//! The window: the tab bar, which doubles as the title bar, and the main panel under it.

use crate::account::Account;
use crate::composer::{self, Drafts};
use crate::core::{Core, Event};
use crate::format;
use crate::protocol::{ClientMessage, CoreMessage, TabInfo, ThemeChoice, ThreadRow};
use crate::theme;
use crate::thread_view;
use crate::threads::Threads;
use crate::workspace::{NeedsFolder, Place, Workspace};
use rune::{Color, Cx, El, FileDialogOptions, Tx, col, row, text};
use std::time::Duration;
use rune_kit::shell::WindowTitlebar;

/// The tab bar's height. The window's buttons sit centred in it.
pub const TITLEBAR_HEIGHT: f32 = 44.0;
/// The ground shown around the main panel, on its sides and below it.
const PANEL_INSET: f32 = 8.0;
/// The panel toggle's place in the session header's corner, from its top and its right. It is where the
/// pane's header puts the toggle, so the toggle stays put when the pane opens and lines up with the
/// header's other buttons.
const TOGGLE_INSET: (f32, f32) = (9.0, 10.0);
/// How fast Rune's animations run: 1.2 plays every entry, exit and fade in five sixths of its time.
/// Scrolling and growing lists keep their own pace.
const ANIMATION_SPEED: f32 = 1.2;
/// The main panel's corners, Desk's `rounded-3xl`.
const PANEL_RADIUS: f32 = 12.0;
/// How far Settings' card sits below the top of the main panel, so the tab's card shows behind its top edge.
const SETTINGS_TOP: f32 = 16.0;
/// How far Settings' card slides up as it opens, and down as it closes.
const SETTINGS_TRAVEL: f32 = 48.0;
/// The tab's card behind Settings: pushed back, so its top edge peeks out above Settings' card, and dimmed.
const COVERED_SCALE: f32 = 0.98;
const COVERED_OPACITY: f32 = 0.7;
/// A plugin's sidebar, `w-[320px]`.
const SIDEBAR_WIDTH: f32 = 320.0;
/// The session's header, `h-[46px]`.
const HEADER_HEIGHT: f32 = 46.0;
/// A project's mark. `@opencode/ui`'s avatar is 16 points: its CSS, outside Tailwind's layers, beats the
/// header's `size-[18px]`.
const PROJECT_MARK: f32 = 16.0;

#[derive(Debug, Default, PartialEq)]
pub enum CoreState {
    #[default]
    Starting,
    Ready,
    Failed(String),
}

#[derive(Default)]
pub struct Desk {
    pub core: Core,
    pub status: CoreState,
    pub account: Account,
    pub workspace: Workspace,
    pub threads: Threads,
    pub drafts: Drafts,
    pub picker: crate::model_picker::Picker,
    pub projects: crate::projects::Projects,
    pub start: crate::start_screen::Start,
    pub images: crate::images::Images,
    pub panel: crate::panel::Panel,
    pub terminals: crate::terminal_view::Terminals,
    /// The message whose copy button shows a check, and since when.
    pub copied: Option<(String, std::time::Instant)>,
    /// The wall clock, in milliseconds since the epoch, as of the last tick. It ticks each second
    /// while a turn runs, for the working head.
    pub now_ms: f64,
    pub toasts: crate::toasts::Toasts,
    pub palette: crate::palette::Palette,
    pub cards: crate::cards::Cards,
    pub commands_card: crate::commands_card::CommandsCard,
    pub meters: crate::meters::Meters,
    pub extensions: crate::extensions::Extensions,
    pub minimap: crate::minimap::Minimap,
    pub plugins: crate::plugins::Plugins,
    pub settings: crate::settings::SettingsUi,
    /// Whether ⌘ is held, so the new tab button opens its tab next to the active one.
    cmd_held: bool,
    pub tab_bar: crate::tab_bar::TabBar,
    pub session_menu: crate::session_menu::SessionMenu,
    pub rewind: crate::rewind::Rewind,
    pub branch_notices: crate::branch_notice::BranchNotices,
    pub worktrees: crate::worktrees::Worktrees,
}

impl Desk {
    pub fn new(core: Core) -> Desk {
        Desk { core, drafts: Drafts::load(), ..Desk::default() }
    }

    /// Takes what the core said. An empty window with no project needs a folder, which the caller asks for.
    pub fn receive(&mut self, event: Event) -> Result<(), NeedsFolder> {
        match event {
            Event::Ready => self.status = CoreState::Ready,
            Event::Failed(reason) => self.status = CoreState::Failed(reason),
            Event::Message(message) => return self.read(message),
        }
        Ok(())
    }

    /// Takes what the core said, as the event loop runs it, asking for a folder when one is needed.
    pub fn receive_in(&mut self, event: Event, tx: &mut Tx) {
        let settings = matches!(event, Event::Message(CoreMessage::Settings { .. }));
        let files = matches!(event, Event::Message(CoreMessage::FilesFound { .. }));
        if self.receive(event).is_err() {
            open_folder(tx);
        }
        if files {
            self.pick_waiting_file(tx);
        }
        // Rune does nothing when the families have not changed.
        if settings {
            let (sans, mono) = self.account.font_families();
            tx.set_font_families(sans, mono);
        }
    }

    fn read(&mut self, message: CoreMessage) -> Result<(), NeedsFolder> {
        let (w, account, core) = (&mut self.workspace, &self.account, &self.core);
        let mut result = Ok(());
        match message {
            CoreMessage::Settings { settings } => self.account.settings = Some(settings),
            CoreMessage::Agents { agents } => self.account.agents = agents,
            CoreMessage::Recent { projects } => w.recent = projects,
            CoreMessage::Tabs { tabs, active } => {
                result = w.restore(tabs, active, account, core);
                self.reload_layouts();
            }
            CoreMessage::TabReopened { tab, index } => w.reopened(tab, index, core),
            CoreMessage::TabTitle { tab_id, title } => w.name_tab(&tab_id, &title, core),
            CoreMessage::ThreadSession { tab_id, session_id, agent } => {
                self.threads.get_mut(&tab_id).session_id = session_id;
                // A started thread keeps the agent it started on, so the tab follows it.
                if let Some(agent) = agent.filter(|a| w.tabs.iter().any(|t| t.id == tab_id && t.agent != *a)) {
                    w.set_agent(&tab_id, &agent, account, core);
                }
            }
            CoreMessage::ThreadForked { tab_id, agent, thread_id, title } => self.open_fork(&tab_id, &agent, thread_id, &title),
            CoreMessage::ThreadBranch { tab_id, branch } => self.threads.get_mut(&tab_id).branch = branch,
            CoreMessage::WorktreeCreated { tab_id, project } => self.worktree_created(&tab_id, project),
            CoreMessage::WorktreeRemoved { tab_id } => result = w.close_tab(&tab_id, account, core),
            CoreMessage::TabMoved { tab_id, project } => self.move_tab(&tab_id, project),
            CoreMessage::SessionHistory { tab_id, items, context } => {
                for item in &items {
                    self.remember_images(item);
                }
                self.threads.history(&tab_id, items, context);
            }
            CoreMessage::SessionRows { tab_id, rows } => self.threads.rows(&tab_id, rows),
            CoreMessage::SessionEvent { tab_id, event } => {
                if let crate::protocol::ThreadEvent::Item { item } = &event {
                    self.remember_images(item);
                    // A finished turn may have changed files, so Review reads them again.
                    if matches!(item, crate::protocol::ThreadItem::Result { .. }) {
                        self.turn_ended(&tab_id);
                    }
                }
                self.threads.apply(&tab_id, event);
            }
            CoreMessage::Queue { tab_id, messages, held } => {
                for image in messages.iter().flat_map(|m| &m.images) {
                    self.images.remember(image);
                }
                self.threads.queue(&tab_id, messages, held);
            }
            CoreMessage::Project { project, part, value } => {
                if part == "space" {
                    self.branch_notices.space_read(&project);
                }
                self.projects.read(project, &part, value);
            }
            CoreMessage::Mcp { project, agent, servers } => self.projects.read_mcp(project, agent, servers),
            CoreMessage::FilesFound { project, query, paths } => self.found_files(project, query, paths),
            CoreMessage::Review { tab_id, scope, files } => self.take_review(tab_id, scope, files),
            CoreMessage::TerminalOutput { id, data } => self.terminal_output(&id, &data),
            CoreMessage::TerminalExit { id } => self.terminal_exit(&id),
            CoreMessage::File { project, path, file } => self.take_file(project, path, file),
            CoreMessage::PluginOps { plugin, ops, reset } => self.plugins.apply(&plugin, &ops, reset),
            CoreMessage::Layout { tab_id, layout } => {
                self.plugins.layouts.insert(tab_id, layout);
            }
            CoreMessage::PanelShow { tab_id, id } => self.panel_shown(&tab_id, &id),
            CoreMessage::Setups { setups } => self.plugins.setups = setups,
            CoreMessage::Error { message, detail } => {
                self.branch_notices.failed();
                self.worktree_failed();
                self.toasts.error(message, detail);
            }
            CoreMessage::Notice { message } => self.toasts.show(message, false),
            CoreMessage::Other => {}
        }
        let tabs: Vec<String> = self.workspace.tabs.iter().map(|t| t.id.clone()).collect();
        self.threads.keep(&tabs);
        self.sync_start();
        self.sync_panel();
        result
    }

    /// Opens a tab, or asks for a folder when the window has no project yet.
    pub fn new_tab(&mut self, place: Place, project: Option<String>, tx: &mut Tx) {
        if let Err(NeedsFolder) = self.workspace.new_tab(place, project, &self.account, &self.core) {
            open_folder(tx);
        }
        self.sync_start();
    }

    /// Brings a tab to the front, reading what its start screen and pane show.
    pub fn show_tab(&mut self, id: &str) {
        self.workspace.show_tab(id, &self.core);
        self.sync_start();
        self.sync_panel();
    }

    pub fn close_tab(&mut self, id: &str, tx: &mut Tx) {
        if let Err(NeedsFolder) = self.workspace.close_tab(id, &self.account, &self.core) {
            open_folder(tx);
        }
        self.sync_start();
    }

    fn remember_images(&mut self, item: &crate::protocol::ThreadItem) {
        if let crate::protocol::ThreadItem::User { images, .. } = item {
            for image in images {
                self.images.remember(image);
            }
        }
    }

    pub fn cmd_held(&self) -> bool {
        self.cmd_held
    }

    /// Answers a permission request in a tab.
    pub fn answer_permission(&self, tab: &str, request_id: &str, answer: &str) {
        self.core.send(&ClientMessage::PermissionAnswer { tab_id: tab.to_owned(), request_id: request_id.to_owned(), answer: answer.to_owned() });
    }

    /// Whether the active tab's turn, its stop, a background command or a subagent runs, so the times they show
    /// count seconds. A subagent can run on after the turn that started it has ended.
    fn ticking(&self) -> bool {
        let thread = self.workspace.active.as_deref().and_then(|tab| self.threads.get(tab));
        thread.is_some_and(|t| {
            !t.background.is_empty()
                || t.stopping.is_some()
                || t.subagents.iter().any(|x| x.status == "running")
                || t.rows.iter().any(|r| matches!(r, ThreadRow::Working { .. }))
        })
    }

    fn dark(&self, cx: &Cx<Desk>) -> bool {
        match self.account.theme() {
            ThemeChoice::Dark => true,
            ThemeChoice::Light => false,
            ThemeChoice::Auto => cx.system_dark(),
        }
    }
}

/// Asks for a folder and opens a tab in it.
pub fn open_folder(tx: &mut Tx) {
    let options = FileDialogOptions { title: "Open Folder".into(), ..Default::default() };
    tx.open_folder(options, |s: &mut Desk, result, tx| match result {
        Ok(Some(dir)) => s.new_tab(Place::End, Some(dir.to_string_lossy().into_owned()), tx),
        Ok(None) => {}
        Err(e) => s.toasts.show(e.to_string(), true),
    });
}

/// What the menus run.
pub mod commands {
    use super::*;

    pub fn new_session(s: &mut Desk, tx: &mut Tx) {
        s.new_tab(Place::End, None, tx);
    }

    pub fn open_folder(_: &mut Desk, tx: &mut Tx) {
        super::open_folder(tx);
    }

    /// Closes the tab, or Settings while they cover it.
    pub fn close_tab(s: &mut Desk, tx: &mut Tx) {
        if s.workspace.settings_page.is_some() {
            s.close_settings();
            return;
        }
        if let Some(id) = s.workspace.active.clone() {
            s.close_tab(&id, tx);
        }
    }

    pub fn reopen_tab(s: &mut Desk, _: &mut Tx) {
        s.core.send(&ClientMessage::TabReopen);
    }

    /// Starts every plugin again from its files, so an edit takes effect without restarting Desk.
    pub fn reload_plugins(s: &mut Desk, _: &mut Tx) {
        s.core.send(&ClientMessage::PluginsReload);
    }

    /// ⌘1 to ⌘9: a model while the model picker is open, else a tab.
    pub fn show_tab<const INDEX: usize>(s: &mut Desk, _: &mut Tx) {
        if s.pick_model_by_number(INDEX) {
            return;
        }
        s.workspace.show_tab_at(INDEX, &s.core);
        s.sync_start();
        s.sync_panel();
    }

    pub fn toggle_panel(s: &mut Desk, _: &mut Tx) {
        s.toggle_panel();
    }

    pub fn new_terminal(s: &mut Desk, _: &mut Tx) {
        s.new_terminal();
    }

    pub fn settings(s: &mut Desk, tx: &mut Tx) {
        s.open_settings("providers");
        tx.focus("settings", false);
    }

    pub fn palette(s: &mut Desk, tx: &mut Tx) {
        s.toggle_palette(Vec::new(), tx);
    }

    /// The palette, opened on the active project's threads.
    pub fn search_threads(s: &mut Desk, tx: &mut Tx) {
        let pages = s.workspace.active_tab().map(|t| crate::palette::Page::Threads(t.project.clone())).into_iter().collect();
        s.toggle_palette(pages, tx);
    }

    /// The palette, opened on the active project's files.
    pub fn search_files(s: &mut Desk, tx: &mut Tx) {
        let pages = s.workspace.active_tab().map(|t| crate::palette::Page::Files(t.project.clone())).into_iter().collect();
        s.toggle_palette(pages, tx);
    }
}

/// Ticks the clock each second while something with a timer runs. A still window does no work.
pub fn poll(s: &mut Desk, _: f64, tx: &mut Tx) -> bool {
    s.sync_palette();
    s.sync_plugin_inputs();
    s.sync_branch_notice();
    crate::tab_bar::follow_active(s, tx);
    let composed = composer::poll(s, tx) | copied_poll(s, tx) | toasts_poll(s, tx) | crate::terminal_view::poll(s, tx) | crate::thread_view::poll(s, tx);
    if s.status == CoreState::Ready {
        let next = s.refresh_usage();
        tx.wake_after(next);
    }
    if !s.ticking() {
        return composed;
    }
    let now = format::now_ms();
    let ticked = (now / 1000.0).floor() != (s.now_ms / 1000.0).floor();
    s.now_ms = now;
    tx.wake_after(Duration::from_millis(1000 - (now as u64 % 1000)));
    ticked || composed
}

/// Takes toasts down when their time is up.
fn toasts_poll(s: &mut Desk, tx: &mut Tx) -> bool {
    let (changed, next) = s.toasts.expire();
    if let Some(next) = next {
        tx.wake_after(next);
    }
    changed
}

/// How long a copy button says it copied.
const COPIED: Duration = Duration::from_millis(1500);

/// Turns a copy button's check back after a while.
fn copied_poll(s: &mut Desk, tx: &mut Tx) -> bool {
    let Some((_, at)) = &s.copied else { return false };
    if at.elapsed() >= COPIED {
        s.copied = None;
        return true;
    }
    tx.wake_after(COPIED - at.elapsed());
    false
}

/// A `desk://open?dir=` link, as `bin/desk` opens it: the folder opens in a new tab.
pub fn open_url(s: &mut Desk, url: &str, _: &mut Tx) {
    let Some(dir) = crate::opening::folder_from_url(url) else { return };
    s.workspace.open_asked(dir, &s.account, &s.core);
    s.sync_start();
}

/// The input method, for the editors Desk draws itself. Text fields hear it on their own.
pub fn ime(s: &mut Desk, event: &rune::Ime, _: &mut Tx) -> bool {
    s.terminal_ime(event)
}

/// Hears the modifier keys held down each time they change.
pub fn modifiers(s: &mut Desk, mods: rune::Mods, _: &mut Tx) {
    s.cmd_held = mods.cmd;
}

pub fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    cx.time_scale(ANIMATION_SPEED);
    theme::use_color_theme(s.account.color_theme());
    let k = theme::kit(s.dark(cx));
    let mut layer = Vec::new();
    let w = &s.workspace;
    // The title bar: its tabs start 84 points in, past the window's buttons, and it ends 10 points in.
    let titlebar = WindowTitlebar::from_insets(cx.chrome_insets()).leading_padding(8.0).trailing_padding(10.0).gap(4.0).tabs(crate::tab_bar::tab_bar(s, k));
    let titlebar = match crate::meters::usage_button(s, k, &mut layer) {
        Some(usage) => titlebar.trailing(usage),
        None => titlebar,
    }
    .build(k);

    let dark = s.dark(cx);
    let line = |words: String| text(words).font(crate::theme::text(13.0)).color(k.c.text_muted);
    // A card on the ground: the session, and the view pane beside it while open.
    let card = |key: &str, child: El| col().key(key.to_owned()).w_frac(1.0).grow(1.0).shrink().min_w(0.0).h_full().min_h(0.0).fill(k.c.bg_base).radius(PANEL_RADIUS).clip_rounded(PANEL_RADIUS).border(1.0, k.c.border_muted).padding(1.0).child(child);
    let settings_open = s.status == CoreState::Ready && w.settings_page.is_some();
    let cards = match (&s.status, w.active_tab()) {
        (CoreState::Ready, Some(tab)) => {
            // A session under Settings draws no popovers: they would show on top of Settings.
            let mut covered = Vec::new();
            let layer = if settings_open { &mut covered } else { &mut layer };
            // The room inside the card's border, which the lane and the rail are placed in.
            let size = cx.layout_size("session-body");
            let window = cx.layout_size("window");
            let session = col().key("session-body").w_full().h_full().min_h(0.0).child(session(s, tab, dark, size, window, layer));
            let pane = (tab.panel_open == Some(true)).then(|| card("panel-card", crate::panel::panel(s, tab, k, layer)));
            // A plugin's sidebar sits before the session, as a card of its own.
            let sidebar = s.plugins.layouts.get(&tab.id).and_then(|l| l.sidebar.as_ref()).map(|view| {
                col().key("sidebar").w(SIDEBAR_WIDTH).h_full().min_h(0.0).padding(9.0).radius(PANEL_RADIUS).clip_rounded(PANEL_RADIUS).fill(k.c.layer_01).border(1.0, k.c.border_muted).child(crate::plugins::view(s, view, &tab.project, crate::plugins::Frame::Pane, k))
            });
            row().w_full().grow(1.0).min_h(0.0).gap(PANEL_INSET).children(sidebar).child(card("session-card", session)).children(pane)
        }
        (status, _) => {
            let words = match status {
                CoreState::Starting => line("Starting…".into()),
                CoreState::Failed(reason) => text(reason.clone()).font(crate::theme::text(13.0)).color(k.c.danger.fg),
                // The core is up before it sends the saved tabs. Until they arrive, the card waits empty.
                CoreState::Ready if !s.workspace.restored() => rune::el(),
                CoreState::Ready => line("No tabs".into()),
            };
            row().w_full().grow(1.0).min_h(0.0).child(card("body", col().w_full().h_full().center().child(words.key("status"))))
        }
    };
    // Settings slide up as a card over the tab. The tab stays drawn behind them, pushed back and dimmed,
    // so going back shows it at once.
    let cards = if settings_open { cards.key("ground").scale(COVERED_SCALE).opacity(COVERED_OPACITY).inert() } else { cards.key("ground") };
    let settings = settings_open.then(|| {
        col()
            .key("settings-card")
            .pin(Some(PANEL_INSET), Some(SETTINGS_TOP), Some(PANEL_INSET), Some(PANEL_INSET))
            .fill(k.c.bg_base)
            .radius(PANEL_RADIUS)
            .clip_rounded(PANEL_RADIUS)
            .border(1.0, k.c.border_muted)
            .padding(1.0)
            .transition(rune::Transition::offset(0.0, SETTINGS_TRAVEL).combined(rune::Transition::opacity()))
            .child(crate::settings::screen(s, k, &mut layer))
    });
    let main = col().key("main").w_full().grow(1.0).min_h(0.0).px(PANEL_INSET).pb(PANEL_INSET).child(cards).children(settings);
    crate::palette::palette(s, cx.layout_size("window").map_or(820.0, |size| size[1]), k, &mut layer);
    layer.extend(crate::toasts::region(s, k));
    // Coming back to the window is when files and usage most likely changed outside Desk. Plugins hear of
    // both gaining and losing focus, so they can pause work while Desk is in the background.
    let window = col()
        .key("window")
        .w_full()
        .h_full()
        .fill(k.c.bg_deep)
        .child(titlebar)
        .child(main)
        .on_window_focus(|s: &mut Desk, focused, _| {
        if s.status == CoreState::Ready {
            s.core.send(&ClientMessage::WindowFocus { focused });
            if focused {
                s.refresh_outside();
            }
        }
    });
    // Popovers, menus, the palette and toasts leave with one quick fade.
    rune_kit::root(window, layer).child_exit(theme::quick_exit())
}

/// A tab's session: its header and its thread.
/// `size` is the room inside the session card, and `window` the window's, which the start screen scales by.
fn session(s: &Desk, tab: &TabInfo, dark: bool, size: Option<[f32; 2]>, window: Option<[f32; 2]>, layer: &mut Vec<El>) -> El {
    let width = size.map(|size| size[0]);
    let k = theme::kit(dark);
    let name = project_label(s, &tab.project);
    let place = row()
        .min_w(0.0)
        .shrink()
        .gap(7.0)
        .items_center()
        .child(project_mark(s, &tab.project, k))
        .child(text(name).font(crate::theme::text(13.0)).color(k.c.text_muted))
        .child(text("/").font(crate::theme::text(13.0)).color(k.c.text_faint))
        .child(text(tab.title.clone()).font(crate::theme::medium(13.0)).color(k.c.text_base).truncate())
        .children(crate::session_menu::button(s, tab, k, layer));
    crate::rewind::dialog(s, &tab.id, k, layer);
    crate::branch_notice::dialog(s, &tab.id, k, layer);
    crate::worktrees::remove_dialog(s, tab, k, layer);
    let end = row()
        .gap(4.0)
        .items_center()
        // Without room for the rail, the project's cards fold into a chip.
        .children(width.filter(|w| !crate::cards::Lane::rail(*w)).map(|_| crate::cards::space_chip(s, tab, k, layer)))
        .children(crate::extensions::button(s, tab, k, layer))
        .children(s.threads.get(&tab.id).and_then(|t| t.context.as_ref()).map(|reading| crate::meters::context_ring(reading, k)));
    // The header keeps its last 48 points for the panel toggle, which sits over the corner. While the pane
    // is open, the pane's own header holds the toggle.
    let header = row()
        .key("session-header")
        .w_full()
        .h(HEADER_HEIGHT)
        .items_center()
        .pl(16.0)
        .pr(48.0)
        .gap(8.0)
        .child(place)
        .child(row().grow(1.0))
        .child(end)
        .children((tab.panel_open != Some(true)).then(|| crate::panel::toggle(false, k).pin(None, Some(TOGGLE_INSET.0), Some(TOGGLE_INSET.1), None)));
    let started = s.threads.get(&tab.id).is_some_and(|t| !t.items.is_empty());
    let lane = width.map(|w| crate::cards::Lane::for_session(w, thread_view::COLUMN));
    let sidebar = s.plugins.layouts.get(&tab.id).is_some_and(|l| l.sidebar.is_some());
    let body = if started {
        col().w_full().grow(1.0).min_h(0.0).child(thread_view::thread(s, &tab.id, dark, lane)).child(thread_composer(s, tab, lane, k, layer))
    } else if sidebar {
        // A tab with a plugin sidebar, before the sidebar opens a thread: the composer, under a line on how to start.
        col()
            .w_full()
            .grow(1.0)
            .min_h(0.0)
            .child(col().w_full().grow(1.0).center().px(24.0).child(text("Pick something in the sidebar to open its thread.").font(crate::theme::text(13.0)).color(k.c.text_faint)))
            .child(thread_composer(s, tab, lane, k, layer))
    } else {
        crate::start_screen::start_screen(s, tab, lane, window, k, layer)
    };
    // The cards show beside the lane once the session is wide enough.
    let rail = width.filter(|w| crate::cards::Lane::rail(*w)).map(|_| crate::cards::rail(s, tab, k, layer));
    // The minimap sits in the lane's left gutter, over the thread.
    let minimap = match (started, lane, size, s.threads.get(&tab.id)) {
        (true, Some(lane), Some([_, height]), Some(thread)) => crate::minimap::minimap(s, &tab.id, thread, lane.left, height, k),
        _ => None,
    };
    crate::thread_view::approval_menu(s, &tab.id, k, layer);
    let body = col().w_full().grow(1.0).min_h(0.0).child(body).children(rail).children(minimap);
    // A session shows at once, not crossfading from the last one.
    col().key(format!("session-{}", tab.id)).transition(rune::Transition::none()).w_full().grow(1.0).min_h(0.0).child(header).child(body)
}

/// The composer under a thread, on its lane, `desk-lane pb-4 pt-1.5`, under the lines on what the running turn does now.
fn thread_composer(s: &Desk, tab: &TabInfo, lane: Option<crate::cards::Lane>, k: &rune_kit::Kit, layer: &mut Vec<El>) -> El {
    let now = crate::thread_now::lines(s, &tab.id, k);
    let now = (!now.is_empty()).then(|| col().w_full().pb(8.0).children(now));
    thread_view::in_lane(col().w_full().pt(6.0).pb(16.0).children(now).child(composer::composer(s, tab, composer::ListAt::Above, k, layer)), lane)
}

/// A project's mark: the icon Settings chose, on its own, else
/// the initial on a tile in the project's colour.
/// A project's name as the user set it. A folder in a worktree takes its repo's.
pub fn project_label(s: &Desk, project: &str) -> String {
    s.account.project_label(s.projects.home(project))
}

/// A project's mark. A folder in a worktree takes its repo's.
pub fn project_mark(s: &Desk, project: &str, k: &rune_kit::Kit) -> El {
    let project = s.projects.home(project);
    let icon = s.account.project_icon(project).and_then(|path| s.images.file(&std::path::Path::new(project).join(path)));
    match icon {
        // An icon is often a transparent logo, so it shows whole, without the tile.
        Some(image) => rune::el().size(PROJECT_MARK, PROJECT_MARK).pixels_fit(image.pixels(), rune::SurfaceFit::Fit),
        None => {
            let initial = s.account.project_label(project).chars().next().unwrap_or(' ').to_uppercase().to_string();
            avatar(&initial, s.account.project_color(project).unwrap_or("gray"), PROJECT_MARK, k)
        }
    }
}

/// `@opencode/ui`'s ProjectAvatar: an initial on a tile in one of its colours, lit from the top.
pub fn avatar(initial: &str, color: &str, size: f32, k: &rune_kit::Kit) -> El {
    let theme = rune_theme_opencode::theme(k.dark);
    row()
        .size(size, size)
        .radius(4.0)
        .center()
        .fill(theme.color(&format!("v2-avatar-bg-{color}")))
        .gradient(Color::WHITE.alpha(0.16), Color::WHITE.alpha(0.0))
        .border(0.5, theme.color(&format!("v2-avatar-border-{color}")))
        .child(text(initial.to_owned()).font(rune::TextStyle::new(11.0, 530.0).lh(11.0).tracking(0.05)).color(theme.color("v2-avatar-fg")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::TabInfo;
    use rune::{Env, Runtime};
    use serde_json::Map;

    fn tab(id: &str, title: &str) -> TabInfo {
        TabInfo { id: id.into(), title: title.into(), project: format!("/code/{id}"), terminals: vec![], agent: "claude".into(), model: "default".into(), effort: None, fast: None, permission_mode: "auto".into(), files: vec![], panel_active: None, review_scope: None, panel_open: None, rest: Map::new() }
    }

    fn runtime(tabs: Vec<TabInfo>, active: &str) -> Runtime<Desk> {
        let mut rt = Runtime::new(Desk { status: CoreState::Ready, ..Desk::default() }, view, (1280.0, 820.0), Env { system_dark: true, scale: 2.0 });
        let message = CoreMessage::Tabs { tabs, active: Some(active.into()) };
        rt.update(move |s, tx| s.receive_in(Event::Message(message), tx));
        rt.frame(0.0);
        rt
    }

    fn texts(rt: &Runtime<Desk>) -> Vec<String> {
        rt.elements().into_iter().filter_map(|e| e.text).collect()
    }

    #[test]
    fn the_tab_bar_shows_each_tab_and_the_header_its_project() {
        let rt = runtime(vec![tab("a", "Fix the login form"), tab("b", "New session")], "b");
        let texts = texts(&rt);
        for words in ["Fix the login form", "New session", "b"] {
            assert!(texts.iter().any(|t| t == words), "{words:?} shows in {texts:?}");
        }
    }

    #[test]
    fn the_plus_button_opens_a_tab_in_the_active_project() {
        let mut rt = runtime(vec![tab("a", "First")], "a");
        let (x, y) = rt.find("new-tab").expect("the new tab button");
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.frame(1.0 / 60.0);
        assert_eq!(rt.state.workspace.tabs.len(), 2);
        assert_eq!(rt.state.workspace.tabs[1].project, "/code/a");
        let sent = rt.state.core.sent();
        assert!(sent.iter().any(|m| m["type"] == "tabs.save"), "the new tab is saved");
        assert!(sent.iter().any(|m| m["type"] == "project.get" && m["part"] == "threads"), "its start screen reads the project's threads");
    }

    #[test]
    fn a_middle_click_closes_a_tab() {
        let mut rt = runtime(vec![tab("a", "First"), tab("b", "Second")], "b");
        let (x, y) = rt.find("tab-a").expect("the first tab");
        rt.button_down(x, y, rune::PointerButton::Middle);
        rt.button_up(x, y, rune::PointerButton::Middle);
        rt.frame(1.0 / 60.0);
        assert_eq!(rt.state.workspace.tabs.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["b"]);
        assert_eq!(rt.state.workspace.active.as_deref(), Some("b"), "closing another tab keeps the active one");
        assert!(rt.state.core.sent().iter().any(|m| m["type"] == "tabs.save"), "the close is saved");
    }

    #[test]
    fn a_subagent_running_after_its_turn_keeps_the_clock_ticking() {
        let mut rt = runtime(vec![tab("a", "First")], "a");
        let subagent = |status: &str| serde_json::json!({ "type": "session.event", "tabId": "a", "event": { "kind": "subagent", "subagent": { "id": "s1", "description": "Find the login tests", "type": "Explore", "status": status, "background": true, "startedAt": 0.0, "toolUses": 0, "items": [] } } });
        for message in [subagent("running"), serde_json::json!({ "type": "session.event", "tabId": "a", "event": { "kind": "status", "busy": false } })] {
            let message = serde_json::from_value::<CoreMessage>(message).unwrap();
            rt.update(move |s, tx| s.receive_in(Event::Message(message), tx));
        }
        assert!(rt.state.ticking(), "a running subagent counts seconds with no turn running");
        let message = serde_json::from_value::<CoreMessage>(subagent("completed")).unwrap();
        rt.update(move |s, tx| s.receive_in(Event::Message(message), tx));
        assert!(!rt.state.ticking(), "a finished subagent stops the clock");
    }

    #[test]
    fn an_empty_window_with_no_project_asks_for_a_folder() {
        let mut rt = runtime(vec![], "none");
        rt.frame(1.0 / 60.0);
        assert!(rt.file_dialog().is_some(), "a folder dialog opens");
        rt.resolve_file_dialog(Some("/code/picked".into())).expect("the dialog was open");
        rt.frame(1.0 / 60.0);
        assert_eq!(rt.state.workspace.tabs.iter().map(|t| t.project.as_str()).collect::<Vec<_>>(), ["/code/picked"]);
    }
}
