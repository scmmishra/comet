//! `@opencode/ui` components rune-kit has no counterpart for, drawn as `@opencode/ui` draws them.

use rune::{Color, El, Icon, TextStyle, el, icon, row, text};
use std::sync::Mutex;
use rune_kit::Kit;

/// `@opencode/ui`'s DiffChanges: `+3 -1` in the add and remove colours, 11 points at weight 440.
pub fn diff_changes(k: &Kit, added: u32, removed: u32) -> El {
    let font = TextStyle::new(11.0, 440.0).lh(11.0).tracking(0.05);
    row().gap(8.0).items_center().child(text(format!("+{added}")).font(font).color(k.c.success.fg)).child(text(format!("-{removed}")).font(font).color(k.c.danger.fg))
}

/// `@opencode/ui`'s ProgressCircle: a 2 point ring, its arc in the muted text colour on a `layer-04`
/// track. rune-kit's draws both in its muted icon colour, so Desk draws its own.
pub fn progress_circle(k: &Kit, value: f32, size: f32, label: &str) -> El {
    el().role("progressbar")
        .label(label.to_owned())
        .size(size, size)
        .child(icon(&RING, size).absolute(0.0, 0.0).color(k.c.layer_04))
        .child(icon(arc(value), size).absolute(0.0, 0.0).color(k.c.text_muted))
}

static RING: Icon = Icon { name: "desk-progress-ring", view: 16.0, body: r#"<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none"/>"# };

/// The arc for `value`, in steps of 2%. Icons are static, so each step is made once and kept.
fn arc(value: f32) -> &'static Icon {
    static ARCS: Mutex<Vec<Option<&'static Icon>>> = Mutex::new(Vec::new());
    let step = (value.clamp(0.0, 1.0) * 50.0).round() as usize;
    let mut arcs = ARCS.lock().unwrap_or_else(|e| e.into_inner());
    arcs.resize(51, None);
    if let Some(arc) = arcs[step] {
        return arc;
    }
    let angle = step as f32 / 50.0 * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
    let (x, y) = (8.0 + 6.0 * angle.cos(), 8.0 + 6.0 * angle.sin());
    let body = match step {
        0 => String::new(),
        50 => RING.body.to_owned(),
        _ => format!(r#"<path d="M8 2A6 6 0 {} 1 {x:.3} {y:.3}" stroke="currentColor" stroke-width="2" fill="none"/>"#, u8::from(step > 25)),
    };
    let name: &'static str = Box::leak(format!("desk-progress-arc-{step}").into_boxed_str());
    let arc: &'static Icon = Box::leak(Box::new(Icon { name, view: 16.0, body: Box::leak(body.into_boxed_str()) }));
    arcs[step] = Some(arc);
    arc
}

/// `@opencode/ui`'s Badge in colours of the caller's choosing, as the Electron app's checks badge asks
/// for them with `border-0 bg-del-soft text-del`: 16 points tall, 11 point text at weight 530.
/// rune-kit's Badge takes only its own variants' colours.
pub fn tinted_badge(label: impl Into<String>, fill: Color, ink: Color) -> El {
    row()
        .h(16.0)
        .px(4.0)
        .radius(2.0)
        .items_center()
        .fill(fill)
        .child(text(label.into()).font(TextStyle::new(11.0, 530.0).lh(11.0).tracking(0.05)).color(ink))
}
