//! One native Desk runs at a time: its core saves the window's tabs in one file, which a second
//! Desk would overwrite. Rune's `single_instance` covers only Windows, so the Mac takes a file lock.

use crate::core::INSTANCE;
use std::fs::File;
use std::path::PathBuf;

/// Desk's folder, as the core finds it (`deskHome` in `core/src/data-files.ts`).
fn desk_home() -> PathBuf {
    match std::env::var_os("DESK_HOME") {
        Some(home) => home.into(),
        None => PathBuf::from(std::env::var_os("HOME").expect("HOME is set")).join(".desk"),
    }
}

/// Where this Desk keeps what only it may write, as the core names it (`instanceHome`).
pub fn home() -> PathBuf {
    desk_home().join(INSTANCE)
}

/// Takes the lock, which holds while the file stays open. None when another Desk holds it.
pub fn lock() -> Option<File> {
    let dir = home();
    std::fs::create_dir_all(&dir).ok()?;
    let file = File::create(dir.join("app.lock")).ok()?;
    file.try_lock().ok()?;
    Some(file)
}
