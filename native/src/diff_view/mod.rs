//! Rune's diff view (`rune-kit/src/diff` at bbe7324), copied for what rune-kit's `DiffView` does not do:
//! sections of a diff (`set_sections`, `section`), a 40 point file header, hairlines between files and a
//! fade for rows that leave. rune-kit's own now takes a file header, a syntax theme and a code font.
//!
//! Copyright (c) 2026 Anomaly. MIT License: the permission notice in Rune's LICENSE applies to this
//! module, which is a modified copy of Rune's.

//! A diff view for reviewing changes: files of hunks, unified or split, with word changes,
//! syntax colours, expandable unchanged ranges, line annotations and line selection, on a
//! virtual list that keeps a fifty-thousand-line diff at frame rate.
//!
//! [`parse`] reads a patch (`git diff`) and `FileDiff::from_texts` diffs two texts. The app
//! keeps a [`DiffState`] of the files in its state and draws it with [`DiffView`].

mod copy;
mod model;
mod myers;
mod pairs;
mod state;
mod view;
mod words;

pub use model::{FileDiff, FileStatus, parse};
pub use state::{DiffMode, DiffState};
pub use view::DiffView;


/// `rune-kit`'s private `palette::tint`: `base` moved `t` of the way to `hue` in OKLab, keeping its alpha.
pub(crate) fn tint(base: rune::Color, hue: rune::Color, t: f32) -> rune::Color {
    let [a, b] = [base.to_oklab(), hue.to_oklab()];
    rune::Color::from_oklab([0, 1, 2, 3].map(|i| if i == 3 { a[3] } else { a[i] + (b[i] - a[i]) * t }))
}
