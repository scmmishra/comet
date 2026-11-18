//! Appearance's mode tiles and theme cards, after T3 Code's theme settings. Each mode tile draws a small
//! Comet window in the chosen theme, and each theme card shows its light and dark flavour as two circles.
//! rune-kit has no picker of this kind, so these are Comet's own.

use crate::Comet;
use crate::protocol::{ColorTheme, ThemeChoice};
use crate::theme::{self, Swatch};
use rune::{El, col, icon, row, text};
use rune_kit::Kit;

/// The mode tiles' order, as T3 Code lists them.
const MODES: [ThemeChoice; 3] = [ThemeChoice::Auto, ThemeChoice::Light, ThemeChoice::Dark];

/// A mode tile's window drawing, in points.
const WINDOW: [f32; 2] = [168.0, 96.0];

/// A flavour's circle and the room around it, in points.
const CIRCLE: f32 = 56.0;
const CIRCLE_ROOM: f32 = 68.0;

/// The picked ring's width, in points.
const RING: f32 = 2.0;

/// System, Light and Dark, each drawn in the chosen theme.
pub fn modes(s: &Comet, k: &Kit) -> El {
    let theme = s.account.color_theme();
    let mode = s.account.theme();
    row().key("appearance-modes").w_full().gap(12.0).children(MODES.map(|choice| {
        let picked = choice == mode;
        let drawing = match choice {
            ThemeChoice::Light => window(&theme::swatch(theme, false)),
            ThemeChoice::Dark => window(&theme::swatch(theme, true)),
            // The light window on the left half and the dark one on the right.
            ThemeChoice::Auto => {
                let half = WINDOW[0] / 2.0;
                let right = col().absolute(half, 0.0).size(half, WINDOW[1]).clip_rounded(0.0).child(window(&theme::swatch(theme, true)).absolute(-half, 0.0));
                col().size(WINDOW[0], WINDOW[1]).child(window(&theme::swatch(theme, false))).child(right)
            }
        };
        let tile = col()
            .key(format!("mode-{}", choice.id()))
            .grow(1.0)
            .min_w(0.0)
            .items_center()
            .gap(8.0)
            .padding(8.0)
            .radius(10.0)
            .fill(k.c.layer_01)
            .hover(k.c.hover)
            .role("radio")
            .checked(picked)
            .label(choice.label())
            .on_press(move |s: &mut Comet| s.set_theme(choice.id()))
            .child(drawing)
            .child(text(choice.label()).font(theme::medium(12.0)).color(if picked { k.c.text_base } else { k.c.text_muted }));
        if picked { tile.border(RING, k.c.border_focus) } else { tile.border(1.0, k.c.border_muted) }
    }))
}

/// A Comet window in `c`: tabs on the ground, then the session's card with a message, a reply and the message box.
fn window(c: &Swatch) -> El {
    let bar = |w: f32, color| col().size(w, 4.0).radius(2.0).fill(color);
    let tab = |left: f32, w: f32, color| col().absolute(left, 6.0).size(w, 8.0).radius(3.0).fill(color);
    let card = col()
        .pin(Some(6.0), Some(20.0), Some(6.0), Some(6.0))
        .radius(5.0)
        .fill(c.panel)
        .border(1.0, c.line)
        .child(col().absolute(84.0, 8.0).size(56.0, 10.0).radius(4.0).fill(c.raised))
        .child(col().absolute(10.0, 26.0).gap(5.0).child(bar(92.0, c.line)).child(bar(70.0, c.line)))
        .child(
            row()
                .pin(Some(8.0), None, Some(8.0), Some(7.0))
                .h(16.0)
                .px(4.0)
                .items_center()
                .radius(5.0)
                .fill(c.raised)
                .border(1.0, c.line)
                .child(bar(40.0, c.faint.alpha(0.35)))
                .child(col().grow(1.0))
                .child(col().size(8.0, 8.0).radius(4.0).fill(c.accent)),
        );
    col().size(WINDOW[0], WINDOW[1]).radius(6.0).clip_rounded(6.0).fill(c.ground).child(tab(8.0, 30.0, c.raised)).child(tab(42.0, 24.0, c.line)).child(card)
}

/// A card for each theme. Pressing a card uses its theme. Pressing a flavour's circle also switches to its mode.
pub fn themes(s: &Comet, k: &Kit) -> El {
    let current = s.account.color_theme();
    let mode = s.account.theme();
    row().key("appearance-themes").w_full().gap(12.0).children(ColorTheme::ALL.map(|theme| {
        let picked = theme == current;
        let circles = row().gap(10.0).justify_center().w_full().children([false, true].map(|dark| {
            // The flavours the window can show: both under System, else the one the mode names.
            let shown = picked && (mode == ThemeChoice::Auto || (mode == ThemeChoice::Dark) == dark);
            flavour(k, theme, dark, shown)
        }));
        let card = col()
            .key(format!("theme-{}", theme.id()))
            .grow(1.0)
            .min_w(0.0)
            .gap(8.0)
            .pt(10.0)
            .pb(12.0)
            .px(12.0)
            .radius(12.0)
            .fill(k.c.layer_01)
            .hover(k.c.hover)
            .role("radio")
            .checked(picked)
            .label(format!("{} theme", theme.label()))
            .on_press(move |s: &mut Comet| s.set_color_theme(theme))
            .child(circles)
            .child(text(theme.label()).font(theme::medium(13.0)).color(k.c.text_base));
        if picked { card.border(RING, k.c.border_focus) } else { card.border(1.0, k.c.border_muted) }
    }))
}

/// One flavour of `theme` as a circle: its panel, lit by its raised surface from the top right and by its
/// accent from the bottom left, as T3 Code draws a theme's preview. `shown` rings it and marks its mode.
fn flavour(k: &Kit, theme: ColorTheme, dark: bool, shown: bool) -> El {
    let c = theme::swatch(theme, dark);
    // CSS's farthest-corner radius from each glow's centre in a 56-point circle, which T3 Code's gradients use.
    let reach = CIRCLE * 1.06;
    let glow = |center: [f32; 2], stops: Vec<(f32, rune::Color)>| col().absolute(0.0, 0.0).size(CIRCLE, CIRCLE).radial_gradient(center, reach, stops);
    let edge = if dark { rune::Color::WHITE.alpha(0.14) } else { rune::Color::BLACK.alpha(0.10) };
    let disc = col()
        .size(CIRCLE, CIRCLE)
        .radius(CIRCLE / 2.0)
        .clip_rounded(CIRCLE / 2.0)
        .fill(c.panel)
        .border(1.0, edge)
        .child(glow([0.72, 0.22], vec![(0.0, c.raised), (0.28, c.raised.alpha(0.72)), (0.58, c.raised.alpha(0.0))]))
        .child(glow([0.18, 0.82], vec![(0.0, c.accent.alpha(0.45)), (0.55, c.accent.alpha(0.0))]));
    let name = if dark { "dark" } else { "light" };
    let room = col()
        .key(format!("flavour-{}-{name}", theme.id()))
        .size(CIRCLE_ROOM, CIRCLE_ROOM)
        .items_center()
        .justify_center()
        .radius(CIRCLE_ROOM / 2.0)
        .role("button")
        .label(format!("Use {} {name}", theme.label()))
        .help(format!("Use {} in {name} mode", theme.label()))
        .press_scale(0.96)
        .on_press(move |s: &mut Comet| s.set_look(theme, if dark { ThemeChoice::Dark } else { ThemeChoice::Light }))
        .child(disc);
    if !shown {
        return room;
    }
    let mark = col()
        .absolute(CIRCLE_ROOM - 22.0, CIRCLE_ROOM - 22.0)
        .size(20.0, 20.0)
        .radius(10.0)
        .items_center()
        .justify_center()
        .fill(k.c.bg_base)
        .border(1.0, k.c.border_base)
        .child(icon(if dark { &crate::icons::MOON } else { &crate::icons::SUN }, 12.0).color(k.c.text_base));
    room.child(col().absolute(0.0, 0.0).size(CIRCLE_ROOM, CIRCLE_ROOM).radius(CIRCLE_ROOM / 2.0).border(RING, k.c.border_focus)).child(mark)
}
