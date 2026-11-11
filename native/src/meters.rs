//! The plan usage button in the tab bar and the context ring in the session header, as
//! `app/src/renderer/meters.tsx` draws them.

use crate::format;
use crate::protocol::{ClientMessage, ContextReading, PlanUsage, UsageWindow};
use crate::shell::Desk;
use rune::{El, col, el, icon, row, text};
use rune_kit::{Kit, Placement, Progress, popover, scrim};
use std::time::{Duration, Instant};

/// How often the app asks for plan usage. The core probes it at most once a minute.
const USAGE_REFRESH: Duration = Duration::from_secs(5 * 60);

/// Whether the usage popover is open, and when usage was last asked for.
#[derive(Default)]
pub struct Meters {
    open: bool,
    asked_at: Option<Instant>,
}

impl Desk {
    /// Closes the usage popover, as Escape does. Whether it was open.
    pub fn close_usage(&mut self) -> bool {
        std::mem::take(&mut self.meters.open)
    }

    /// Asks for plan usage, and the active project's Space, as the window comes back: files and usage most
    /// likely changed outside Desk then.
    pub fn refresh_outside(&mut self) {
        self.core.send(&ClientMessage::UsageGet);
        self.meters.asked_at = Some(Instant::now());
        if let Some(tab) = self.workspace.active_tab() {
            self.core.send(&ClientMessage::ProjectGet { project: tab.project.clone(), part: "space".into() });
        }
    }

    /// Asks for usage again once its time is up. Returns how long until then.
    pub fn refresh_usage(&mut self) -> Duration {
        match self.meters.asked_at {
            Some(at) if at.elapsed() < USAGE_REFRESH => USAGE_REFRESH - at.elapsed(),
            _ => {
                self.core.send(&ClientMessage::UsageGet);
                self.meters.asked_at = Some(Instant::now());
                USAGE_REFRESH
            }
        }
    }
}

/// The tab bar's plan usage: the fullest window as a small meter, every window in a popover.
pub fn usage_button(s: &Desk, k: &Kit, layer: &mut Vec<El>) -> Option<El> {
    let usage = s.account.usage.as_ref()?;
    let fullest = usage.windows.iter().max_by(|a, b| a.percent.total_cmp(&b.percent))?;
    let button = row()
        .key("usage-button")
        .h(30.0)
        .gap(7.0)
        .items_center()
        .px(9.0)
        .radius(8.0)
        .hover(k.c.hover)
        .fill(if s.meters.open { k.c.hover } else { rune::Color::TRANSPARENT })
        .role("button")
        .label("Plan usage")
        .expanded(s.meters.open)
        .on_press(|s: &mut Desk| s.meters.open = !s.meters.open)
        .child(icon(&crate::icons::GAUGE, 15.0).color(k.c.text_muted))
        .child(meter(fullest.percent as f32 / 100.0, k))
        .child(text(format!("{}%", fullest.percent.round())).font(crate::theme::text(12.0)).color(k.c.text_muted));
    if s.meters.open {
        layer.insert(0, scrim("usage-scrim", |s: &mut Desk| s.meters.open = false));
        layer.push(popover::anchored(k, crate::ui::popover(k, usage_popover(usage, k)), "usage-button", Placement::BottomEnd, 8.0));
    }
    Some(button)
}

/// The title bar's small meter: `@opencode/ui`'s Progress, which the Electron app sets 26 by 5 points.
fn meter(value: f32, k: &Kit) -> El {
    row()
        .w(26.0)
        .h(5.0)
        .radius(999.0)
        .fill(k.c.layer_01)
        .clip_rounded(2.5)
        .role("progressbar")
        .label("Plan usage")
        .child(el().h_full().w_frac(value.clamp(0.0, 1.0)).radius(999.0).fill(k.c.text_muted))
}

fn usage_popover(usage: &PlanUsage, k: &Kit) -> El {
    let heading = text("CLAUDE PLAN USAGE").font(rune::TextStyle { tracking: 0.66, ..k.ty.small_medium }).color(k.c.text_faint);
    col().w(280.0).padding(12.0).gap(12.0).child(heading).children(usage.windows.iter().map(|w| usage_row(w, k)))
}

fn usage_row(window: &UsageWindow, k: &Kit) -> El {
    let reset = window.resets_at.as_deref().and_then(format::iso_ms).map(|at| text(reset_label(at, format::now_ms())).font(crate::theme::text(12.0)).color(k.c.text_faint));
    col()
        .w_full()
        .gap(5.0)
        .child(row().w_full().child(text(window.label.clone()).font(crate::theme::text(13.0)).color(k.c.text_base).grow(1.0)).child(text(format!("{}%", window.percent.round())).font(crate::theme::text(13.0)).color(k.c.text_muted)))
        .child(Progress::new(Some(window.percent as f32 / 100.0)).build(k))
        .children(reset)
}

/// "Resets in 2 h 14 min" within a day, else "Resets Thursday 09:00".
fn reset_label(at_ms: f64, now_ms: f64) -> String {
    let left = at_ms - now_ms;
    if left <= 0.0 {
        return "Resets now".into();
    }
    if left < format::DAY_MS {
        let minutes = (left / 60_000.0).round() as u64;
        return if minutes < 60 { format!("Resets in {minutes} min") } else { format!("Resets in {} h {} min", minutes / 60, minutes % 60) };
    }
    format!("Resets {}", format::weekday_time(at_ms))
}

/// How full the session's context window is, as a ring and a percentage.
pub fn context_ring(reading: &ContextReading, k: &Kit) -> El {
    let help = format!("{} of {} tokens in context", format::grouped(reading.tokens), format::grouped(reading.max_tokens));
    row()
        .key("context-ring")
        .gap(6.0)
        .items_center()
        .px(6.0)
        .help(help)
        .child(crate::ui::progress_circle(k, reading.percent as f32 / 100.0, 15.0, "Context"))
        .child(text(format!("{}%", reading.percent.round())).font(crate::theme::text(13.0)).color(k.c.text_muted))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reset_reads_in_minutes_then_hours_within_a_day() {
        assert_eq!(reset_label(0.0, 1.0), "Resets now");
        assert_eq!(reset_label(45.0 * 60_000.0, 0.0), "Resets in 45 min");
        assert_eq!(reset_label(134.0 * 60_000.0, 0.0), "Resets in 2 h 14 min");
        assert!(reset_label(3.0 * format::DAY_MS, 0.0).starts_with("Resets "));
    }
}
