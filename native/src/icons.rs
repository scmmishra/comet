//! Glyphs `@opencode/ui` has no icon for, drawn on a 16-unit grid, Desk's file icons and its disclosure chevron. Everything else comes from the OpenCode catalog.

use rune::Icon;

macro_rules! glyph {
    ($name:ident, $id:literal, $path:literal) => {
        pub static $name: Icon = Icon { name: $id, view: 16.0, body: concat!(r#"<path d=""#, $path, r#"" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>"#) };
    };
}

glyph!(PULL_REQUEST, "pull-request", "M4 5.1v5.8M12 10.9V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6M5.6 3.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M5.6 12.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M13.6 12.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0");
glyph!(GAUGE, "gauge", "M2.5 11a5.5 5.5 0 1 1 11 0M8 11l2.5-3");
glyph!(BOLT, "bolt", "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z");
glyph!(PLAY, "play", "M5 3.5v9l7.5-4.5z");
glyph!(SPARKLE, "sparkle", "M8 2.5l1.4 4.1 4.1 1.4-4.1 1.4L8 13.5l-1.4-4.1L2.5 8l4.1-1.4z");
glyph!(SUN, "sun", "M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05");
glyph!(MOON, "moon", "M13.5 9.6A5.75 5.75 0 1 1 6.4 2.5a4.6 4.6 0 0 0 7.1 7.1");
glyph!(SHIELD_OFF, "shield-off", "M8 1.5l5 2v4c0 3-2.2 5.3-5 6-2.8-.7-5-3-5-6v-4zM2.5 2.5l11 11");

/// Fast mode's bolt, filled.
pub static BOLT_FILLED: Icon = Icon { name: "bolt-filled", view: 16.0, body: r#"<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" fill="currentColor"/>"# };

/// Claude's starburst mark: eight lines through the centre make sixteen rays.
pub static CLAUDE: Icon = Icon {
    name: "claude",
    view: 16.0,
    body: r#"<path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2M5.3 1.9l5.4 12.2M10.7 1.9 5.3 14.1M1.9 5.3l12.2 5.4M14.1 5.3 1.9 10.7" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>"#,
};


/// Antigravity's mark, the arch Google draws for it, in its own colours: blue, warming to green, orange
/// and red at the top. The path is the logo the Antigravity app ships. The OpenCode catalog has no mark for it.
pub static ANTIGRAVITY: Icon = Icon {
    name: "antigravity",
    view: 180.0,
    body: concat!(
        r##"<defs>"##,
        r##"<radialGradient id="agy-green" gradientUnits="userSpaceOnUse" cx="62" cy="78" r="46"><stop offset="0" stop-color="#8fc94a"/><stop offset="1" stop-color="#8fc94a" stop-opacity="0"/></radialGradient>"##,
        r##"<radialGradient id="agy-red" gradientUnits="userSpaceOnUse" cx="122" cy="76" r="46"><stop offset="0" stop-color="#ee5a52"/><stop offset="1" stop-color="#ee5a52" stop-opacity="0"/></radialGradient>"##,
        r##"<radialGradient id="agy-orange" gradientUnits="userSpaceOnUse" cx="92" cy="34" r="44"><stop offset="0" stop-color="#f6892c"/><stop offset="1" stop-color="#f6892c" stop-opacity="0"/></radialGradient>"##,
        r##"</defs>"##,
        r##"<path d="M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z" fill="#3b8bff"/>"##,
        r##"<path d="M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z" fill="url(#agy-green)"/>"##,
        r##"<path d="M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z" fill="url(#agy-red)"/>"##,
        r##"<path d="M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z" fill="url(#agy-orange)"/>"##,
    ),
};

/// The panel toggle: a window with its right side marked, filled while the panel is open.
pub static PANEL: Icon = Icon {
    name: "panel",
    view: 16.0,
    body: r#"<rect x="2" y="2.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M10 2.5v11" fill="none" stroke="currentColor" stroke-width="1.25"/>"#,
};
pub static PANEL_OPEN: Icon = Icon {
    name: "panel-open",
    view: 16.0,
    body: r#"<rect x="2" y="2.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M10 2.5v11" fill="none" stroke="currentColor" stroke-width="1.25"/><rect x="10" y="2.5" width="4" height="11" fill="currentColor"/>"#,
};

/// A file's icon from the OpenCode catalog, with one swap: a README is a Markdown file,
/// so it takes the Markdown mark, not the catalog's info badge.
pub fn file_icon(path: &str) -> &'static Icon {
    let icon = rune_theme_opencode::file_icons::file(path);
    if icon.name == "readme" { rune_theme_opencode::file_icons::file("file.md") } else { icon }
}

/// The size every icon draws at, `@opencode/ui`'s 15 points. Desk's design asks some at 12, 13 or 14,
/// and `@opencode/ui` draws those at 15 too.
pub const SIZE: f32 = 15.0;

/// Desk's disclosure chevron: it points right, and turns down while open.
pub fn chevron(k: &rune_kit::Kit, open: bool) -> rune::El {
    rune::icon(&rune_theme_opencode::icons::CHEVRON_RIGHT, SIZE).color(k.c.text_faint).rotate(if open { std::f32::consts::FRAC_PI_2 } else { 0.0 }).motion(k.motion.control)
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_readme_takes_the_markdown_mark() {
        assert_eq!(super::file_icon("README.md").name, super::file_icon("notes.md").name);
        assert_ne!(super::file_icon("README.md").name, "readme");
    }
}
