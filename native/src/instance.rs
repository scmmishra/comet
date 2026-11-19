//! One native Comet runs at a time: its core saves the window's tabs in one file, which a second
//! Comet would overwrite. Rune's `single_instance` covers only Windows, so the Mac takes a file lock.

use std::fs::File;
use std::path::{Path, PathBuf};

/// The folder in the home folder that Comet kept its data in when it was called Desk.
const DESK_FOLDER: &str = ".desk";
const LOCK_FILE: &str = "app.lock";

fn user_home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").expect("HOME is set"))
}

/// Comet's folder, as the core finds it (`cometHome` in `core/src/data-files.ts`).
pub fn comet_home() -> PathBuf {
    match std::env::var_os("COMET_HOME") {
        Some(home) => home.into(),
        None => user_home().join(".comet"),
    }
}

/// Where this Comet keeps what only it may write, as the core names it (`instanceHome`).
pub fn home() -> PathBuf {
    match crate::core::setup().instance {
        Some(instance) => comet_home().join(instance),
        None => comet_home(),
    }
}

/// Takes the lock, which holds while the file stays open. None when another Comet holds it.
pub fn lock() -> Option<File> {
    let dir = home();
    std::fs::create_dir_all(&dir).ok()?;
    let file = File::create(dir.join(LOCK_FILE)).ok()?;
    file.try_lock().ok()?;
    Some(file)
}

/// Moves Desk's folder, `~/.desk`, to `~/.comet` on Comet's first start. It runs before `lock`,
/// which creates `~/.comet`. A `COMET_HOME` names a folder of its own, so nothing moves then.
pub fn move_desk_home() -> Result<(), String> {
    if std::env::var_os("COMET_HOME").is_some() {
        return Ok(());
    }
    move_home(&user_home().join(DESK_FOLDER), &comet_home())
}

/// Renames `old` to `new` when `old` exists and `new` does not. A Desk that still runs holds a lock
/// in `old` or in one of its instance folders. Then nothing moves, and the caller does not start, so
/// it never creates `new` and the move can run once Desk quits.
fn move_home(old: &Path, new: &Path) -> Result<(), String> {
    if new.exists() || !old.is_dir() {
        return Ok(());
    }
    if desk_running(old) {
        return Err(format!("Quit Desk first. Comet moves Desk's data from {} on its first start.", old.display()));
    }
    std::fs::rename(old, new).map_err(|error| format!("Comet could not move {} to {}: {error}", old.display(), new.display()))
}

fn desk_running(old: &Path) -> bool {
    let instances = std::fs::read_dir(old).into_iter().flatten().flatten().map(|entry| entry.path().join(LOCK_FILE));
    std::iter::once(old.join(LOCK_FILE)).chain(instances).filter(|lock| lock.is_file()).any(|lock| {
        // The lock is released when the file closes at the end of this closure.
        File::options().write(true).open(&lock).map_or(true, |file| file.try_lock().is_err())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("comet-instance-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".desk/native")).unwrap();
        std::fs::write(dir.join(".desk/settings.json"), "{}").unwrap();
        dir
    }

    #[test]
    fn desk_home_moves_to_comet_home_once() {
        let dir = folder("moves");
        let (old, new) = (dir.join(".desk"), dir.join(".comet"));
        std::fs::write(old.join(LOCK_FILE), "").unwrap();
        move_home(&old, &new).unwrap();
        assert!(!old.exists());
        assert!(new.join("settings.json").is_file());
        assert!(new.join("native").is_dir());

        std::fs::create_dir_all(old.join("later")).unwrap();
        move_home(&old, &new).unwrap();
        assert!(old.join("later").is_dir(), "a Comet folder that exists is never replaced");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_running_desk_keeps_its_folder() {
        let dir = folder("running");
        let (old, new) = (dir.join(".desk"), dir.join(".comet"));
        let held = File::create(old.join("native").join(LOCK_FILE)).unwrap();
        held.try_lock().unwrap();
        assert!(move_home(&old, &new).is_err());
        assert!(old.is_dir() && !new.exists());
        drop(held);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
