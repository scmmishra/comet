//! Comet, drawn with Rune. The Bun core does the work. This app draws what it sends.

mod account;
mod agents;
mod attachments;
mod base64;
mod branch_notice;
mod cards;
mod commands_card;
mod composer;
mod core;
mod diff;
// A copy of rune-kit's diff view, kept whole so it can be swapped back once anomalyco/rune#576 lands.
// Its options Review does not use yet, such as annotations and comments, stay with it.
#[allow(dead_code)]
mod diff_view;
mod extensions;
mod format;
mod icons;
mod ids;
mod images;
mod instance;
mod meters;
mod minimap;
mod model_picker;
mod models;
mod new_menu;
mod opening;
mod palette;
mod panes;
mod panel;
mod plugins;
mod projects;
mod protocol;
mod questions;
mod reply;
mod rewind;
mod scenes;
mod search;
mod session_menu;
mod settings;
mod shell;
mod start_screen;
mod tab_bar;
mod tab_numbers;
mod theme;
mod theme_picker;
mod thread_now;
mod thread_view;
mod terminal;
mod terminal_view;
mod threads;
mod toasts;
mod triggers;
mod ui;
mod workspace;
mod worktrees;

use rune::{AppSpec, MenuItem, Titlebar, Tx};
use shell::{Comet, commands};

/// A menu item: its title and shortcut, its menu and what it runs.
type Command = (&'static str, &'static str, &'static str, fn(&mut Comet, &mut Tx));

/// The app menu, Comet's first, which Rune fills when an item names no menu.
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
    // Headless runs, such as `--snap`, start no core and save nothing, so they run beside a Comet.
    let headless = headless();
    if !headless && let Err(message) = instance::move_desk_home() {
        eprintln!("comet: {message}");
        return;
    }
    let _lock = if headless { None } else { instance::lock() };
    if !headless && _lock.is_none() {
        eprintln!("comet: Comet is already running.");
        return;
    }
    rune::prewarm_gpu();
    // OpenCode sets `text-wrap-style: pretty` on every element: a paragraph never ends on a lone short word.
    // Rune caches text layouts, so this runs before any text is laid out.
    rune::text::set_pretty_wrap(true);
    let core = core::Core::default();
    let state = core.clone();
    let mut app = rune::App::new(AppSpec {
        min_size: Some((720.0, 480.0)),
        fonts: theme::FONTS,
        families: theme::FAMILIES,
        poll: Some(shell::poll),
        setup: Some(|s: &mut Comet, waker| s.images.setup(waker)),
        scenes: scenes::SCENES,
        ..AppSpec::new("Comet", (1280.0, 820.0), Comet::default, shell::view)
    })
    .init(move || {
        let mut comet = Comet::new(state.clone());
        // A Comet run from the repo opens the folder `COMET_DIR` names, as `COMET_DIR=<folder> mise run dev` does.
        if let Some(dir) = opening::folder_from_env() {
            comet.workspace.open_asked(dir, None, &comet.account, &comet.core);
        }
        comet
    })
    .on_open_url(shell::open_url)
    .on_ime(shell::ime)
    // Comet's text draws with grayscale smoothing, which is Rune's Off.
    .font_smoothing(rune::FontSmoothing::Off)
    .on_modifiers(shell::modifiers)
    .titlebar(Titlebar::new(shell::TITLEBAR_HEIGHT));
    for &(title, keys, menu, action) in COMMANDS {
        let item = MenuItem::new(title, action).key_equivalent(keys.parse().expect("a shortcut"));
        app = app.menu_item(if menu == APP_MENU { item } else { item.menu(menu) });
    }
    for (index, action) in commands::SHOW_TAB.into_iter().enumerate() {
        let number = workspace::tab_number(index).expect("a ⌘ number for each tab shortcut");
        let item = MenuItem::new(format!("Tab {number}"), action).key_equivalent(format!("cmd+{number}").parse().expect("a shortcut"));
        app = app.menu_item(item.menu("View"));
    }

    // The core starts beside the window, not after it, so both take their time at once. What it sends
    // before the loop runs waits in the handle. Headless runs start none.
    if !headless {
        let handle = app.handle();
        core.send(&protocol::ClientMessage::AgentsGet);
        core.start(move |event| handle.update(move |s: &mut Comet, tx| s.receive_in(event, tx)));
        core.stop_at_quit();
    }
    // Rune ends the process when the app quits, so code after this line does not run.
    app.run();
}
