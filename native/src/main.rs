//! Desk, drawn with Rune. The Bun core does the work. This app draws what it sends.

mod account;
mod attachments;
mod base64;
mod cards;
mod commands_card;
mod composer;
mod core;
mod diff;
// A copy of rune-kit's diff view, kept whole so it can be swapped back once anomalyco/rune#576 lands.
// Its options Review does not use yet, such as annotations and comments, stay with it.
#[allow(dead_code)]
mod diff_view;
mod format;
mod icons;
mod ids;
mod images;
mod instance;
mod meters;
mod minimap;
mod model_picker;
mod models;
mod opening;
mod palette;
mod panel;
mod plugins;
mod projects;
mod protocol;
mod questions;
mod reply;
mod scenes;
mod settings;
mod shell;
mod start_screen;
mod tab_bar;
mod theme;
mod thread_view;
mod terminal;
mod terminal_view;
mod threads;
mod toasts;
mod triggers;
mod ui;
mod workspace;

use rune::{AppSpec, MenuItem, Titlebar, Tx};
use shell::{Desk, commands};
use std::cell::RefCell;

/// A menu item: its title and shortcut, its menu and what it runs.
type Command = (&'static str, &'static str, &'static str, fn(&mut Desk, &mut Tx));

/// The app menu, Desk's first, which Rune fills when an item names no menu.
const APP_MENU: &str = "";

const COMMANDS: &[Command] = &[
    ("New Session", "cmd+t", "File", commands::new_session),
    ("New Terminal", "ctrl+`", "File", commands::new_terminal),
    ("Open Folder…", "cmd+o", "File", commands::open_folder),
    ("Close Tab", "cmd+w", "File", commands::close_tab),
    ("Reopen Closed Tab", "cmd+shift+t", "File", commands::reopen_tab),
    ("Settings…", "cmd+,", APP_MENU, commands::settings),
    ("Toggle Panel", "cmd+\\", "View", commands::toggle_panel),
    ("Command Palette…", "cmd+k", "View", commands::palette),
    ("Search Threads…", "cmd+shift+o", "View", commands::search_threads),
    ("Search Files…", "cmd+p", "View", commands::search_files),
    ("Tab 1", "cmd+1", "View", commands::show_tab::<0>),
    ("Tab 2", "cmd+2", "View", commands::show_tab::<1>),
    ("Tab 3", "cmd+3", "View", commands::show_tab::<2>),
    ("Tab 4", "cmd+4", "View", commands::show_tab::<3>),
    ("Tab 5", "cmd+5", "View", commands::show_tab::<4>),
    ("Tab 6", "cmd+6", "View", commands::show_tab::<5>),
    ("Tab 7", "cmd+7", "View", commands::show_tab::<6>),
    ("Tab 8", "cmd+8", "View", commands::show_tab::<7>),
    ("Tab 9", "cmd+9", "View", commands::show_tab::<8>),
];

/// Whether Rune will run headless, by its flags. Rune keeps the rule in `Args::headless`, which it
/// does not export, so this follows it: these flags always run headless, and a script, trace or frame
/// log runs headless unless `--native` asks for a window.
fn headless() -> bool {
    const ALWAYS: [&str; 7] = ["--snap", "--tree", "--html", "--video", "--strip", "--list-scenes", "--first-pixels"];
    const UNLESS_NATIVE: [&str; 5] = ["--script", "--trace", "--frames", "--duration", "--out"];
    let args: Vec<String> = std::env::args().collect();
    let has = |flag: &str| args.iter().any(|a| a == flag);
    ALWAYS.iter().any(|f| has(f)) || (!has("--native") && UNLESS_NATIVE.iter().any(|f| has(f)))
}

fn main() {
    // Headless runs, such as `--snap`, start no core and save nothing, so they run beside a Desk.
    let headless = headless();
    let _lock = if headless { None } else { instance::lock() };
    if !headless && _lock.is_none() {
        eprintln!("desk: Desk is already running.");
        return;
    }
    rune::prewarm_gpu();
    let core = core::Core::default();
    let state = core.clone();
    let mut app = rune::App::new(AppSpec {
        min_size: Some((720.0, 480.0)),
        fonts: theme::FONTS,
        families: theme::FAMILIES,
        poll: Some(shell::poll),
        on_key: Some(shell::key),
        setup: Some(|s: &mut Desk, waker| s.images.setup(waker)),
        scenes: scenes::SCENES,
        ..AppSpec::new("Desk", (1280.0, 820.0), Desk::default, shell::view)
    })
    .init(move || {
        let mut desk = Desk::new(state.clone());
        // A Desk run from the repo opens the folder `DESK_DIR` names, as `DESK_DIR=<folder> mise run dev` does.
        if let Some(dir) = opening::folder_from_env() {
            desk.workspace.open_asked(dir, &desk.account, &desk.core);
        }
        desk
    })
    .on_open_url(shell::open_url)
    .on_ime(shell::ime)
    // Desk's text draws with grayscale smoothing, which is Rune's Off.
    .font_smoothing(rune::FontSmoothing::Off)
    .on_modifiers(shell::modifiers)
    .titlebar(Titlebar::new(shell::TITLEBAR_HEIGHT));
    for &(title, keys, menu, action) in COMMANDS {
        let item = MenuItem::new(title, action).key_equivalent(keys.parse().expect("a shortcut"));
        app = app.menu_item(if menu == APP_MENU { item } else { item.menu(menu) });
    }

    // The core starts once the window shows, so headless runs, which never call on_ready, start none.
    let handle = app.handle();
    let starting = RefCell::new(Some(core.clone()));
    let app = app.on_ready(move |_| {
        if let Some(core) = starting.borrow_mut().take() {
            let handle = handle.clone();
            core.send(&protocol::ClientMessage::ModelsGet);
            core.start(move |event| handle.update(move |s: &mut Desk, tx| s.receive_in(event, tx)));
        }
    });
    app.run();
    core.stop();
}
