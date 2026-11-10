//! Glyphs `@opencode/ui` has no icon for, drawn on a 16-unit grid, as `app/src/renderer/icons.tsx` draws
//! them. Everything else comes from the OpenCode catalog.

use rune::Icon;

macro_rules! glyph {
    ($name:ident, $id:literal, $path:literal) => {
        pub static $name: Icon = Icon { name: $id, view: 16.0, body: concat!(r#"<path d=""#, $path, r#"" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>"#) };
    };
}

glyph!(SPARKLE, "sparkle", "M8 2.5l1.4 4.1 4.1 1.4-4.1 1.4L8 13.5l-1.4-4.1L2.5 8l4.1-1.4z");
glyph!(SHIELD_OFF, "shield-off", "M8 1.5l5 2v4c0 3-2.2 5.3-5 6-2.8-.7-5-3-5-6v-4zM2.5 2.5l11 11");

/// Fast mode's bolt, filled.
pub static BOLT_FILLED: Icon = Icon { name: "bolt-filled", view: 16.0, body: r#"<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" fill="currentColor"/>"# };

/// Claude's starburst mark: eight lines through the centre make sixteen rays.
pub static CLAUDE: Icon = Icon {
    name: "claude",
    view: 16.0,
    body: r#"<path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2M5.3 1.9l5.4 12.2M10.7 1.9 5.3 14.1M1.9 5.3l12.2 5.4M14.1 5.3 1.9 10.7" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>"#,
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
