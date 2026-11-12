//! What the running turn is doing now, after T3 Code's `ThreadNow`: one quiet line each at the end of the
//! thread, above the composer. A stop that waits counts its seconds, and offers Force stop once the agent
//! does not answer. A retry of a failed request says which attempt it is and why.
//!
//! rune-kit has no notice line, so these are Desk's own rows, drawn as the queue's line is.

use crate::format;
use crate::protocol::{ClientMessage, Retry};
use crate::shell::Desk;
use crate::threads::Stopping;
use rune::{El, icon, row, text};
use rune_kit::{ButtonVariant, Kit};
use rune_theme_opencode::icons as ic;

/// T3 Code's elapsed time never reads less than a second.
const LEAST_ELAPSED_MS: f64 = 1000.0;
/// Below this, a retry's delay reads in milliseconds.
const DELAY_IN_MS_BELOW: f64 = 1000.0;

impl Desk {
    /// Ends a turn that did not stop when asked. The button reads "Force stopping…" until the turn ends.
    pub fn force_stop(&mut self, tab: &str) {
        if self.threads.force_stopping(tab) {
            self.core.send(&ClientMessage::SessionForceStop { tab_id: tab.to_owned() });
        }
    }
}

/// The lines for `tab`'s running turn: its stop, then its retry.
pub fn lines(s: &Desk, tab: &str, k: &Kit) -> Vec<El> {
    let Some(thread) = s.threads.get(tab) else { return Vec::new() };
    let stop = thread.stopping.as_ref().map(|stop| stop_line(s, tab, stop, k));
    let retry = thread.retry.as_ref().map(|retry| retry_line(retry, k));
    stop.into_iter().chain(retry).collect()
}

/// "Stopping", or "Agent not responding to Stop" with Force stop, and the seconds since the user asked.
fn stop_line(s: &Desk, tab: &str, stop: &Stopping, k: &Kit) -> El {
    let (mark, ink) = if stop.unresponsive { (&ic::WARNING, k.c.warning.fg) } else { (&ic::STOP, k.c.text_faint) };
    let (title, description) = if stop.unresponsive { ("Agent not responding to Stop", Some("It may be short on memory. Force stop kills its processes.")) } else { ("Stopping", None) };
    let elapsed = text(format::duration((s.now_ms - stop.since).max(LEAST_ELAPSED_MS))).font(crate::theme::text(12.0)).color(k.c.text_faint);
    let force = stop.unresponsive.then(|| {
        let tab = tab.to_owned();
        crate::theme::small_button(if stop.forcing { "Force stopping…" } else { "Force stop" })
            .variant(ButtonVariant::Ghost)
            .disabled(stop.forcing)
            .on_press(move |s: &mut Desk| s.force_stop(&tab))
            .build(k)
            .key("force-stop")
    });
    line("stop-notice", mark, ink, title, description.map(str::to_owned), k).child(elapsed).children(force)
}

/// "Retrying (2/10)", with why and when, as a quiet line rather than an error.
fn retry_line(retry: &Retry, k: &Kit) -> El {
    line("retry-note", &ic::REFRESH, k.c.text_faint, &retry_title(retry), Some(retry_detail(retry)), k)
}

fn retry_title(retry: &Retry) -> String {
    format!("Retrying ({}/{})", retry.attempt, retry.max_retries)
}

/// Why the request failed, and when the agent tries again, after T3 Code's `providerErrorPresentation`.
fn retry_detail(retry: &Retry) -> String {
    let delay = retry.delay_ms;
    let when = if delay <= 0.0 {
        String::new()
    } else if delay < DELAY_IN_MS_BELOW {
        format!(" Retrying in {}ms.", delay.round())
    } else {
        let seconds = format!("{:.1}", delay / 1000.0);
        format!(" Retrying in {}s.", seconds.strip_suffix(".0").unwrap_or(&seconds))
    };
    format!("{}{when}", retry.error.trim())
}

/// One line: an icon, a title, a fainter description cut short at the lane's edge, then what the caller adds.
fn line(key: &str, mark: &'static rune::Icon, ink: rune::Color, title: &str, description: Option<String>, k: &Kit) -> El {
    let small = |words: String, color| text(words).font(crate::theme::text(12.0)).color(color);
    let whole = description.as_ref().map_or_else(|| title.to_owned(), |d| format!("{title} {d}"));
    let words = row()
        .grow(1.0)
        .min_w(0.0)
        .gap(6.0)
        .items_center()
        .child(small(title.to_owned(), k.c.text_muted))
        .children(description.map(|d| small(d, k.c.text_faint).truncate().shrink().min_w(0.0).help_when_truncated(whole)));
    row().key(key.to_owned()).w_full().h(24.0).gap(6.0).items_center().px(4.0).child(icon(mark, crate::icons::SIZE).color(ink)).child(words)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn retry(delay_ms: f64) -> Retry {
        Retry { attempt: 2, max_retries: 10, delay_ms, error: "Overloaded ".into() }
    }

    #[test]
    fn a_retry_says_its_attempt_why_and_when() {
        assert_eq!(retry_title(&retry(0.0)), "Retrying (2/10)");
        assert_eq!(retry_detail(&retry(0.0)), "Overloaded");
        assert_eq!(retry_detail(&retry(1500.0)), "Overloaded Retrying in 1.5s.");
        assert_eq!(retry_detail(&retry(2000.0)), "Overloaded Retrying in 2s.");
        assert_eq!(retry_detail(&retry(250.0)), "Overloaded Retrying in 250ms.");
    }

    #[test]
    fn force_stop_goes_once_and_only_to_an_unresponsive_agent() {
        let mut s = Desk::default();
        s.force_stop("t");
        s.threads.apply("t", crate::protocol::ThreadEvent::Stopping { since: 1.0, unresponsive: true });
        s.force_stop("t");
        s.force_stop("t");
        let sent = s.core.sent();
        assert_eq!(sent.iter().filter(|m| m["type"] == "session.forceStop" && m["tabId"] == "t").count(), 1);
    }
}
