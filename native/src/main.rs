//! Desk, drawn with Rune. The Bun core does the work. This app draws what it sends.

mod account;
mod attachments;
mod base64;
mod composer;
mod core;
mod diff;
mod format;
mod icons;
mod ids;
mod images;
mod instance;
mod model_picker;
mod models;
mod panel;
mod projects;
mod protocol;
mod questions;
mod scenes;
mod shell;
mod start_screen;
mod theme;
mod thread_view;
mod terminal;
mod terminal_view;
mod threads;
mod toasts;
mod triggers;
mod workspace;

use rune::{AppSpec, MenuItem, Titlebar, Tx};
use shell::{Desk, commands};
use std::cell::RefCell;

/// A menu item: its title and shortcut as `app/src/shared/commands.ts` names them, its menu and what it runs.
type Command = (&'static str, &'static str, &'static str, fn(&mut Desk, &mut Tx));

const COMMANDS: &[Command] = &[
    ("New Session", "cmd+t", "File", commands::new_session),
    ("New Terminal", "ctrl+`", "File", commands::new_terminal),
    ("Open Folder…", "cmd+o", "File", commands::open_folder),
    ("Close Tab", "cmd+w", "File", commands::close_tab),
    ("Reopen Closed Tab", "cmd+shift+t", "File", commands::reopen_tab),
    ("Toggle Panel", "cmd+\\", "View", commands::toggle_panel),
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
        setup: Some(|s: &mut Desk, waker| s.images.setup(waker)),
        scenes: scenes::SCENES,
        ..AppSpec::new("Desk", (1280.0, 820.0), Desk::default, shell::view)
    })
    .init(move || Desk::new(state.clone()))
    .on_modifiers(shell::modifiers)
    .titlebar(Titlebar::new(shell::TITLEBAR_HEIGHT));
    for &(title, keys, menu, action) in COMMANDS {
        app = app.menu_item(MenuItem::new(title, action).menu(menu).key_equivalent(keys.parse().expect("a shortcut")));
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
