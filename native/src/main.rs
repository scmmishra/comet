//! Desk, drawn with Rune. The Bun core does the work. This app draws what it sends.

mod account;
mod core;
mod ids;
mod instance;
mod protocol;
mod shell;
mod theme;
mod workspace;

use rune::{AppSpec, MenuItem, Titlebar, Tx};
use shell::{Desk, commands};
use std::cell::RefCell;

/// A menu item: its title and shortcut as `app/src/shared/commands.ts` names them, its menu and what it runs.
type Command = (&'static str, &'static str, &'static str, fn(&mut Desk, &mut Tx));

const COMMANDS: &[Command] = &[
    ("New Session", "cmd+t", "File", commands::new_session),
    ("Open Folder…", "cmd+o", "File", commands::open_folder),
    ("Close Tab", "cmd+w", "File", commands::close_tab),
    ("Reopen Closed Tab", "cmd+shift+t", "File", commands::reopen_tab),
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

fn main() {
    let Some(_lock) = instance::lock() else {
        eprintln!("desk: Desk is already running.");
        return;
    };
    rune::prewarm_gpu();
    let core = core::Core::default();
    let state = core.clone();
    let mut app = rune::App::new(AppSpec {
        min_size: Some((720.0, 480.0)),
        fonts: rune_theme_opencode::FONTS,
        families: rune_theme_opencode::FAMILIES,
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
            core.start(move |event| handle.update(move |s: &mut Desk, tx| s.receive(event, tx)));
        }
    });
    app.run();
    core.stop();
}
