//! Desk, drawn with Rune. The Bun core does the work. This app draws what it sends.

mod core;
mod instance;
mod protocol;
mod shell;
mod theme;

use rune::{AppSpec, MenuItem, Titlebar, Tx};
use shell::Desk;
use std::cell::RefCell;

/// ⌘1 to ⌘9 select a tab.
const TAB_SHORTCUTS: [fn(&mut Desk, &mut Tx); 9] =
    [select_tab::<0>, select_tab::<1>, select_tab::<2>, select_tab::<3>, select_tab::<4>, select_tab::<5>, select_tab::<6>, select_tab::<7>, select_tab::<8>];

fn select_tab<const INDEX: usize>(s: &mut Desk, _: &mut Tx) {
    s.select_index(INDEX);
}

fn main() {
    let Some(_lock) = instance::lock() else {
        eprintln!("desk: Desk is already running.");
        return;
    };
    rune::prewarm_gpu();
    let mut app = rune::App::new(AppSpec {
        min_size: Some((720.0, 480.0)),
        fonts: rune_theme_opencode::FONTS,
        families: rune_theme_opencode::FAMILIES,
        ..AppSpec::new("Desk", (1280.0, 820.0), Desk::default, shell::view)
    })
    .titlebar(Titlebar::new(shell::TITLEBAR_HEIGHT));
    for (index, action) in TAB_SHORTCUTS.into_iter().enumerate() {
        let key = format!("cmd+{}", index + 1).parse().expect("a shortcut");
        app = app.menu_item(MenuItem::new(format!("Tab {}", index + 1), action).menu("View").key_equivalent(key));
    }

    // The core starts once the window shows, so headless runs, which never call on_ready, start none.
    let core = core::Core::default();
    let handle = app.handle();
    let starting = RefCell::new(Some(core.clone()));
    let app = app.on_ready(move |_| {
        if let Some(core) = starting.borrow_mut().take() {
            let handle = handle.clone();
            core.start(move |event| handle.update(move |s: &mut Desk, _| s.receive(event)));
        }
    });
    app.run();
    core.stop();
}
