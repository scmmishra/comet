//! The links Comet opens. `comet <folder>` asks Comet to open a folder: an installed Comet hears it as the
//! link `comet://open?dir=<folder>`, which the system hands to the running Comet, or to the one it starts. A
//! Comet run from the repo takes it from `COMET_DIR` at launch. `comet://plugin/install?source=<source>`
//! asks Comet to install a plugin, which waits for the user to agree.

use std::path::Path;

/// The link `bin/comet` opens. Only Comet's own links name a folder.
const OPEN: &str = "comet://open?";
/// The link a plugin's page can offer to install it.
const INSTALL: &str = "comet://plugin/install?";

/// The folder a `comet://open?dir=` link names, when it is an existing folder. The link comes from
/// outside Comet, so anything else is ignored.
pub fn folder_from_url(url: &str) -> Option<String> {
    let query = url.strip_prefix(OPEN)?;
    let dir = query.split('&').find_map(|pair| pair.strip_prefix("dir="))?;
    folder(&percent_decoded(dir)?)
}

/// The plugin source a `comet://plugin/install?source=` link names: one line of text. The link comes from
/// outside Comet, so it only fills in the source Settings shows, and anything else is ignored.
pub fn plugin_source_from_url(url: &str) -> Option<String> {
    let query = url.strip_prefix(INSTALL)?;
    let source = percent_decoded(&query.split('&').find_map(|pair| pair.strip_prefix("source="))?.replace('+', " "))?;
    let source = source.trim();
    (!source.is_empty() && !source.chars().any(char::is_control)).then(|| source.to_owned())
}

/// The folder `COMET_DIR` names, when it is an existing folder.
pub fn folder_from_env() -> Option<String> {
    let dir = std::env::var("COMET_DIR").ok()?;
    let absolute = std::env::current_dir().ok()?.join(dir);
    folder(absolute.to_str()?)
}

/// `path` when it is absolute and a folder.
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
    fn a_comet_link_names_an_existing_folder_and_nothing_else() {
        let dir = std::env::temp_dir().join("comet open test ü");
        std::fs::create_dir_all(&dir).unwrap();
        let escaped: String = dir.to_str().unwrap().bytes().map(|b| if b.is_ascii_alphanumeric() || b"/-_.".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
        assert_eq!(folder_from_url(&format!("comet://open?dir={escaped}")).as_deref(), dir.to_str());
        for url in ["comet://open?dir=%2Fno%2Fsuch%2Ffolder", "comet://open?dir=relative", "comet://other?dir=%2Ftmp", "https://open?dir=%2Ftmp", "comet://open?dir=%ZZ", "comet://open?name=x"] {
            assert_eq!(folder_from_url(url), None, "{url}");
        }
    }

    #[test]
    fn an_install_link_names_one_line_of_source_and_nothing_else() {
        assert_eq!(plugin_source_from_url("comet://plugin/install?source=github%3Asomeone%2Fcomet-plugin-reviews").as_deref(), Some("github:someone/comet-plugin-reviews"));
        assert_eq!(plugin_source_from_url("comet://plugin/install?x=1&source=comet-plugin-reviews").as_deref(), Some("comet-plugin-reviews"));
        for url in ["comet://plugin/install?source=", "comet://plugin/install?source=a%0Ab", "comet://plugin/install?name=x", "comet://open?source=x", "https://plugin/install?source=x"] {
            assert_eq!(plugin_source_from_url(url), None, "{url}");
        }
    }
}
