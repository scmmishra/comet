//! Comet's colour themes under rune-kit's tokens. Components start from the OpenCode theme, which matches `@opencode/ui`, and
//! draw in the colour theme's colours. Those colours stay the source.

use crate::protocol::ColorTheme;
use rune::{Color, TextStyle};
use rune_kit::syntax::Syntax as S;
use rune_kit::syntax::SyntaxTheme;
#[allow(deprecated)]
use rune_kit::{Button, ButtonSize, Kit, MarkdownStyle};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

/// A colour theme's colours for one appearance.
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
    /// Review's added and removed lines and their bars.
    added: &'static str,
    removed: &'static str,
    /// Code's own colour where no token colours it.
    code_fg: &'static str,
    /// Code's colours, by the kinds rune-kit's highlighter tells apart.
    syntax: [(S, &'static str); 15],
}

/// A colour theme: its light and its dark flavour.
struct Flavours {
    light: Colors,
    dark: Colors,
}

/// Comet's own colours. Review and code take @pierre/diffs' pierre-light and pierre-dark colours.
const COMET: Flavours = Flavours {
    dark: Colors {
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
        added: "#07c480",
        removed: "#ff2e3f",
        code_fg: "#fafafa",
        syntax: [(S::Keyword, "#ff678d"), (S::String, "#5ecc71"), (S::Number, "#68cdf2"), (S::Comment, "#737373"), (S::Type, "#d568ea"), (S::Function, "#9d6afb"), (S::Property, "#ffa359"), (S::Punctuation, "#636363"), (S::Operator, "#08c0ef"), (S::Variable, "#ffa359"), (S::Parameter, "#a3a3a3"), (S::Heading, "#ff855e"), (S::Link, "#009fff"), (S::Regex, "#64d1db"), (S::Attribute, "#60d199")],
    },
    light: Colors {
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
        added: "#18a46c",
        removed: "#d52c36",
        code_fg: "#0a0a0a",
        syntax: [(S::Keyword, "#d32a61"), (S::String, "#199f43"), (S::Number, "#1ca1c7"), (S::Comment, "#737373"), (S::Type, "#a631be"), (S::Function, "#693acf"), (S::Property, "#d47628"), (S::Punctuation, "#636363"), (S::Operator, "#08c0ef"), (S::Variable, "#d47628"), (S::Parameter, "#636363"), (S::Heading, "#d5512f"), (S::Link, "#009fff"), (S::Regex, "#17a5af"), (S::Attribute, "#18a46c")],
    },
};

/// Verdigris by Karan Sharma, MIT, from github.com/mr-karan/verdigris at 0.1.0: Limestone is light and Slate is dark.
/// Surfaces take its stone colours as its T3 Code port places them, and code takes its syntax roles.
const VERDIGRIS: Flavours = Flavours {
    dark: Colors {
        ground: "#111615",
        panel: "#151a19",
        code: "#101514",
        card: "#191f1e",
        raised: "#1e2524",
        hover: "#222a28",
        line: "#29312f",
        outline: ("#ffffff", 0.04),
        fg: "#d0d7d3",
        fg_2: "#8e9a96",
        fg_3: "#75827d",
        accent: "#82c3b4",
        add: ("#a3c18d", 0.09),
        del: ("#e38d86", 0.09),
        ready: "#2c6e64",
        tab: "#1e2524",
        tab_hover: ("#151a19", 1.0),
        well: "#1e2524",
        added: "#a3c18d",
        removed: "#e38d86",
        code_fg: "#d0d7d3",
        syntax: [(S::Keyword, "#82c3b4"), (S::String, "#a3c18d"), (S::Number, "#d9a377"), (S::Comment, "#75827d"), (S::Type, "#cabf7f"), (S::Function, "#8fb2d8"), (S::Property, "#d0d7d3"), (S::Punctuation, "#8e9a96"), (S::Operator, "#8e9a96"), (S::Variable, "#d0d7d3"), (S::Parameter, "#d0d7d3"), (S::Heading, "#82c3b4"), (S::Link, "#8fb2d8"), (S::Regex, "#cabf7f"), (S::Attribute, "#cabf7f")],
    },
    light: Colors {
        ground: "#ebece6",
        panel: "#f3f3ee",
        code: "#eaebe5",
        card: "#f7f7f3",
        raised: "#fbfbf8",
        hover: "#e6e8e1",
        line: "#dddfd7",
        outline: ("#000000", 0.07),
        fg: "#252d2a",
        fg_2: "#5c6763",
        fg_3: "#6f7975",
        accent: "#2c6e64",
        add: ("#496c35", 0.09),
        del: ("#a8423f", 0.08),
        ready: "#2c6e64",
        tab: "#fbfbf8",
        tab_hover: ("#000000", 0.04),
        well: "#ecede7",
        added: "#496c35",
        removed: "#a8423f",
        code_fg: "#252d2a",
        syntax: [(S::Keyword, "#2c6e64"), (S::String, "#496c35"), (S::Number, "#8f5226"), (S::Comment, "#6f7975"), (S::Type, "#76611b"), (S::Function, "#3d628a"), (S::Property, "#252d2a"), (S::Punctuation, "#5c6763"), (S::Operator, "#5c6763"), (S::Variable, "#252d2a"), (S::Parameter, "#252d2a"), (S::Heading, "#2c6e64"), (S::Link, "#3d628a"), (S::Regex, "#76611b"), (S::Attribute, "#76611b")],
    },
};

/// The colour theme the window draws in. Comet has one window, and the shell sets this from the settings
/// before it draws, so the helpers below that take only `dark` follow it.
static ACTIVE: AtomicU8 = AtomicU8::new(0);

/// Draws the window in `theme` from the next kit on.
pub fn use_color_theme(theme: ColorTheme) {
    ACTIVE.store(index(theme) as u8, Ordering::Relaxed);
}

fn active() -> ColorTheme {
    ColorTheme::ALL[ACTIVE.load(Ordering::Relaxed) as usize]
}

fn index(theme: ColorTheme) -> usize {
    ColorTheme::ALL.iter().position(|t| *t == theme).unwrap_or(0)
}

fn flavour(theme: ColorTheme, dark: bool) -> &'static Colors {
    let flavours = match theme {
        ColorTheme::Comet => &COMET,
        ColorTheme::Verdigris => &VERDIGRIS,
    };
    if dark { &flavours.dark } else { &flavours.light }
}

fn colors(dark: bool) -> &'static Colors {
    flavour(active(), dark)
}

/// The colours a preview of a colour theme draws in, such as Appearance's theme cards.
pub struct Swatch {
    pub ground: Color,
    pub panel: Color,
    pub raised: Color,
    pub line: Color,
    pub accent: Color,
    pub faint: Color,
}

pub fn swatch(theme: ColorTheme, dark: bool) -> Swatch {
    let d = flavour(theme, dark);
    Swatch { ground: color(d.ground), panel: color(d.panel), raised: color(d.raised), line: color(d.line), accent: color(d.accent), faint: color(d.fg_3) }
}

fn color(hex: &str) -> Color {
    rune::color::hex(hex).unwrap_or_else(|| panic!("{hex} is a colour"))
}

/// The kit for one appearance, built once.
pub fn kit(dark: bool) -> &'static Kit {
    static KITS: [[OnceLock<Kit>; 2]; ColorTheme::ALL.len()] = [const { [const { OnceLock::new() }; 2] }; ColorTheme::ALL.len()];
    let theme = active();
    KITS[index(theme)][dark as usize].get_or_init(|| build(dark, flavour(theme, dark)))
}

/// The kit Review's DiffView draws with: Comet's kit, with the colours DiffView reads from it set as
/// @pierre/diffs draws a diff. The theme's added and removed colours tint the changed lines and their
/// bars, line numbers take code's foreground mixed 65% with the panel, and file headers sit on the panel
/// under faint lines.
pub fn review_kit(dark: bool) -> &'static Kit {
    static KITS: [[OnceLock<Kit>; 2]; ColorTheme::ALL.len()] = [const { [const { OnceLock::new() }; 2] }; ColorTheme::ALL.len()];
    KITS[index(active())][dark as usize].get_or_init(|| {
        let mut k = kit(dark).clone();
        let d = colors(dark);
        k.c.success.icon = color(d.added);
        k.c.danger.icon = color(d.removed);
        k.c.text_muted = code_foreground(dark).mix(k.c.bg_base, 0.35);
        k.c.layer_01 = k.c.bg_base;
        // The lines under file headers and between files, in Comet's faint outline colour.
        k.c.border_weak = outline(dark);
        k
    })
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

/// How things leave when they close, such as a popover or an open fold's steps: one quick fade, so
/// closing feels as fast as opening. Rune's own exits fade over 0.25 to 0.32 springs.
pub fn quick_exit() -> rune::Transition {
    const EXIT: rune::Spring = rune::Spring::new(0.12, 0.0);
    rune::Transition::opacity().springs(rune::SpringPair::new(EXIT, EXIT))
}

/// Code blocks' surface, Comet's `--color-code`.
pub fn code_fill(dark: bool) -> Color {
    color(colors(dark).code)
}

/// Comet's `--color-tab`, `--color-tab-hover` and `--color-well`.
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

/// Comet's `--color-accent-soft`: the accent, faint, as the terminal's selection.
pub fn accent_soft(dark: bool) -> Color {
    color(colors(dark).accent).alpha(if dark { 0.14 } else { 0.10 })
}

/// Comet's `--color-outline`.
pub fn outline(dark: bool) -> Color {
    let (hex, alpha) = colors(dark).outline;
    color(hex).alpha(alpha)
}

/// Claude's mark, Comet's `--color-claude`.
pub fn claude() -> Color {
    color("#d97757")
}

/// Fast mode's bolt, Comet's `--color-fast`.
pub fn fast(dark: bool) -> Color {
    color(if dark { "#f5c542" } else { "#c98a00" })
}

/// `@opencode/ui`'s small Button: 24 points tall, padded 9, radius 4.
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

/// Comet's own text: Geist at weight 400, line height 1.5, no tracking.
/// `@opencode/ui`'s components, such as buttons and tags, keep the kit's styles.
pub const fn text(size: f32) -> TextStyle {
    TextStyle::new(size, 400.0).lh(size * 1.5)
}

/// Comet's `font-medium`. `@opencode/ui`'s theme sets the weight to 530.
pub const fn medium(size: f32) -> TextStyle {
    TextStyle::new(size, 530.0).lh(size * 1.5)
}

/// Comet's code text, Geist Mono at weight 400.
pub const fn mono(size: f32) -> TextStyle {
    TextStyle::new(size, 400.0).mono().lh(size * 1.5)
}

/// The thread's text at `size` points, with Comet's line height.
pub fn thread_text(k: &Kit, size: f32) -> TextStyle {
    TextStyle { size, line_height: (size * THREAD_LINE_HEIGHT).round(), ..k.ty.body }
}

/// The message box's text and queued messages: the thread's size on Comet's `leading-relaxed`, which is 1.5.
pub fn composer_text(k: &Kit, size: f32) -> TextStyle {
    TextStyle { size, line_height: size * 1.5, ..k.ty.body }
}

/// Comet's `leading-[1.625]` for messages and replies.
const THREAD_LINE_HEIGHT: f32 = 1.625;

/// Replies in the thread: the thread's text, and code a step darker than the panel.
/// Comet's prose: list indents, faint markers, headings, inline code and quotes.
pub fn markdown(k: &Kit, size: f32) -> MarkdownStyle {
    let d = colors(k.dark);
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
        // rune-kit's checkbox is 16 points, 8 in, which ends past Comet's 20 point indent and meets the text.
        // A 14 point box at the indent's start leaves a 6 point gap. Its colours are rune-kit's own.
        .task_checkbox(14.0, k.radius.sm, 0.0, None, k.c.surface_weak, k.c.std_icon, Color::TRANSPARENT, k.c.border_weak)
        .muted(k.c.text_faint)
        .inline_code_font(0.92, 400.0)
        .inline_code_bg(color(d.raised))
        // rune-kit's 3.5 point pad, short of the 5 points Comet's design asks for: rune-kit pads code with narrow spaces sized
        // to the pad, and at 5 points they outgrow the text, which makes a line with code taller than the rest.
        .quote(color(d.line), 2.0, 10.0, k.c.text_muted)
        .rule(color(d.line))
        .link(k.c.text_accent)
        // Links, file links among them, draw in the accent without an underline.
        .link_underline(Color::TRANSPARENT)
        // A code block is one flat surface, with no outline.
        .code_block(color(d.code), Color::TRANSPARENT)
        .syntax_theme(code_colors(k.dark))
}

/// Code's own colour where no token colours it.
pub fn code_foreground(dark: bool) -> Color {
    color(colors(dark).code_fg)
}

/// Code highlighted in the colour theme's syntax colours.
pub fn code_colors(dark: bool) -> SyntaxTheme {
    colors(dark).syntax.into_iter().fold(SyntaxTheme::from_kit(kit(dark)), |theme, (kind, hex)| theme.with(kind, color(hex)))
}

/// Comet's typefaces, Geist and Geist Mono. Variable fonts, so every
/// weight the kit asks for draws. From github.com/vercel/geist-font at ef2597c, under the OFL in `assets/fonts`.
pub const FONTS: &[&[u8]] = &[include_bytes!("../assets/fonts/Geist-Variable.ttf"), include_bytes!("../assets/fonts/GeistMono-Variable.ttf")];
pub const FAMILIES: (&str, &str) = ("Geist", "Geist Mono");
