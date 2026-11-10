//! The cards beside the thread, as `app.tsx` stacks them in its rail: the subagents of the turn, the
//! Space card, then plugin cards. The rail shows once the session is wide enough, and the thread's lane
//! moves aside for it.

use crate::format;
use crate::icons;
use crate::protocol::{Space, Subagent, TabInfo, ThreadItem};
use crate::shell::Desk;
use crate::theme;
use rune::{El, ScrollSpec, col, el, icon, row, text};
use rune_kit::{Badge, Kit, Markdown, Placement, popover, scrim};
use rune_theme_opencode::icons as ic;

/// The rail's width, `w-[264px]`, and its distance from the session's edge.
pub const RAIL_WIDTH: f32 = 264.0;
const RAIL_EDGE: f32 = 8.0;
/// The cards' 264 points, their 8 from the edge, and a 16 point gap to the lane, Desk's `--rail-space`.
const RAIL_SPACE: f32 = 288.0;
/// From this session width, the rail shows beside the lane, Desk's `@container session (min-width: 904px)`.
const RAIL_FROM: f32 = 904.0;
/// The lane keeps this far from the session's sides, Desk's `--lane-edge`.
const EDGE: f32 = 16.0;
/// A subagent's detail, `w-[min(440px,…)]`.
const DETAIL_WIDTH: f32 = 440.0;

/// Where the thread's lane sits in the session: its left edge and its width.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lane {
    pub left: f32,
    pub width: f32,
}

impl Lane {
    /// The lane for a session `width` wide, as `.desk-lane` places it: centred, unless the rail shows, when it
    /// moves left as far as it must to keep clear of the cards.
    pub fn for_session(width: f32, column: f32) -> Lane {
        if width >= RAIL_FROM {
            let lane = column.min(width - RAIL_SPACE - EDGE);
            Lane { left: EDGE.max(((width - lane) / 2.0).min(width - RAIL_SPACE - lane)), width: lane }
        } else {
            let lane = column.min(width - 2.0 * EDGE);
            Lane { left: (width - lane) / 2.0, width: lane }
        }
    }

    pub fn rail(width: f32) -> bool {
        width >= RAIL_FROM
    }
}

/// The open subagent's detail, by id.
#[derive(Default)]
pub struct Cards {
    open_subagent: Option<String>,
}

/// The rail of cards for a tab, pinned to the session's top right.
pub fn rail(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let subagents = subagents_card(s, tab, k, layer);
    let space = s.projects.get(&tab.project).and_then(|p| p.space.as_ref()).map(|space| space_card(space, &tab.id, k));
    col()
        .key("rail")
        .w(RAIL_WIDTH)
        .gap(8.0)
        .pb(8.0)
        .pin(None, Some(0.0), Some(RAIL_EDGE), Some(0.0))
        .scroll(ScrollSpec { stick_bottom: false })
        .children(subagents)
        .children(space)
        .children(crate::commands_card::card(s, &tab.project, k, layer))
        .children(plugin_cards(s, tab, k))
}

/// Plugin cards, after the project's own. A card that draws nothing is left out.
fn plugin_cards(s: &Desk, tab: &TabInfo, k: &Kit) -> Vec<El> {
    let Some(layout) = s.plugins.layouts.get(&tab.id) else { return Vec::new() };
    layout
        .cards
        .iter()
        .filter(|view| !s.plugins.is_empty(view))
        .map(|view| card(k).key(format!("card-{}", view.id)).padding(12.0).gap(4.0).child(text(view.title.clone()).font(k.ty.text_xsmall).color(k.c.text_faint)).child(crate::plugins::view(s, view, &tab.project, k)))
        .collect()
}

fn card(k: &Kit) -> El {
    col().w_full().radius(12.0).fill(k.c.layer_01).border(1.0, k.c.border_muted)
}

/// One line of a card: an icon, the words, and quieter words at the end.
fn line(k: &Kit, mark: &'static rune::Icon, words: String, detail: Option<El>) -> El {
    row()
        .w_full()
        .gap(10.0)
        .items_center()
        .px(8.0)
        .py(7.0)
        .radius(8.0)
        .child(icon(mark, 15.0).color(k.c.text_muted))
        .child(text(words).font(k.ty.ui).color(k.c.text_base).truncate().grow(1.0))
        .children(detail)
}

/// The Space card: where the session runs and what has changed there. GitHub's pull request and checks sit
/// below a line, when the branch has one.
fn space_card(space: &Space, tab: &str, k: &Kit) -> El {
    let faint = |words: String| text(words).font(k.ty.ui).color(k.c.text_faint);
    let upstream = space.upstream.as_ref().and_then(|u| {
        let parts: Vec<String> = [(u.ahead, "↑"), (u.behind, "↓")].iter().filter(|(n, _)| *n > 0).map(|(n, a)| format!("{a}{n}")).collect();
        (!parts.is_empty()).then(|| faint(parts.join(" ")))
    });
    let c = &space.changes;
    let changes = if c.files == 0 {
        faint("None".into())
    } else if c.additions == 0 && c.deletions == 0 {
        faint(format::plural(c.files as usize, "file"))
    } else {
        row().gap(6.0).child(text(format!("+{}", c.additions)).font(k.ty.text_xsmall).color(k.c.success.fg)).child(text(format!("−{}", c.deletions)).font(k.ty.text_xsmall).color(k.c.danger.fg))
    };
    let tab = tab.to_owned();
    // The card counts uncommitted work, so it opens Review on the same changes.
    let changes_line = line(k, &ic::REVIEW, "Changes".into(), Some(changes)).hover(k.c.bg_base).role("button").on_press(move |s: &mut Desk| s.open_review(&tab, "git"));
    let local = col().w_full().padding(6.0).child(line(k, &ic::FOLDER, format::short_path(&space.root), None)).child(el().h(6.0)).child(line(k, &ic::BRANCH, space.branch.clone(), upstream)).child(changes_line);
    let pr = space.pr.as_ref().map(|pr| {
        let (state, accent) = match (pr.state.as_str(), pr.draft) {
            ("MERGED", _) => ("Merged", false),
            ("CLOSED", _) => ("Closed", false),
            (_, true) => ("Draft", false),
            _ => ("Ready", true),
        };
        let badge = Badge::new(state).build(k);
        let badge = if accent { badge.fill(k.c.bg_accent) } else { badge };
        let url = pr.url.clone();
        let head = row()
            .w_full()
            .gap(10.0)
            .px(8.0)
            .py(7.0)
            .radius(8.0)
            .hover(k.c.bg_base)
            .role("link")
            .on_press_tx(move |s: &mut Desk, tx| {
                if let Err(e) = tx.open_url(&url) {
                    s.toasts.show(e.to_string(), true);
                }
            })
            .child(icon(&icons::PULL_REQUEST, 15.0).color(k.c.text_muted))
            .child(
                col()
                    .grow(1.0)
                    .min_w(0.0)
                    .gap(2.0)
                    .child(text(pr.title.clone()).font(k.ty.ui).color(k.c.text_base).wrap())
                    .child(row().w_full().items_center().child(text(format!("#{}", pr.number)).font(k.ty.mono).color(k.c.text_faint).grow(1.0)).child(badge)),
            );
        let total = pr.checks.passed + pr.checks.failed + pr.checks.pending;
        let checks = (total > 0).then(|| {
            let (words, fg) = if pr.checks.failed > 0 {
                (format!("{} failing", pr.checks.failed), k.c.danger.fg)
            } else if pr.checks.pending > 0 {
                (format!("{} running", pr.checks.pending), k.c.text_muted)
            } else {
                (format!("{} / {total}", pr.checks.passed), k.c.success.fg)
            };
            line(k, &ic::CHECK, "Checks".into(), Some(text(words).font(k.ty.text_xsmall).color(fg)))
        });
        col().w_full().padding(6.0).border_sides([1.0, 0.0, 0.0, 0.0], k.c.border_muted).child(head).children(checks)
    });
    card(k).key("space-card").child(local).children(pr)
}

fn status(subagent: &Subagent) -> (&'static str, fn(&Kit) -> rune::Color) {
    match subagent.status.as_str() {
        "running" => ("Running", |k| k.c.text_accent),
        "completed" => ("Done", |k| k.c.success.fg),
        "failed" => ("Failed", |k| k.c.danger.fg),
        _ => ("Stopped", |k| k.c.text_faint),
    }
}

fn elapsed(subagent: &Subagent, now: f64) -> String {
    format::duration((subagent.ended_at.unwrap_or(now) - subagent.started_at).max(0.0))
}

/// Claude's mark with a dot for how the subagent stands.
fn status_mark(subagent: &Subagent, k: &Kit) -> El {
    el().size(16.0, 16.0)
        .child(icon(&icons::CLAUDE, 16.0).color(theme::claude()))
        .child(el().absolute(11.0, 11.0).size(7.0, 7.0).radius(3.5).fill((status(subagent).1)(k)).border(2.0, k.c.layer_01))
}

/// The subagents Claude started, at the top of the stack. The card shows while one runs, or while the turn
/// that started them runs. A subagent opens beside the card with what it has done so far.
fn subagents_card(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> Option<El> {
    let thread = s.threads.get(&tab.id)?;
    let mut list: Vec<&Subagent> = thread.subagents.iter().collect();
    list.sort_by(|a, b| a.started_at.total_cmp(&b.started_at));
    let running = list.iter().filter(|x| x.status == "running").count();
    if running == 0 && !(thread.busy && !list.is_empty()) {
        return None;
    }
    let now = s.now_ms;
    let heading = if running > 0 { format!("Subagents · {running} running") } else { "Subagents".into() };
    let rows = list.iter().map(|subagent| {
        let open = s.cards.open_subagent.as_deref() == Some(subagent.id.as_str());
        let id = subagent.id.clone();
        let key = format!("subagent-{}", subagent.id);
        if open {
            layer.insert(0, scrim("subagent-scrim", |s: &mut Desk| s.cards.open_subagent = None));
            layer.push(popover::anchored(k, popover::raised(k, subagent_detail(subagent, now, k), 10.0), &key, Placement::Left, 12.0));
        }
        row()
            .key(key)
            .w_full()
            .gap(10.0)
            .items_center()
            .px(8.0)
            .py(7.0)
            .radius(8.0)
            .fill(if open { k.c.bg_base } else { rune::Color::TRANSPARENT })
            .hover(k.c.bg_base)
            .role("button")
            .expanded(open)
            .on_press(move |s: &mut Desk| s.cards.open_subagent = if s.cards.open_subagent.as_deref() == Some(id.as_str()) { None } else { Some(id.clone()) })
            .child(status_mark(subagent, k))
            .child(text(subagent.description.clone()).font(k.ty.text_small).color(k.c.text_base).truncate().grow(1.0))
            .child(text(elapsed(subagent, now)).font(k.ty.text_xsmall).color(k.c.text_faint))
            .child(icon(&ic::CHEVRON_DOWN, 12.0).color(k.c.text_faint).rotate(-std::f32::consts::FRAC_PI_2))
    });
    Some(card(k).key("subagents-card").padding(6.0).role("region").label("Subagents").child(text(heading).font(k.ty.text_xsmall).color(k.c.text_faint).px(8.0).pb(4.0).pt(6.0)).children(rows.collect::<Vec<_>>()))
}

/// What a subagent was asked, how it stands, and its steps so far.
fn subagent_detail(subagent: &Subagent, now: f64, k: &Kit) -> El {
    let facts: Vec<String> = [subagent.kind.clone(), Some(status(subagent).0.to_owned()), Some(elapsed(subagent, now)), (subagent.tool_uses > 0).then(|| format::plural(subagent.tool_uses as usize, "tool use"))].into_iter().flatten().collect();
    let header = col()
        .w_full()
        .px(16.0)
        .py(12.0)
        .border_sides([0.0, 0.0, 1.0, 0.0], k.c.border_muted)
        .child(row().gap(8.0).items_center().child(status_mark(subagent, k)).child(text(subagent.description.clone()).font(k.ty.text_small_medium).color(k.c.text_base).truncate()))
        .child(text(facts.join(" · ")).font(k.ty.text_xsmall).color(k.c.text_faint).mt(4.0))
        .children(subagent.summary.clone().map(|summary| text(summary).font(k.ty.text_small).color(k.c.text_muted).wrap().mt(6.0)));
    let steps = subagent.items.iter().map(|item| match item {
        ThreadItem::Tool { label, .. } | ThreadItem::Thinking { label, .. } => text(label.clone()).font(k.ty.text_small).color(k.c.text_muted).truncate().h(24.0),
        ThreadItem::Text { text: words, .. } => Markdown::new(words.as_str()).style(theme::markdown(k, 13.0)).build(k).my(4.0),
        _ => el(),
    });
    let empty = subagent.items.is_empty().then(|| text("No steps yet.").font(k.ty.text_small).color(k.c.text_faint));
    let body = col()
        .w_full()
        .px(16.0)
        .py(12.0)
        .shrink()
        .min_h(0.0)
        .scroll(ScrollSpec { stick_bottom: true })
        .children(subagent.prompt.clone().map(|p| text(p).font(k.ty.text_xsmall).color(k.c.text_faint).wrap().max_lines(3).mb(8.0)))
        .children(steps.collect::<Vec<_>>())
        .children(empty);
    col().key("subagent-detail").w(DETAIL_WIDTH).max_h(560.0).child(header).child(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_lane_centres_and_moves_aside_for_the_rail() {
        assert_eq!(Lane::for_session(800.0, 720.0), Lane { left: 40.0, width: 720.0 });
        assert_eq!(Lane::for_session(600.0, 720.0), Lane { left: 16.0, width: 568.0 });
        // At 1000, the cards take 288 and the lane keeps 16 from the left.
        assert_eq!(Lane::for_session(1000.0, 720.0), Lane { left: 16.0, width: 696.0 });
        // At 1600 it stays centred, clear of the cards.
        assert_eq!(Lane::for_session(1600.0, 720.0), Lane { left: 440.0, width: 720.0 });
    }
}
