//! Desk's palette under rune-kit's tokens, as `app/src/renderer/index.css` puts it under
//! `@opencode/ui`'s. Components start from the OpenCode theme, which matches `@opencode/ui`, and
//! draw in Desk's colours. Desk's colours stay the source.

use rune::{Color, TextStyle};
#[allow(deprecated)]
use rune_kit::{Button, ButtonSize, Kit, MarkdownStyle};
use std::sync::OnceLock;

/// Desk's colours for one appearance, named as in `index.css`.
struct Colors {
    ground: &'static str,
    panel: &'static str,
    /// Code in the thread: a step darker than the panel it sits on, short of the window's ground.
    code: &'static str,
    card: &'static str,
    raised: &'static str,
    hover: &'static str,
    line: &'static str,
    /// Black or white, at `outline_alpha`.
    outline: (&'static str, f32),
    fg: &'static str,
    fg_2: &'static str,
    fg_3: &'static str,
    accent: &'static str,
    add: (&'static str, f32),
    del: (&'static str, f32),
    ready: &'static str,
    /// The active tab, a tab under the pointer, and a quiet box inside the thread.
    tab: &'static str,
    tab_hover: (&'static str, f32),
    well: &'static str,
}

const DARK: Colors = Colors {
    ground: "#08090a",
    panel: "#0f1011",
    code: "#0b0c0d",
    card: "#131416",
    raised: "#1c1d1f",
    hover: "#222326",
    line: "#232427",
    outline: ("#ffffff", 0.04),
    fg: "#e3e4e8",
    fg_2: "#8a8f98",
    fg_3: "#62666d",
    accent: "#6ea8fe",
    add: ("#62c28a", 0.09),
    del: ("#e8777e", 0.09),
    ready: "#3d5fe0",
    tab: "#1c1d1f",
    tab_hover: ("#0f1011", 1.0),
    well: "#1c1d1f",
};

const LIGHT: Colors = Colors {
    ground: "#f2f3f5",
    panel: "#ffffff",
    code: "#f6f7f9",
    card: "#fafafb",
    raised: "#eef0f2",
    hover: "#e7e9ec",
    line: "#e1e3e7",
    outline: ("#000000", 0.07),
    fg: "#1c1d20",
    fg_2: "#5f646d",
    fg_3: "#8b9099",
    accent: "#2b6be0",
    add: ("#1f8a4c", 0.09),
    del: ("#cf3b45", 0.08),
    ready: "#3d5fe0",
    tab: "#ffffff",
    tab_hover: ("#000000", 0.04),
    well: "#f5f6f8",
};

fn color(hex: &str) -> Color {
    rune::color::hex(hex).unwrap_or_else(|| panic!("{hex} is a colour"))
}

/// The kit for one appearance, built once.
pub fn kit(dark: bool) -> &'static Kit {
    static KITS: [OnceLock<Kit>; 2] = [const { OnceLock::new() }; 2];
    KITS[dark as usize].get_or_init(|| build(dark, if dark { &DARK } else { &LIGHT }))
}

fn build(dark: bool, d: &Colors) -> Kit {
    let mut k = rune_theme_opencode::kit(dark).clone();
    let c = &mut k.c;
    let (ground, panel, card, raised, hover, line) = (color(d.ground), color(d.panel), color(d.card), color(d.raised), color(d.hover), color(d.line));
    let (fg, fg_2, fg_3, accent) = (color(d.fg), color(d.fg_2), color(d.fg_3), color(d.accent));
    c.page = ground;
    c.bg_deep = ground;
    c.bg_base = panel;
    c.layer_01 = card;
    c.layer_02 = raised;
    c.layer_03 = hover;
    c.layer_04 = line;
    c.bg_accent = color(d.ready);

    c.text_base = fg;
    c.text_muted = fg_2;
    c.text_faint = fg_3;
    c.text_inverse = ground;
    c.text_accent = accent;

    c.icon_base = fg_2;
    c.icon_muted = fg_3;
    c.icon_faint = fg_3;
    c.icon_contrast = fg;
    c.icon_inverse = ground;
    c.icon_accent = accent;

    c.border_muted = color(d.outline.0).alpha(d.outline.1);
    c.border_base = line;
    c.border_focus = accent;
    c.hover = hover;

    c.success.fg = color(d.add.0);
    c.success.bg = color(d.add.0).alpha(d.add.1);
    c.danger.fg = color(d.del.0);
    c.danger.bg = color(d.del.0).alpha(d.del.1);

    // The older tokens a few components still read.
    c.surface_base = card;
    c.surface_hover = hover;
    c.surface_raised = raised;
    c.text_strong = fg;
    c.text_weak = fg_3;
    k
}

/// Desk's `--color-tab`, `--color-tab-hover` and `--color-well`.
pub fn tab(dark: bool) -> Color {
    color(colors(dark).tab)
}

pub fn tab_hover(dark: bool) -> Color {
    let (hex, alpha) = colors(dark).tab_hover;
    color(hex).alpha(alpha)
}

pub fn well(dark: bool) -> Color {
    color(colors(dark).well)
}

/// Desk's `--color-outline`.
pub fn outline(dark: bool) -> Color {
    let (hex, alpha) = colors(dark).outline;
    color(hex).alpha(alpha)
}

fn colors(dark: bool) -> &'static Colors {
    if dark { &DARK } else { &LIGHT }
}

/// Claude's mark, Desk's `--color-claude`.
pub fn claude() -> Color {
    color("#d97757")
}

/// Fast mode's bolt, Desk's `--color-fast`.
pub fn fast(dark: bool) -> Color {
    color(if dark { "#f5c542" } else { "#c98a00" })
}

/// `@opencode/ui`'s small Button, as Desk's Electron app draws it: 24 points tall, padded 9, radius 4.
/// rune-kit's `ControlSize` sizes follow AppKit's instead, so this keeps its `@opencode/ui` size, which
/// it marks deprecated.
#[allow(deprecated)]
pub fn small_button(label: impl Into<String>) -> Button {
    Button::new(label).size(ButtonSize::Small)
}

/// `@opencode/ui`'s Button at its default size: 28 points tall, padded 11.
#[allow(deprecated)]
pub fn button(label: impl Into<String>) -> Button {
    Button::new(label).size(ButtonSize::Normal)
}

/// Desk's own text, as the Electron app sets it: Geist at weight 400, line height 1.5, no tracking.
/// `@opencode/ui`'s components, such as buttons and tags, keep the kit's styles.
pub const fn text(size: f32) -> TextStyle {
    TextStyle::new(size, 400.0).lh(size * 1.5)
}

/// Desk's `font-medium`. `@opencode/ui`'s theme sets the weight to 530.
pub const fn medium(size: f32) -> TextStyle {
    TextStyle::new(size, 530.0).lh(size * 1.5)
}

/// Desk's code text, Geist Mono at weight 400.
pub const fn mono(size: f32) -> TextStyle {
    TextStyle::new(size, 400.0).mono().lh(size * 1.5)
}

/// The thread's text at `size` points, with Desk's line height.
pub fn thread_text(k: &Kit, size: f32) -> TextStyle {
    TextStyle { size, line_height: (size * THREAD_LINE_HEIGHT).round(), ..k.ty.body }
}

/// Desk's `leading-[1.625]` for messages and replies.
const THREAD_LINE_HEIGHT: f32 = 1.625;

/// Replies in the thread: the thread's text, and code a step darker than the panel.
/// The values follow `.desk-prose` in the Electron app's `index.css`.
pub fn markdown(k: &Kit, size: f32) -> MarkdownStyle {
    let d = if k.dark { &DARK } else { &LIGHT };
    let heading = |points: f32| TextStyle::new(points, 600.0).lh((points * 1.3).round());
    MarkdownStyle::from_kit(k)
        .body_font(thread_text(k, size))
        .heading_font(1, heading(20.0))
        .heading_font(2, heading(18.0))
        .heading_font(3, heading(16.0))
        .heading_font(4, heading(size))
        .heading_font(5, heading(size))
        .heading_font(6, heading(size))
        .strong_weight(600.0)
        // A 20 point indent with the marker centred in it, in the faint text colour, as a disc marker draws there.
        .list(20.0, 4.0)
        .muted(k.c.text_faint)
        .inline_code_font(0.92, 400.0)
        .inline_code_bg(color(d.raised))
        .inline_code_pad(5.0)
        .quote(color(d.line), 2.0, 10.0, k.c.text_muted)
        .rule(color(d.line))
        .link(k.c.text_accent)
        // A code block is one flat surface, with no outline.
        .code_block(color(d.code), Color::TRANSPARENT)
}

/// Desk's typefaces, Geist and Geist Mono, as the Electron app loads them. Variable fonts, so every
/// weight the kit asks for draws. From github.com/vercel/geist-font at ef2597c, under the OFL in `assets/fonts`.
pub const FONTS: &[&[u8]] = &[include_bytes!("../assets/fonts/Geist-Variable.ttf"), include_bytes!("../assets/fonts/GeistMono-Variable.ttf")];
pub const FAMILIES: (&str, &str) = ("Geist", "Geist Mono");
