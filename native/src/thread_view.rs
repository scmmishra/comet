//! A tab's thread, as `app/src/renderer/thread.tsx` draws it: rows down the thread's lane, each kept
//! by `memo` while nothing it shows changes, and mounted only while on screen.

use crate::diff::{LineKind, line_diff};
use crate::format;
use crate::protocol::{StepKind, ThreadItem, ThreadRow};
use crate::shell::Desk;
use crate::theme;
use crate::cards::Lane;
use crate::threads::Thread;
use rune::{El, GrowthSpec, Icon, ScrollSpec, col, el, icon, memo, row, text};
use rune_kit::{ButtonVariant, IconButton, IconButtonVariant, Kit, Menu, MenuItem, Placement, Spinner};
use rune_theme_opencode::icons as ic;
use std::borrow::Cow;
use std::hash::{DefaultHasher, Hash, Hasher};

/// The thread's column, Desk's `--container-column`.
pub const COLUMN: f32 = 720.0;
/// The lane keeps this far from the session's sides, Desk's `--lane-edge`.
pub const LANE_EDGE: f32 = 16.0;
/// The lane's padding on each side, Desk's `px-6`.
const LANE_PADDING: f32 = 24.0;
/// The space between rows, Desk's `gap-3.5`.
const ROW_GAP: f32 = 14.0;
/// Above the first row, Desk's `pt-2.5`.
const LANE_TOP: f32 = 10.0;
/// A first guess at a row's height, before it is measured.
const ROW_ESTIMATE: f32 = 64.0;
/// A message's bubble takes at most 80% of the lane, `max-w-[80%]`.
pub const BUBBLE_MAX: f32 = (COLUMN - 2.0 * LANE_PADDING) * 0.8;
/// A message's bubble's padding on each side, `px-3.5`.
const BUBBLE_PAD_X: f32 = 14.0;
/// Rows of steps: `h-6`.
const STEP_HEIGHT: f32 = 24.0;
/// Icons beside steps, which ask for `size-[14px]` and draw at Desk's 15 points.
const STEP_ICON: f32 = crate::icons::SIZE;
/// The working head's spinner, `size-[14px]`. It is a Spinner, not an `<Icon>`, so its size class holds.
const SPINNER: f32 = 14.0;
/// A step's detail sits under its label, past the icon: `pl-[22px]`.
const DETAIL_INDENT: f32 = 22.0;
/// A step list scrolls past this height, `max-h-[min(18rem,50dvh)]`.
const STEP_LIST_MAX: f32 = 288.0;
/// Tool output scrolls past this height, `max-h-64`.
const OUTPUT_MAX: f32 = 256.0;
/// An edit's lines scroll past this height, `max-h-80`.
const EDIT_MAX: f32 = 320.0;
/// An image in a message fits this box, `max-w-[240px] max-h-48`.
const MESSAGE_IMAGE: [f32; 2] = [240.0, 192.0];
/// Boxes in the thread, `rounded-2xl`.
const BOX_RADIUS: f32 = 10.0;
/// A message's bubble, `rounded-3xl`.
const BUBBLE_RADIUS: f32 = 12.0;

const ICON_BY_KIND: [(StepKind, &Icon); 7] = [
    (StepKind::Thought, &ic::OUTLINE_BRAIN),
    (StepKind::Command, &ic::OUTLINE_CONSOLE),
    (StepKind::Edit, &ic::EDIT),
    (StepKind::Read, &ic::OUTLINE_EYE),
    (StepKind::Search, &ic::MAGNIFYING_GLASS),
    (StepKind::Web, &ic::GLOBE),
    (StepKind::Other, &ic::CODE_SLASH),
];

fn kind_icon(kind: StepKind) -> &'static Icon {
    ICON_BY_KIND.iter().find(|(k, _)| *k == kind).map_or(&ic::CODE_SLASH, |(_, i)| i)
}

/// What a row draws from: the window's state, the tab's thread and the theme.
struct Ctx<'a> {
    s: &'a Desk,
    tab: &'a str,
    thread: &'a Thread,
    k: &'a Kit,
    /// The thread's text size, from Appearance.
    size: f32,
}

impl Ctx<'_> {
    fn open(&self, id: &str) -> bool {
        self.thread.open.contains(id)
    }

    fn toggle(&self, id: &str) -> impl Fn(&mut Desk, &mut rune::Tx) + 'static {
        let (tab, id) = (self.tab.to_owned(), id.to_owned());
        move |s: &mut Desk, _| s.threads.toggle(&tab, &id)
    }

    fn small(&self, words: impl Into<String>) -> El {
        text(words).font(crate::theme::text(13.0))
    }
}

/// The thread of `tab`, scrolling, and staying at the end while it grows unless the user scrolled up.
pub fn thread(s: &Desk, tab: &str, dark: bool, lane: Option<Lane>) -> El {
    let Some(thread) = s.threads.get(tab) else { return el().grow(1.0) };
    let list = col()
        .key("rows")
        .w_full()
        .pt(LANE_TOP)
        .growth(GrowthSpec::default())
        .selection_group(true)
        .virtual_rows(
            thread.rows.len(),
            ROW_ESTIMATE,
            |s: &Desk, i| Cow::Owned(active_thread(s).map_or_else(String::new, |t| t.rows[i].id().to_owned())),
            move |s: &Desk, i| lane_row(s, i, dark, lane),
        )
        .virtual_rows_version(thread.rows_version)
        // The minimap darkens the marks of the turns on screen.
        .on_visible_rows(|s: &mut Desk, rows| {
            let changed = s.minimap.visible != rows;
            s.minimap.visible = rows;
            changed
        });
    let key = format!("thread-{tab}");
    let at_tab = tab.to_owned();
    let scroll = col().key(key.clone()).w_full().h_full().scroll(ScrollSpec { stick_bottom: true }).on_at_bottom(move |s: &mut Desk, at| s.threads.get_mut(&at_tab).away_from_end = !at).child(list);
    let k = theme::kit(dark);
    col().w_full().grow(1.0).min_h(0.0).child(scroll).children(thread.away_from_end.then(|| scroll_to_end(&key, k)))
}

/// After T3 Code: a pill above the composer once the end of the thread is out of view.
fn scroll_to_end(thread_key: &str, k: &Kit) -> El {
    let key = thread_key.to_owned();
    let pill = row()
        .key("scroll-to-end")
        .h(28.0)
        .gap(6.0)
        .items_center()
        .px(12.0)
        .radius(14.0)
        .fill(k.c.layer_01.alpha(0.9))
        .border(1.0, k.c.border_base)
        .role("button")
        .on_press_tx(move |_: &mut Desk, tx| tx.scroll_to_bottom(key.clone()))
        .child(icon(&ic::CHEVRON_DOWN, crate::icons::SIZE).color(k.c.text_muted))
        .child(text("Scroll to end").font(crate::theme::text(12.0)).color(k.c.text_muted));
    row().pin(Some(0.0), None, Some(0.0), Some(8.0)).justify_center().child(k.elevate(pill, &k.elevation.md))
}

/// Places `content` in the thread's lane: where the session's width puts it, or centred before the width is known.
pub fn in_lane(content: El, lane: Option<Lane>) -> El {
    match lane {
        Some(lane) => row().w_full().child(content.w(lane.width).ml(lane.left)),
        None => col().w_full().items_center().px(LANE_EDGE).child(content.max_w(COLUMN)),
    }
}

fn active_thread(s: &Desk) -> Option<&Thread> {
    s.workspace.active.as_deref().and_then(|tab| s.threads.get(tab))
}

/// One row in the lane, rebuilt only when what it shows changes.
fn lane_row(s: &Desk, i: usize, dark: bool, lane: Option<Lane>) -> El {
    let (Some(tab), Some(thread)) = (s.workspace.active.as_deref(), active_thread(s)) else { return el() };
    let k = theme::kit(dark);
    let c = Ctx { s, tab, thread, k, size: s.account.text_size() };
    let r = &thread.rows[i];
    let mut h = DefaultHasher::new();
    (version(&c, r), lane.map(|l| (l.left.to_bits(), l.width.to_bits()))).hash(&mut h);
    memo(r.id().to_owned(), h.finish(), || {
        let content = col().w_full().px(LANE_PADDING).pb(ROW_GAP).child(row_view(&c, r));
        in_lane(content, lane)
    })
}

/// What a row shows, hashed: its items' revisions, what is open, the working head's seconds and the look.
fn version(c: &Ctx, r: &ThreadRow) -> u64 {
    let mut h = DefaultHasher::new();
    (c.k.dark, c.size.to_bits()).hash(&mut h);
    hash_row(c, r, &mut h);
    h.finish()
}

fn hash_row(c: &Ctx, r: &ThreadRow, h: &mut DefaultHasher) {
    let open = |id: &str, h: &mut DefaultHasher| {
        let open = c.open(id);
        open.hash(h);
        open
    };
    match r {
        ThreadRow::Item { id } => {
            c.thread.revision(id).hash(h);
            open(id, h);
            // A copied message or one of its code blocks.
            c.s.copied.as_ref().filter(|(copied, _)| copied == id || copied.starts_with(&format!("{id}#"))).map(|(copied, _)| copied).hash(h);
            (c.thread.latest_changes() == Some(id.as_str())).hash(h);
            c.s.threads.approval_menu.hash(h);
        }
        ThreadRow::Group { id, steps, live, summary } => {
            (live, summary).hash(h);
            open(id, h);
            for step in steps {
                c.thread.revision(step).hash(h);
                open(step, h);
            }
        }
        ThreadRow::Fold { id, rows, duration_ms, stopped } => {
            (duration_ms.map(f64::to_bits), stopped).hash(h);
            if open(id, h) {
                for inner in rows {
                    hash_row(c, inner, h);
                }
            }
        }
        ThreadRow::Working { since, .. } => since.map(|since| working_seconds(c.s.now_ms, since)).hash(h),
    }
}

fn working_seconds(now: f64, since: f64) -> u64 {
    ((now - since) / 1000.0).max(0.0) as u64
}

fn row_view(c: &Ctx, r: &ThreadRow) -> El {
    match r {
        ThreadRow::Item { id } => c.thread.item(id).map_or_else(el, |item| item_view(c, item)),
        ThreadRow::Group { id, steps, live, summary } => group_view(c, id, steps, *live, summary),
        ThreadRow::Fold { id, rows, duration_ms, stopped } => fold_view(c, id, rows, *duration_ms, *stopped),
        ThreadRow::Working { since, .. } => working_view(c, *since),
    }
}


fn item_view(c: &Ctx, item: &ThreadItem) -> El {
    let k = c.k;
    match item {
        // A turn Claude Code started itself opens with a line that says why, not a bubble.
        ThreadItem::User { text: words, self_started: true, .. } => row()
            .gap(8.0)
            .items_center()
            .child(icon(&ic::OUTLINE_CONSOLE, STEP_ICON).color(k.c.text_faint))
            .child(c.small(words.clone()).color(k.c.text_faint).truncate()),
        ThreadItem::User { text: words, steered, images, at, .. } => {
            let steered = steered.then(|| {
                row().gap(4.0).items_center().child(icon(&ic::ARROW_UP_RIGHT, crate::icons::SIZE).color(k.c.text_faint)).child(text("Steered").font(crate::theme::text(12.0)).color(k.c.text_faint))
            });
            // The text shrinks and wraps inside the bubble's cap, as `w-fit max-w-[80%]` lays it out.
            let bubble = el().max_w(BUBBLE_MAX).min_w(0.0).fill(k.c.layer_02).radius(BUBBLE_RADIUS).px(BUBBLE_PAD_X).py(9.0).child(
                text(words.clone())
                    .wrap_anywhere()
                    .shrink()
                    .min_w(0.0)
                    .font(theme::thread_text(k, c.size))
                    .color(k.c.text_base)
                    .selectable(true)
                    .selection_color(k.selection()),
            );
            let pictures = (!images.is_empty()).then(|| row().gap(8.0).wrap().justify_end().max_w(BUBBLE_MAX).children(images.iter().map(|image| message_image(c, image))));
            col()
                .w_full()
                .items_end()
                .gap(4.0)
                .hover_group()
                .children(steered)
                .children(pictures)
                .children((!words.is_empty()).then_some(bubble))
                .child(message_meta(c, item.id(), words, *at))
        }
        // Markdown makes its own selection group. Leaving it joins its texts to the thread's, so a drag crosses messages.
        ThreadItem::Text { text: words, done, at, .. } => {
            let copied = c.s.copied.as_ref().map(|(key, _)| key.as_str());
            let reply = crate::reply::interactive(crate::reply::document(words), c.tab, item.id(), copied, k).style(theme::markdown(k, c.size)).streaming(!*done).selectable(true).build(k).selection_group(false);
            // A reply still streaming has nothing final to copy.
            col().w_full().gap(4.0).hover_group().child(reply).children(done.then(|| message_meta(c, item.id(), words, *at)))
        }
        ThreadItem::Compaction { status, pre_tokens, post_tokens, error, .. } => compaction_view(c, status, *pre_tokens, *post_tokens, error.as_deref()),
        ThreadItem::Error { message, .. } => el()
            .w_full()
            .fill(k.c.danger.bg)
            .radius(BOX_RADIUS)
            .px(12.0)
            .py(8.0)
            .child(text(message.clone()).wrap().font(theme::thread_text(k, c.size)).color(k.c.danger.fg).selectable(true)),
        ThreadItem::Changes { id, files } => changes_view(c, id, files),
        ThreadItem::Permission { request_id, kind, detail, reason, .. } => permission_view(c, request_id, kind, detail, reason.as_deref()),
        ThreadItem::Thinking { .. } | ThreadItem::Tool { .. } => step_view(c, item),
        // Results end turns and questions show in the composer. Neither draws in the thread.
        ThreadItem::Result { .. } | ThreadItem::Question { .. } => el(),
    }
}

/// A message's copy button and time, after T3 Code. They stay hidden until the message is hovered, so
/// the thread reads as text.
fn message_meta(c: &Ctx, id: &str, words: &str, at: Option<f64>) -> El {
    let k = c.k;
    let copied = c.s.copied.as_ref().is_some_and(|(copied, _)| copied == id);
    let (id, words) = (id.to_owned(), words.to_owned());
    let copy = IconButton::new(if copied { &ic::CHECK } else { &ic::COPY })
        .variant(IconButtonVariant::GhostMuted)
        .label("Copy message")
        .help(if copied { "Copied" } else { "Copy" })
        .on_press_tx(move |s: &mut Desk, tx| {
            tx.copy(words.clone());
            s.copied = Some((id.clone(), std::time::Instant::now()));
        })
        .build(k);
    let time = at.map(|at| text(format::message_time(at, format::now_ms())).font(crate::theme::text(12.0)).color(k.c.text_faint));
    row().h(24.0).gap(6.0).items_center().group_opacity(0.0, 1.0).child(copy).children(time)
}

/// An image sent with a message, at most `MESSAGE_IMAGE` wide and tall, in its own proportions.
fn message_image(c: &Ctx, image: &crate::protocol::ImageAttachment) -> El {
    let k = c.k;
    let Some(decoded) = c.s.images.get(image) else { return el().size(MESSAGE_IMAGE[0], MESSAGE_IMAGE[1]).radius(BOX_RADIUS).fill(k.c.layer_02) };
    let [w, h] = decoded.size().map_or(MESSAGE_IMAGE, |[w, h]| {
        let scale = (MESSAGE_IMAGE[0] / w as f32).min(MESSAGE_IMAGE[1] / h as f32).min(1.0);
        [w as f32 * scale, h as f32 * scale]
    });
    el().size(w, h).radius(BOX_RADIUS).clip_rounded(BOX_RADIUS).border(1.0, k.c.border_base).pixels(decoded.pixels())
}

/// The head of a running turn: how long Claude has worked on it, counted each second.
fn working_view(c: &Ctx, since: Option<f64>) -> El {
    let label = match since {
        Some(since) => format!("Working for {}", format::duration(working_seconds(c.s.now_ms, since) as f64 * 1000.0)),
        None => "Working…".to_owned(),
    };
    row().gap(8.0).items_center().child(Spinner::new().size(SPINNER).build(c.k)).child(c.small(label).color(c.k.c.text_faint))
}

/// Where Claude Code compacted the context, as a line across the thread.
fn compaction_view(c: &Ctx, status: &str, pre: Option<f64>, post: Option<f64>, error: Option<&str>) -> El {
    let k = c.k;
    let failed = status == "failed";
    let label = match (status, pre, post) {
        ("done", Some(pre), Some(post)) => format!("Context compacted {} → {} tokens", format::tokens(pre), format::tokens(post)),
        ("done", ..) => "Context compacted".to_owned(),
        ("running", ..) => "Compacting context".to_owned(),
        ("failed", ..) => "Context compaction failed".to_owned(),
        _ => "Context compaction stopped".to_owned(),
    };
    let ink = if failed { k.c.danger.fg } else { k.c.text_faint };
    let line = || el().h(1.0).grow(1.0).fill(if failed { k.c.danger.fg.alpha(0.3) } else { k.c.border_base });
    let mark = icon(if failed { &ic::CIRCLE_EXCLAMATION } else { &ic::COLLAPSE }, crate::icons::SIZE).color(ink);
    let words = row().gap(6.0).items_center().child(mark).child(text(label.clone()).font(crate::theme::text(12.0)).color(ink)).children(
        error.map(|e| text(format!("· {e}")).font(crate::theme::text(12.0)).color(ink.alpha(0.8)).truncate()),
    );
    row().w_full().gap(12.0).items_center().py(4.0).role("separator").label(label).child(line()).child(words).child(line())
}

/// A finished turn's work, folded into one row. It opens to the turn's groups and the text between them.
fn fold_view(c: &Ctx, id: &str, rows: &[ThreadRow], duration_ms: Option<f64>, stopped: bool) -> El {
    let k = c.k;
    let open = c.open(id);
    let label = match (stopped, duration_ms.map(format::duration)) {
        (true, Some(d)) => format!("You stopped after {d}"),
        (true, None) => "You stopped this response".to_owned(),
        (false, Some(d)) => format!("Worked for {d}"),
        (false, None) => "Worked".to_owned(),
    };
    let head = row()
        .key("fold-head")
        .gap(4.0)
        .items_center()
        .role("button")
        .expanded(open)
        .child(c.small(label).color(k.c.text_faint).group_color(k.c.text_muted))
        .child(crate::icons::chevron(k, open))
        .hover_group()
        .on_press_tx(c.toggle(id));
    col().w_full().gap(ROW_GAP).child(head).children(open.then(|| rows.iter().map(|inner| row_view(c, inner).key(inner.id().to_owned())).collect::<Vec<_>>()).into_iter().flatten())
}

/// The icon for a group: its kind's, or a general one when it mixes kinds.
fn group_icon(c: &Ctx, steps: &[String]) -> &'static Icon {
    let mut kinds = steps.iter().filter_map(|id| match c.thread.item(id) {
        Some(ThreadItem::Tool { kind, .. }) => Some(*kind),
        _ => None,
    });
    match kinds.next() {
        None => kind_icon(StepKind::Thought),
        Some(first) if kinds.all(|k| k == first) => kind_icon(first),
        Some(_) => &ic::CODE_SLASH,
    }
}

/// Steps in a row. A live group shows its latest step, with the latest thought above a tool call. A
/// finished group shows its summary. A group of one finished step is that step.
fn group_view(c: &Ctx, id: &str, steps: &[String], live: bool, summary: &str) -> El {
    let k = c.k;
    let items: Vec<&ThreadItem> = steps.iter().filter_map(|step| c.thread.item(step)).collect();
    let Some(latest) = items.last() else { return el() };
    if !live && items.len() == 1 {
        return step_view(c, latest);
    }
    let open = c.open(id);
    let head = if live {
        let (kind, label) = step_name(latest);
        row().gap(8.0).items_center().h(STEP_HEIGHT).child(icon(kind_icon(kind), STEP_ICON).color(k.c.text_faint)).child(c.small(label.to_owned()).color(k.c.text_muted).truncate())
    } else {
        row().gap(8.0).items_center().h(STEP_HEIGHT).child(icon(group_icon(c, steps), STEP_ICON).color(k.c.text_faint)).child(c.small(summary.to_owned()).color(k.c.text_muted).group_color(k.c.text_base).truncate())
    };
    let head = head.child(crate::icons::chevron(k, open)).key("group-head").role("button").expanded(open).hover_group().on_press_tx(c.toggle(id));
    let thought = (live && !open && matches!(latest, ThreadItem::Tool { .. }))
        .then(|| items.iter().rev().find_map(|i| match i {
            ThreadItem::Thinking { text: Some(_), label, .. } => Some(label.clone()),
            _ => None,
        }))
        .flatten()
        .map(|label| row().gap(8.0).child(icon(kind_icon(StepKind::Thought), STEP_ICON).color(k.c.text_faint).mt(3.0)).child(c.small(label).color(k.c.text_faint).wrap()));
    let list = open.then(|| {
        col()
            .key("steps")
            .w_full()
            .max_h(STEP_LIST_MAX)
            .ml(7.0)
            .pl(13.0)
            .border_sides([0.0, 0.0, 0.0, 1.0], k.c.border_base)
            .scroll(ScrollSpec { stick_bottom: true })
            .child(col().w_full().children(items.iter().map(|step| step_view(c, step).key(step.id().to_owned()))))
    });
    col().w_full().gap(6.0).children(thought).child(head).children(list)
}

fn step_name(item: &ThreadItem) -> (StepKind, &str) {
    match item {
        ThreadItem::Thinking { kind, label, .. } | ThreadItem::Tool { kind, label, .. } => (*kind, label),
        _ => (StepKind::Other, ""),
    }
}

/// One step: its icon and label. It opens to the thought in full, the edit's lines or the call's output.
fn step_view(c: &Ctx, item: &ThreadItem) -> El {
    let k = c.k;
    let id = item.id();
    let (kind, label) = step_name(item);
    let failed = matches!(item, ThreadItem::Tool { result: Some(r), .. } if r.is_error);
    let has_detail = match item {
        ThreadItem::Thinking { text, .. } => text.is_some(),
        ThreadItem::Tool { edits, result, kind, .. } => *kind == StepKind::Command || edits.as_ref().is_some_and(|e| !e.is_empty()) || result.is_some(),
        _ => false,
    };
    let open = has_detail && c.open(id);
    let ink = if failed { k.c.danger.fg } else { k.c.text_muted };
    let mut head = row()
        .key("step-head")
        .gap(8.0)
        .items_center()
        .h(STEP_HEIGHT)
        .w_full()
        .child(icon(kind_icon(kind), STEP_ICON).color(k.c.text_faint))
        .child(c.small(label.to_owned()).color(ink).truncate());
    if has_detail {
        head = head.child(crate::icons::chevron(k, open)).role("button").expanded(open).hover_group().on_press_tx(c.toggle(id));
    }
    col().w_full().child(head).children(open.then(|| col().key("detail").w_full().pl(DETAIL_INDENT).mt(4.0).mb(8.0).child(step_detail(c, item))))
}

fn step_detail(c: &Ctx, item: &ThreadItem) -> El {
    let k = c.k;
    match item {
        ThreadItem::Thinking { text: Some(words), .. } => crate::reply::document(words).style(theme::markdown(k, 13.0).text(k.c.text_muted)).selectable(true).build(k).selection_group(false),
        ThreadItem::Tool { file, edits: Some(edits), .. } if !edits.is_empty() => edit_view(c, file.as_deref().unwrap_or(""), edits),
        ThreadItem::Tool { summary, kind, result, .. } => {
            // The label names only the program, so a command's detail starts with the command in full.
            let command = (*kind == StepKind::Command).then(|| text(format!("$ {summary}")).font(crate::theme::mono(12.0)).color(k.c.text_base).wrap_anywhere());
            let output = match result {
                Some(r) if r.output.is_empty() => "(no output)".to_owned(),
                Some(r) => r.output.clone(),
                None => "Running…".to_owned(),
            };
            col()
                .w_full()
                .max_h(OUTPUT_MAX)
                .radius(BOX_RADIUS)
                .fill(k.c.bg_deep)
                // The Electron app outlines it with a shadow, which takes no room.
                .border(1.0, k.c.border_base)
                .px(12.0)
                .py(10.0)
                .scroll(ScrollSpec { stick_bottom: false })
                .children(command)
                .child(text(output).font(crate::theme::mono(12.0)).color(k.c.text_muted).wrap_anywhere().selectable(true))
        }
        _ => el(),
    }
}

/// An edit's lines: removed and added against what stayed, under the file's path and its counts.
fn edit_view(c: &Ctx, file: &str, edits: &[crate::protocol::TextEdit]) -> El {
    let k = c.k;
    let lines: Vec<(LineKind, &str)> = edits.iter().flat_map(|e| line_diff(&e.before, &e.after)).collect();
    let added = lines.iter().filter(|(kind, _)| *kind == LineKind::Add).count();
    let removed = lines.iter().filter(|(kind, _)| *kind == LineKind::Del).count();
    let head = row()
        .w_full()
        .gap(8.0)
        .items_center()
        .fill(k.c.layer_02)
        .px(12.0)
        .py(7.0)
        .child(icon(&ic::EDIT, 15.0).color(k.c.text_muted))
        .child(text(file.to_owned()).font(crate::theme::mono(12.0)).color(k.c.text_base).truncate().grow(1.0))
        .child(crate::ui::diff_changes(k, added as u32, removed as u32));
    let line_font = crate::theme::mono(12.0).lh(20.0);
    let body = col().w_full().max_h(EDIT_MAX).scroll(ScrollSpec { stick_bottom: false }).children(lines.iter().map(|(kind, line)| {
        let (mark, fill, ink) = match kind {
            LineKind::Add => ("+", Some(k.c.success.bg), k.c.success.fg),
            LineKind::Del => ("−", Some(k.c.danger.bg), k.c.danger.fg),
            LineKind::Same => (" ", None, k.c.text_muted),
        };
        let line_row = row().w_full().px(10.0).child(text(mark).font(line_font).color(ink).mr(8.0)).child(text((*line).to_owned()).font(line_font).color(k.c.text_base).selectable(true));
        match fill {
            Some(fill) => line_row.fill(fill),
            None => line_row,
        }
    }));
    // The Electron app outlines it with a shadow, which takes no room.
    col().w_full().radius(BOX_RADIUS).clip_rounded(BOX_RADIUS).fill(k.c.bg_deep).border(1.0, k.c.border_base).child(head).child(body)
}


/// The files a turn changed, under its answer: one quiet box with a count, the line totals and the files.
fn changes_view(c: &Ctx, id: &str, files: &[crate::protocol::ChangedFile]) -> El {
    let k = c.k;
    let (added, removed) = files.iter().fold((0, 0), |(a, d), f| (a + f.additions, d + f.deletions));
    let head = row()
        .gap(12.0)
        .items_center()
        .px(12.0)
        .pt(8.0)
        .pb(4.0)
        .child(text(format::plural(files.len(), "changed file")).font(crate::theme::medium(12.0)).color(k.c.text_base))
        .child(crate::ui::diff_changes(k, added, removed))
        .children((c.thread.latest_changes() == Some(id)).then(|| {
            let tab = c.tab.to_owned();
            row().grow(1.0).justify_end().child(crate::theme::small_button("Open diff").variant(ButtonVariant::GhostMuted).icon(&ic::REVIEW).on_press(move |s: &mut Desk| s.open_review(&tab, "turn")).build(k))
        }));
    // Electron's `max-h-60`: a long list scrolls inside the box.
    let list = col().w_full().max_h(240.0).scroll(ScrollSpec { stick_bottom: false }).px(6.0).pb(6.0).children(files.iter().map(|f| {
        let (dir, name) = f.path.rsplit_once('/').map_or(("", f.path.as_str()), |(d, n)| (d, n));
        let (tab, path) = (c.tab.to_owned(), f.path.clone());
        row()
            .key(f.path.clone())
            .w_full()
            .gap(8.0)
            .items_center()
            .px(6.0)
            .py(4.0)
            .radius(7.0)
            .hover(k.c.hover)
            .role("button")
            .on_press(move |s: &mut Desk| s.open_file(&tab, &path, None))
            .child(icon(crate::icons::file_icon(&f.path), 13.0))
            .child(
                row()
                    .grow(1.0)
                    .min_w(0.0)
                    .gap(6.0)
                    .child(text(name.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_base))
                    .children((!dir.is_empty()).then(|| text(dir.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_faint).truncate())),
            )
            .child(crate::ui::diff_changes(k, f.additions, f.deletions))
    }));
    col().w_full().radius(BOX_RADIUS).fill(theme::well(k.dark)).child(head).child(list)
}

/// A tool call waiting for approval, as a work row after T3 Code: what Claude would run or touch, why,
/// and the answers. Rune's menus need the view's overlay layer, which rows built in `memo` lack, so the
/// Electron app's "More" choices show as buttons.
fn approval_menu_key(request_id: &str) -> String {
    format!("approval-{request_id}")
}

/// The open More menu of an approval request in `tab`: always allowing the tool this session, if it can, or stopping the turn.
pub fn approval_menu(s: &Desk, tab: &str, k: &Kit, layer: &mut Vec<El>) {
    let Some((menu_tab, request)) = &s.threads.approval_menu else { return };
    let Some(thread) = s.threads.get(tab).filter(|_| menu_tab == tab) else { return };
    let Some(allow_session) = thread.items.iter().find_map(|item| match item {
        ThreadItem::Permission { request_id, allow_session, .. } if request_id == request => Some(*allow_session),
        _ => None,
    }) else {
        return;
    };
    let answer = |label: &str, value: &'static str| {
        let (tab, request) = (tab.to_owned(), request.clone());
        MenuItem::new(label).on_select(move |s: &mut Desk| {
            s.threads.approval_menu = None;
            s.answer_permission(&tab, &request, value);
        })
    };
    let mut menu = Menu::new(approval_menu_key(request)).open(true).placement(Placement::BottomStart).gutter(2.0).min_width(176.0).on_close(|s: &mut Desk| s.threads.approval_menu = None);
    if allow_session {
        menu = menu.item(answer("Always allow this session", "allow-session"));
    }
    // Only the menu draws here. Its trigger is the More button in the thread's row, which has the same key.
    let _ = menu.item(answer("Cancel and stop the turn", "cancel")).build(k, layer);
}

fn permission_view(c: &Ctx, request_id: &str, kind: &str, detail: &str, reason: Option<&str>) -> El {
    let k = c.k;
    let mark = match kind {
        "command" => kind_icon(StepKind::Command),
        "file-change" => kind_icon(StepKind::Edit),
        "file-read" => kind_icon(StepKind::Read),
        _ => &ic::LOCK,
    };
    let answer = |label: &str, value: &'static str, variant: ButtonVariant| {
        let (tab, request) = (c.tab.to_owned(), request_id.to_owned());
        crate::theme::small_button(label).variant(variant).on_press(move |s: &mut Desk| s.answer_permission(&tab, &request, value)).build(k).key(value)
    };
    // The rarer answers sit in a menu, which the session draws over the thread: rows built in `memo` have no overlay layer.
    let open = c.s.threads.approval_menu.as_ref().is_some_and(|(_, r)| r == request_id);
    let (tab, request) = (c.tab.to_owned(), request_id.to_owned());
    let more = crate::theme::small_button("More")
        .variant(ButtonVariant::GhostMuted)
        .expanded(open)
        .on_press(move |s: &mut Desk| s.threads.approval_menu = if open { None } else { Some((tab.clone(), request.clone())) })
        .build(k)
        .label("More approval options");
    let waiting = row().gap(4.0).items_center().child(icon(&ic::LOCK, crate::icons::SIZE).color(k.c.warning.fg)).child(text("Waiting for approval").font(crate::theme::text(12.0)).color(k.c.warning.fg));
    let answers = row()
        .gap(6.0)
        .items_center()
        .wrap()
        .child(waiting)
        .child(text("·").font(crate::theme::text(12.0)).color(k.c.text_faint))
        .child(answer("Decline", "decline", ButtonVariant::GhostMuted))
        .child(answer("Approve", "allow", ButtonVariant::Contrast))
        .child(row().key(format!("{}-trigger", approval_menu_key(request_id))).child(more));
    col()
        .w_full()
        .gap(4.0)
        .role("group")
        .child(row().gap(8.0).child(row().h(20.0).items_center().child(icon(mark, STEP_ICON).color(k.c.text_faint))).child(text(detail.to_owned()).font(crate::theme::mono(12.0).lh(20.0)).color(k.c.text_base).wrap_anywhere().selectable(true).max_h(160.0)))
        .child(col().pl(DETAIL_INDENT).gap(4.0).children(reason.map(|r| text(r.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_faint).wrap_anywhere().selectable(true))).child(answers))
}
