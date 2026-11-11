//! The folder `desk <folder>` asks Desk to open. An installed Desk hears it as the link
//! `desk://open?dir=<folder>`, which the system hands to the running Desk, or to the one it starts. A Desk
//! run from the repo takes it from `DESK_DIR` at launch, as the Electron app's `bin/desk` sets it.

use std::path::Path;

/// The link `bin/desk` opens. Only Desk's own links name a folder.
const OPEN: &str = "desk://open?";

/// The folder a `desk://open?dir=` link names, when it is an existing folder. The link comes from
/// outside Desk, so anything else is ignored.
pub fn folder_from_url(url: &str) -> Option<String> {
    let query = url.strip_prefix(OPEN)?;
    let dir = query.split('&').find_map(|pair| pair.strip_prefix("dir="))?;
    folder(&percent_decoded(dir)?)
}

/// The folder `DESK_DIR` names, when it is an existing folder.
pub fn folder_from_env() -> Option<String> {
    let dir = std::env::var("DESK_DIR").ok()?;
    let absolute = std::env::current_dir().ok()?.join(dir);
    folder(absolute.to_str()?)
}

/// `path` when it is absolute and a folder, as `folder` in the Electron app's `folders.ts`.
fn folder(path: &str) -> Option<String> {
    let path = Path::new(path);
    (path.is_absolute() && path.is_dir()).then(|| path.to_string_lossy().into_owned())
}

/// `%2F`-style escapes decoded to UTF-8. None for a broken escape or bytes that are not UTF-8.
fn percent_decoded(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_desk_link_names_an_existing_folder_and_nothing_else() {
        let dir = std::env::temp_dir().join("desk open test ü");
        std::fs::create_dir_all(&dir).unwrap();
        let escaped: String = dir.to_str().unwrap().bytes().map(|b| if b.is_ascii_alphanumeric() || b"/-_.".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
        assert_eq!(folder_from_url(&format!("desk://open?dir={escaped}")).as_deref(), dir.to_str());
        for url in ["desk://open?dir=%2Fno%2Fsuch%2Ffolder", "desk://open?dir=relative", "desk://other?dir=%2Ftmp", "https://open?dir=%2Ftmp", "desk://open?dir=%ZZ", "desk://open?name=x"] {
            assert_eq!(folder_from_url(url), None, "{url}");
        }
    }
}
