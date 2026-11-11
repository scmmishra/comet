//! Short messages at the bottom right, after `@opencode/ui`'s toasts:
//! errors the core reports, its notices, and hints such as the first Escape.

use crate::shell::Desk;
use rune::{El, icon};
use rune_kit::{Kit, Toast, ToastRegion};
use rune_theme_opencode::icons as ic;
use std::time::{Duration, Instant};

/// How long a toast stays, as `@opencode/ui`'s default.
const SHOWN_FOR: Duration = Duration::from_secs(5);

struct Item {
    id: u64,
    message: String,
    /// The cause under the message. It wraps, where the message keeps to one line.
    detail: Option<String>,
    error: bool,
    at: Instant,
}

#[derive(Default)]
pub struct Toasts {
    items: Vec<Item>,
    next: u64,
}

impl Toasts {
    /// Shows `message`. An error draws with the danger mark.
    pub fn show(&mut self, message: impl Into<String>, error: bool) {
        self.push(message.into(), None, error);
    }

    /// Shows an error the core reported: what failed, and its cause under it.
    pub fn error(&mut self, message: String, detail: Option<String>) {
        self.push(message, detail, true);
    }

    fn push(&mut self, message: String, detail: Option<String>, error: bool) {
        self.next += 1;
        self.items.push(Item { id: self.next, message, detail, error, at: Instant::now() });
    }

    #[cfg(test)]
    pub fn messages(&self) -> Vec<&str> {
        self.items.iter().map(|t| t.message.as_str()).collect()
    }

    /// Drops toasts whose time is up. Returns whether any left, and how long until the next one goes.
    pub fn expire(&mut self) -> (bool, Option<Duration>) {
        let before = self.items.len();
        self.items.retain(|t| t.at.elapsed() < SHOWN_FOR);
        let next = self.items.iter().map(|t| SHOWN_FOR - t.at.elapsed()).min();
        (self.items.len() != before, next)
    }
}

pub fn region(s: &Desk, k: &Kit) -> Option<El> {
    if s.toasts.items.is_empty() {
        return None;
    }
    let toasts = s.toasts.items.iter().map(|t| {
        let id = t.id;
        let toast = Toast::new(format!("toast-{id}"), t.message.clone()).closable().on_close(move |s: &mut Desk| s.toasts.items.retain(|x| x.id != id));
        let toast = if t.error { toast.lead(icon(&ic::CIRCLE_EXCLAMATION, 16.0).color(k.c.danger.fg)) } else { toast };
        let toast = match &t.detail {
            Some(detail) => toast.description(detail.clone()),
            None => toast,
        };
        toast.build(k)
    });
    Some(toasts.fold(ToastRegion::new(), |region, t| region.toast(t)).build(k))
}
