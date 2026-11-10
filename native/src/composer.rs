//! The message box under the thread, as `app/src/renderer/composer.tsx` lays it out after T3 Code: a tall
//! text area in a card, then a row with the send button. While Claude works, the button stops the turn,
//! or sends a follow-up once there is one to send.

use crate::protocol::{ClientMessage, Question, QueuedMessage, Skill};
use crate::questions::{self, Advance, QuestionDraft};
use crate::triggers::{self, Trigger, TriggerKind};
use crate::shell::Desk;
use crate::theme;
use crate::thread_view::COLUMN;
use rune::{El, Key, KeyEvent, TextEdit, auto_grow, col, el, icon, row, text, text_input};
use rune_kit::{Button, ButtonVariant, ControlSize, IconButton, IconButtonVariant, Keybind, Kit, Markdown, Placement, popover};
use std::collections::HashSet;
use rune_theme_opencode::icons as ic;
use std::collections::HashMap;
use std::time::Instant;

/// The card's corners, `rounded-3xl`.
const CARD_RADIUS: f32 = 12.0;
/// The text area grows from two lines to this many, then scrolls.
const MAX_LINES: usize = 12;
/// A second Escape within this long stops Claude.
const STOP_AGAIN: std::time::Duration = std::time::Duration::from_millis(1500);
const PLACEHOLDER: &str = "Ask anything, @ to add files, / for commands";
const ANSWER_PLACEHOLDER: &str = "Type your own answer, or leave this blank to use the selected option";
/// Options past this many get no number.
const NUMBERED_OPTIONS: usize = 9;
/// The queue shows this many messages until the user asks for all of them.
const QUEUE_SHOWN: usize = 3;
/// A question scrolls past this height, Desk's `max-h-[40vh]` on a typical window.
const QUESTION_MAX: f32 = 320.0;
/// An attached image's thumbnail, `size-14`.
const THUMB: f32 = 56.0;
/// The file and command list scrolls past this height, `max-h-[280px]`.
const LIST_MAX: f32 = 280.0;
/// Typing writes the drafts to disk after this pause, not on every key.
const SAVE_DELAY: std::time::Duration = std::time::Duration::from_millis(400);
const DRAFTS_FILE: &str = "drafts.json";

/// Desk's own commands, after T3 Code's. They act at once, rather than going to Claude.
const DESK_COMMANDS: [(&str, &str); 2] = [("model", "Switch the model for this tab"), ("clear", "Start a fresh session; the thread starts empty")];

/// One row of the file and command list.
#[derive(Clone, Debug, PartialEq)]
enum Suggestion {
    File(String),
    Desk(&'static str, &'static str),
    Skill(Skill),
}

/// What a message sent while Claude works does, and the other choice, which ⌘ picks.
#[derive(Clone, Copy, Debug, PartialEq)]
enum FollowUp {
    Steer,
    Queue,
}

impl FollowUp {
    fn from_setting(value: &str) -> FollowUp {
        if value == "queue" { FollowUp::Queue } else { FollowUp::Steer }
    }

    fn other(self) -> FollowUp {
        match self {
            FollowUp::Steer => FollowUp::Queue,
            FollowUp::Queue => FollowUp::Steer,
        }
    }

    fn name(self) -> &'static str {
        match self {
            FollowUp::Steer => "steer",
            FollowUp::Queue => "queue",
        }
    }

    fn label(self) -> &'static str {
        match self {
            FollowUp::Steer => "Steer message",
            FollowUp::Queue => "Queue message",
        }
    }

    fn icon(self) -> &'static rune::Icon {
        match self {
            FollowUp::Steer => &ic::ARROW_UP_RIGHT,
            FollowUp::Queue => &ic::OUTLINE_LIST_CHANGELOG,
        }
    }

    /// A slash command is a turn Claude Code runs on its own, so steering one in would cut the running
    /// turn short. It always waits in the queue (`followUpFor` in the protocol).
    fn for_text(self, text: &str) -> FollowUp {
        if text.trim_start().starts_with('/') { FollowUp::Queue } else { self }
    }
}

/// Each tab's unsent message, what the user gave Claude's open questions, and when Escape was last pressed.
#[derive(Default)]
pub struct Drafts {
    by_tab: HashMap<String, TextEdit>,
    escaped_at: Option<Instant>,
    /// By request id. They last while the app runs.
    questions: HashMap<String, QuestionDraft>,
    /// Question sets the user folded away, by request id.
    folded: HashSet<String>,
    /// Tabs whose queue shows every message.
    all_queued: HashSet<String>,
    /// When a draft last changed, until it is saved.
    edited_at: Option<Instant>,
    /// The highlighted row of the file and command list.
    active: usize,
    /// The trigger the user closed with Escape, by tab and where it starts, so the list stays shut for it.
    dismissed: Option<(String, usize)>,
    /// The last file search sent, and the paths found for it: project, query and paths.
    asked: Option<(String, String)>,
    found: Option<(String, String, Vec<String>)>,
    /// Projects whose commands were asked for.
    skills_asked: HashSet<String>,
    /// Each tab's attached images. They stay in memory only, since one can run to megabytes.
    images: HashMap<String, Vec<crate::protocol::ImageAttachment>>,
}

impl Drafts {
    /// The drafts saved by an earlier run. A missing or broken file gives none.
    pub fn load() -> Drafts {
        let saved: HashMap<String, String> = std::fs::read_to_string(crate::instance::home().join(DRAFTS_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        Drafts { by_tab: saved.into_iter().map(|(tab, text)| (tab, TextEdit::new(text))).collect(), ..Drafts::default() }
    }

    /// Writes the drafts of open tabs, through a temporary file so a crash never leaves a broken one.
    fn save(&self, open: &[String]) {
        let texts: HashMap<&String, &String> = self.by_tab.iter().filter(|(tab, e)| open.contains(tab) && !e.text.is_empty()).map(|(tab, e)| (tab, &e.text)).collect();
        let path = crate::instance::home().join(DRAFTS_FILE);
        let temporary = path.with_extension("json.tmp");
        // Drafts are a convenience. If the disk refuses them, they last until the app quits.
        if std::fs::write(&temporary, serde_json::to_string(&texts).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(temporary, path);
        }
    }

    fn edit(&mut self, tab: &str) -> &mut TextEdit {
        self.edited_at = Some(Instant::now());
        self.by_tab.entry(tab.to_owned()).or_insert_with(|| TextEdit::new(""))
    }

    fn text(&self, tab: &str) -> &str {
        self.by_tab.get(tab).map_or("", |e| e.text.as_str())
    }
}

impl Desk {
    fn follow_up(&self, alternate: bool) -> FollowUp {
        let chosen = FollowUp::from_setting(self.account.settings.as_ref().map_or("steer", |s| s.claude.follow_up.as_str()));
        if alternate { chosen.other() } else { chosen }
    }

    fn busy(&self, tab: &str) -> bool {
        self.threads.get(tab).is_some_and(|t| t.busy)
    }

    /// The open questions of `tab`, with their request id, owned so the caller may change the window.
    fn question(&self, tab: &str) -> Option<(String, Vec<Question>)> {
        self.threads.get(tab)?.pending_question().map(|(id, qs)| (id.to_owned(), qs.to_vec()))
    }

    /// Moves past the current question, with the composer's text as its answer when there is any. After
    /// the last question, the answers go to Claude.
    fn advance_question(&mut self, tab: &str, request: &str, questions: &[Question]) {
        let typed = self.drafts.text(tab).trim().to_owned();
        let draft = self.drafts.questions.entry(request.to_owned()).or_default();
        if let Some(q) = questions.get(draft.index)
            && !typed.is_empty()
        {
            draft.custom.insert(q.question.clone(), typed);
        }
        match questions::advance(questions, draft) {
            Some(Advance::Next) => self.drafts.edit(tab).clear(),
            Some(Advance::Answers(answers)) => {
                self.drafts.edit(tab).clear();
                self.core.send(&ClientMessage::QuestionAnswer { tab_id: tab.to_owned(), request_id: request.to_owned(), answers: Some(answers) });
            }
            None => {}
        }
    }

    /// Picks an option. A single-choice question moves on at once.
    fn pick(&mut self, tab: &str, request: &str, label: &str) {
        let Some((_, questions)) = self.question(tab) else { return };
        let draft = self.drafts.questions.entry(request.to_owned()).or_default();
        let Some(q) = questions.get(draft.index) else { return };
        questions::pick(q, draft, label);
        self.drafts.edit(tab).clear();
        if !q.multi_select {
            self.advance_question(tab, request, &questions);
        }
    }

    /// Sends the active tab's message. While Claude works, it steers or queues, and ⌘ picks the other.
    /// A tab with no name takes it from the message. While Claude asks questions, it answers them.
    fn submit(&mut self, alternate: bool) {
        let Some(tab) = self.workspace.active.clone() else { return };
        if let Some((request, questions)) = self.question(&tab) {
            return self.advance_question(&tab, &request, &questions);
        }
        let text = self.drafts.text(&tab).trim().to_owned();
        let images = self.drafts.images.remove(&tab).unwrap_or_default();
        if text.is_empty() && images.is_empty() {
            return;
        }
        if !text.is_empty() && self.workspace.active_tab().is_some_and(crate::workspace::is_untitled) {
            self.workspace.name_tab(&tab, &text, &self.core);
        }
        let follow_up = self.busy(&tab).then(|| self.follow_up(alternate).for_text(&text).name().to_owned());
        // A message sent while Claude works joins its turn or waits, so its subagents stay.
        if follow_up.is_none() {
            self.threads.new_turn(&tab);
        }
        self.core.send(&ClientMessage::SessionSend { tab_id: tab.clone(), text, images, follow_up });
        self.drafts.edit(&tab).clear();
    }

    /// Adds image files to the active tab's message. A file that is not an image Claude reads says why.
    fn attach(&mut self, paths: &[std::path::PathBuf]) {
        let Some(tab) = self.workspace.active.clone() else { return };
        for path in paths {
            match crate::attachments::read(path) {
                Ok(image) => {
                    self.images.remember(&image);
                    self.drafts.images.entry(tab.clone()).or_default().push(image);
                }
                Err(reason) => self.toasts.show(reason, true),
            }
        }
    }

    /// The trigger the active tab's caret is in, unless the user closed its list.
    fn trigger(&self, tab: &str) -> Option<Trigger> {
        let edit = self.drafts.by_tab.get(tab).filter(|e| e.focused)?;
        let found = triggers::trigger_at(&edit.text, edit.range().1)?;
        (self.drafts.dismissed.as_ref() != Some(&(tab.to_owned(), found.start))).then_some(found)
    }

    fn suggestions(&self, tab: &str) -> Vec<Suggestion> {
        let Some(trigger) = self.trigger(tab) else { return Vec::new() };
        let Some(info) = self.workspace.tabs.iter().find(|t| t.id == tab) else { return Vec::new() };
        match trigger.kind {
            TriggerKind::File => match &self.drafts.found {
                Some((project, query, paths)) if *project == info.project && *query == trigger.query => paths.iter().cloned().map(Suggestion::File).collect(),
                _ => Vec::new(),
            },
            TriggerKind::Command => {
                let skills = self.projects.get(&info.project).and_then(|p| p.skills.as_deref()).unwrap_or(&[]);
                let all: Vec<Suggestion> = DESK_COMMANDS.iter().map(|(n, d)| Suggestion::Desk(n, d)).chain(skills.iter().cloned().map(Suggestion::Skill)).collect();
                triggers::match_commands(&all, &trigger.query, suggestion_name, suggestion_description).into_iter().cloned().collect()
            }
        }
    }

    /// Puts the picked row in place of the trigger, or runs one of Desk's own commands.
    fn pick_suggestion(&mut self, tab: &str, index: usize) {
        let (Some(trigger), Some(picked)) = (self.trigger(tab), self.suggestions(tab).into_iter().nth(index)) else { return };
        let inserted = match picked {
            Suggestion::File(path) => format!("@{path}"),
            Suggestion::Skill(skill) => format!("/{}", skill.name),
            Suggestion::Desk(name, _) => {
                self.drafts.edit(tab).clear();
                if name == "model" {
                    self.toggle_picker();
                } else {
                    self.core.send(&ClientMessage::ThreadClear { tab_id: tab.to_owned() });
                }
                return;
            }
        };
        let edit = self.drafts.edit(tab);
        let (text, caret) = triggers::complete(&edit.text, trigger.start, edit.range().1, &inserted);
        edit.replace_text(text);
        edit.set_caret(caret);
        self.drafts.active = 0;
    }

    /// Arrow keys move through the list, Enter and Tab pick, and Escape closes it. Other keys edit.
    fn list_key(&mut self, tab: &str, key: &Key) -> bool {
        let count = self.suggestions(tab).len();
        if count == 0 {
            return false;
        }
        match key {
            Key::Down => self.drafts.active = (self.drafts.active + 1) % count,
            Key::Up => self.drafts.active = (self.drafts.active + count - 1) % count,
            Key::Enter | Key::Tab => self.pick_suggestion(tab, self.drafts.active.min(count - 1)),
            Key::Escape => self.drafts.dismissed = self.trigger(tab).map(|t| (tab.to_owned(), t.start)),
            _ => return false,
        }
        true
    }

    pub fn interrupt(&mut self, tab: &str) {
        if self.busy(tab) {
            self.core.send(&ClientMessage::SessionInterrupt { tab_id: tab.to_owned() });
        }
    }

    /// Escape stops Claude only when pressed twice, so a reflexive Escape does not cut a turn short.
    fn escape(&mut self, tab: &str) {
        if !self.busy(tab) {
            return;
        }
        match self.drafts.escaped_at.take() {
            Some(at) if at.elapsed() < STOP_AGAIN => self.interrupt(tab),
            _ => {
                self.drafts.escaped_at = Some(Instant::now());
                self.toasts.show("Press Esc again to stop Claude.", false);
            }
        }
    }
}

/// The composer of `tab`, centred in the thread's column, with the queue above it.
/// Where the file and command list opens: above the box, or below it on the start screen, where a list
/// above would be cut off.
#[derive(Clone, Copy, PartialEq)]
pub enum ListAt {
    Above,
    Below,
}

pub fn composer(s: &Desk, info: &crate::protocol::TabInfo, list_at: ListAt, lane: Option<crate::cards::Lane>, k: &Kit, layer: &mut Vec<El>) -> El {
    let tab = info.id.as_str();
    if let Some(list) = suggestion_list(s, tab, k) {
        let placement = if list_at == ListAt::Above { Placement::TopStart } else { Placement::BottomStart };
        layer.push(popover::anchored(k, list, "composer", placement, 8.0));
    }
    let edit = s.drafts.by_tab.get(tab).cloned().unwrap_or_else(|| TextEdit::new(""));
    let attached = s.drafts.images.get(tab).map_or(&[][..], Vec::as_slice);
    let empty = edit.text.trim().is_empty() && attached.is_empty();
    let question = s.question(tab);
    let field = text_input(&edit, theme::thread_text(k, s.account.text_size()))
        .key("composer-input")
        .w_full()
        .color(k.c.text_base)
        .placeholder(if question.is_some() { ANSWER_PLACEHOLDER } else { PLACEHOLDER }, k.c.text_faint)
        .caret(k.c.text_base, k.selection())
        .on_edit(|s: &mut Desk| {
            let tab = s.workspace.active.clone().unwrap_or_default();
            s.drafts.edit(&tab)
        })
        .on_submit(|s: &mut Desk, _| {
            let alternate = s.cmd_held();
            s.submit(alternate);
        })
        .on_input_key(|s: &mut Desk, key: &KeyEvent, _| {
            let Some(tab) = s.workspace.active.clone() else { return false };
            if key.mods.shift || key.mods.cmd || key.mods.alt {
                return false;
            }
            if s.list_key(&tab, &key.key) {
                return true;
            }
            if key.key != Key::Escape {
                return false;
            }
            s.escape(&tab);
            true
        });
    let input = col().w_full().px(16.0).pt(14.0).child(auto_grow(field, 2, MAX_LINES));
    let button = match &question {
        Some((request, questions)) => answer_button(s, tab, request, questions, empty, k),
        None => send_button(s, tab, empty, k),
    };
    let attach = IconButton::new(&ic::PLUS)
        .variant(IconButtonVariant::Ghost)
        .control_size(ControlSize::Large)
        .label("Add images")
        .on_press_tx(|_: &mut Desk, tx| {
            let options = rune::FileDialogOptions { title: "Add images".into(), ..Default::default() }.filter("Images", &crate::attachments::EXTENSIONS);
            tx.open_file(options, |s: &mut Desk, result, _| match result {
                Ok(Some(path)) => s.attach(&[path]),
                Ok(None) => {}
                Err(e) => s.toasts.show(e.to_string(), true),
            });
        })
        .build(k)
        .radius(16.0);
    let actions = row().w_full().items_center().gap(4.0).px(10.0).pb(10.0).pt(4.0).child(attach).child(row().grow(1.0)).child(crate::model_picker::model_picker(s, info, k, layer)).child(button);
    let thumbs = (!attached.is_empty()).then(|| row().w_full().gap(8.0).wrap().px(14.0).pt(12.0).children(attached.iter().enumerate().map(|(i, image)| thumbnail(s, tab, i, image, k))));
    let border = if edit.focused { k.c.layer_03 } else { k.c.border_base };
    let card = col()
        .key("composer")
        .w_full()
        .radius(CARD_RADIUS)
        .clip_rounded(CARD_RADIUS)
        .fill(k.c.layer_01)
        .border(1.0, border)
        .children(question.as_ref().map(|(request, questions)| question_panel(s, tab, request, questions, k)))
        .children(thumbs)
        .child(input)
        .child(actions)
        .on_drop_files(|s: &mut Desk, paths: &[std::path::PathBuf], _| s.attach(paths));
    crate::thread_view::in_lane(col().w_full().pt(6.0).pb(16.0).children(queue_view(s, tab, k)).child(card), lane)
}

fn suggestion_name(s: &Suggestion) -> &str {
    match s {
        Suggestion::File(path) => path,
        Suggestion::Desk(name, _) => name,
        Suggestion::Skill(skill) => &skill.name,
    }
}

fn suggestion_description(s: &Suggestion) -> &str {
    match s {
        Suggestion::File(_) => "",
        Suggestion::Desk(_, description) => description,
        Suggestion::Skill(skill) => &skill.description,
    }
}

/// The files or commands that complete what was typed, one row each.
fn suggestion_list(s: &Desk, tab: &str, k: &Kit) -> Option<El> {
    let rows = s.suggestions(tab);
    if rows.is_empty() {
        return None;
    }
    let active = s.drafts.active.min(rows.len() - 1);
    let items = rows.iter().enumerate().map(|(i, row_data)| {
        let (mark, label, detail): (&'static rune::Icon, String, String) = match row_data {
            Suggestion::File(path) => {
                let (dir, name) = path.rsplit_once('/').map_or(("", path.as_str()), |(d, n)| (d, n));
                (rune_theme_opencode::file_icons::file(path), name.to_owned(), if dir.is_empty() { String::new() } else { format!("{dir}/") })
            }
            Suggestion::Desk(name, description) => (&ic::SETTINGS_GEAR, format!("/{name}"), (*description).to_owned()),
            Suggestion::Skill(skill) => (
                if skill.builtin { &ic::OUTLINE_CONSOLE } else { &ic::POST_SKILL },
                format!("/{}{}", skill.name, skill.argument_hint.as_ref().map_or(String::new(), |h| format!(" {h}"))),
                skill.description.clone(),
            ),
        };
        let tab = tab.to_owned();
        row()
            .key(format!("suggestion-{i}"))
            .h(32.0)
            .w_full()
            .gap(8.0)
            .items_center()
            .px(10.0)
            .radius(8.0)
            .fill(if i == active { k.c.hover } else { rune::Color::TRANSPARENT })
            .role("option")
            .position_in_set(i + 1, rows.len())
            .on_press(move |s: &mut Desk| s.pick_suggestion(&tab, i))
            .child(icon(mark, 14.0).color(k.c.text_faint))
            .child(text(label).font(k.ty.text_small).color(k.c.text_base))
            .child(text(detail).font(k.ty.text_small).color(k.c.text_faint).truncate().grow(1.0))
    });
    let list = col().w_full().padding(6.0).children(items);
    Some(
        col()
            .key("suggestions")
            .w(COLUMN)
            .max_h(LIST_MAX)
            .radius(10.0)
            .fill(k.c.layer_01)
            .border(1.0, k.c.border_base)
            .role("listbox")
            .active_descendant(format!("suggestion-{active}"))
            .scroll(rune::ScrollSpec { stick_bottom: false })
            .child(list),
    )
}

/// Asks the core for what the list needs as the user types, and saves the drafts after a pause.
pub fn poll(s: &mut Desk, tx: &mut rune::Tx) -> bool {
    if let Some(wait) = sync(s) {
        tx.wake_after(wait);
    }
    false
}

/// What `poll` does, without the event loop. Returns how long until the drafts are due to be saved.
fn sync(s: &mut Desk) -> Option<std::time::Duration> {
    let tab = s.workspace.active_tab().cloned()?;
    if let Some(trigger) = s.trigger(&tab.id) {
        match trigger.kind {
            TriggerKind::File => {
                let wanted = (tab.project.clone(), trigger.query.clone());
                if s.drafts.asked.as_ref() != Some(&wanted) {
                    s.core.send(&ClientMessage::FilesSearch { project: wanted.0.clone(), query: wanted.1.clone() });
                    s.drafts.asked = Some(wanted);
                }
            }
            // Claude Code's commands are read once per project, when / first opens the list.
            TriggerKind::Command => {
                if s.drafts.skills_asked.insert(tab.project.clone()) {
                    s.core.send(&ClientMessage::ProjectGet { project: tab.project.clone(), part: "skills".into() });
                }
            }
        }
    }
    let at = s.drafts.edited_at?;
    if at.elapsed() < SAVE_DELAY {
        return Some(SAVE_DELAY - at.elapsed());
    }
    let open: Vec<String> = s.workspace.tabs.iter().map(|t| t.id.clone()).collect();
    s.drafts.save(&open);
    s.drafts.edited_at = None;
    None
}

impl Desk {
    /// Takes the paths the core found, for the query the list asked about.
    pub fn found_files(&mut self, project: String, query: String, paths: Vec<String>) {
        self.palette_files(&project, &query, &paths);
        if self.drafts.asked.as_ref() == Some(&(project.clone(), query.clone())) {
            self.drafts.found = Some((project, query, paths));
        }
    }
}

/// An attached image, with a button to take it off the message.
fn thumbnail(s: &Desk, tab: &str, index: usize, image: &crate::protocol::ImageAttachment, k: &Kit) -> El {
    let picture = match s.images.get(image) {
        Some(decoded) => el().size(THUMB, THUMB).radius(10.0).clip_rounded(10.0).border(1.0, k.c.border_base).pixels_fit(decoded.pixels(), rune::SurfaceFit::Fill),
        None => el().size(THUMB, THUMB).radius(10.0).fill(k.c.layer_02),
    };
    let tab = tab.to_owned();
    let remove = IconButton::new(&ic::XMARK_SMALL)
        .variant(IconButtonVariant::Contrast)
        .control_size(ControlSize::Small)
        .label("Remove image")
        .on_press(move |s: &mut Desk| {
            if let Some(images) = s.drafts.images.get_mut(&tab)
                && index < images.len()
            {
                images.remove(index);
            }
        })
        .build(k)
        .radius(10.0)
        .absolute(THUMB - 14.0, -6.0)
        .group_opacity(0.0, 1.0);
    el().key(format!("image-{index}")).size(THUMB, THUMB).hover_group().child(picture).child(remove)
}

/// "Next question", or "Submit answer(s)" on the last one. It waits for the question to have an answer.
fn answer_button(s: &Desk, tab: &str, request: &str, questions: &[Question], empty: bool, k: &Kit) -> El {
    let draft = s.drafts.questions.get(request).cloned().unwrap_or_default();
    let answered = !empty || questions.get(draft.index).is_some_and(|q| questions::answer_of(q, &draft).is_some());
    let label = if draft.index + 1 < questions.len() {
        "Next question"
    } else if questions.len() > 1 {
        "Submit answers"
    } else {
        "Submit answer"
    };
    let (tab, request, questions) = (tab.to_owned(), request.to_owned(), questions.to_vec());
    Button::new(label)
        .variant(ButtonVariant::Contrast)
        .disabled(!answered)
        .on_press(move |s: &mut Desk| s.advance_question(&tab, &request, &questions))
        .build(k)
        .radius(16.0)
        .key("answer")
}

/// Claude's questions, at the top of the composer, after T3 Code. One question shows at a time with its
/// options. The header folds the question away, and the cross dismisses it.
fn question_panel(s: &Desk, tab: &str, request: &str, questions: &[Question], k: &Kit) -> El {
    let draft = s.drafts.questions.get(request).cloned().unwrap_or_default();
    let Some(current) = questions.get(draft.index) else { return el() };
    let folded = s.drafts.folded.contains(request);
    let fold = {
        let request = request.to_owned();
        move |s: &mut Desk, _: &mut rune::Tx| {
            if !s.drafts.folded.remove(&request) {
                s.drafts.folded.insert(request.clone());
            }
        }
    };
    let dismiss = {
        let (tab, request) = (tab.to_owned(), request.to_owned());
        move |s: &mut Desk| s.core.send(&ClientMessage::QuestionAnswer { tab_id: tab.clone(), request_id: request.clone(), answers: None })
    };
    let small = |words: String, color| text(words).font(k.ty.text_xsmall).color(color);
    let head = row()
        .w_full()
        .gap(8.0)
        .items_center()
        .child(
            row()
                .grow(1.0)
                .min_w(0.0)
                .gap(8.0)
                .items_center()
                .role("button")
                .expanded(!folded)
                .on_press_tx(fold)
                .child(small(current.header.clone(), k.c.text_faint))
                .children(folded.then(|| small(current.question.clone(), k.c.text_muted).truncate())),
        )
        .children((questions.len() > 1).then(|| small(format!("{}/{}", draft.index + 1, questions.len()), k.c.text_faint)))
        .child(icon(&ic::CHEVRON_DOWN, 13.0).color(k.c.text_faint).rotate(if folded { -std::f32::consts::FRAC_PI_2 } else { 0.0 }))
        .child(IconButton::new(&ic::XMARK_SMALL).variant(IconButtonVariant::GhostMuted).control_size(ControlSize::Small).label("Dismiss question without answering").on_press(dismiss).build(k));
    let body = (!folded).then(|| {
        let options = current.options.iter().enumerate().map(|(i, option)| {
            let picked = questions::is_picked(current, &draft, &option.label);
            let (tab, request, label) = (tab.to_owned(), request.to_owned(), option.label.clone());
            row()
                .key(format!("option-{i}"))
                .w_full()
                .gap(10.0)
                .px(6.0)
                .py(6.0)
                .radius(8.0)
                .hover(if picked { rune::Color::TRANSPARENT } else { k.c.hover })
                .role("button")
                .on_press(move |s: &mut Desk| s.pick(&tab, &request, &label))
                .child(option_mark(picked, current.multi_select, k).mt(2.0))
                .child(
                    col()
                        .grow(1.0)
                        .min_w(0.0)
                        .gap(2.0)
                        .child(text(option.label.clone()).font(k.ty.text_small_medium).color(if picked { k.c.text_base } else { k.c.text_muted }))
                        .children(option.description.clone().map(|d| small(d, k.c.text_faint).wrap())),
                )
                .children((i < NUMBERED_OPTIONS).then(|| Keybind::new(&[(i + 1).to_string()]).build(k)))
        });
        col()
            .w_full()
            .max_h(QUESTION_MAX)
            .scroll(rune::ScrollSpec { stick_bottom: false })
            .child(col().w_full().pt(6.0).child(Markdown::new(current.question.as_str()).style(theme::markdown(k, s.account.text_size())).build(k)))
            .child(col().w_full().mt(6.0).children(options))
    });
    col().key("question").w_full().px(16.0).pt(10.0).pb(8.0).border_sides([0.0, 0.0, 1.0, 0.0], k.c.border_base).child(head).children(body)
}

/// A radio or checkbox mark, drawn as Desk draws it.
fn option_mark(checked: bool, multiple: bool, k: &Kit) -> El {
    let mark = el().size(16.0, 16.0).radius(if multiple { 4.0 } else { 8.0 }).center().border(1.0, if checked { k.c.text_base } else { k.c.text_faint });
    if !checked {
        return mark;
    }
    let inside = if multiple { icon(&ic::CHECK, 12.0).color(k.c.layer_01) } else { el().size(6.0, 6.0).radius(3.0).fill(k.c.layer_01) };
    mark.fill(k.c.text_base).child(inside)
}

/// A tab's queued messages, above the composer, after T3 Code: dashed bubbles waiting for the turn to end.
/// Each can be sent now, edited in the composer, or removed. A stop or an error pauses the queue.
fn queue_view(s: &Desk, tab: &str, k: &Kit) -> Option<El> {
    let thread = s.threads.get(tab)?;
    if thread.queue.is_empty() {
        return None;
    }
    let all = s.drafts.all_queued.contains(tab);
    let shown = if all { thread.queue.len() } else { QUEUE_SHOWN.min(thread.queue.len()) };
    let small = |words: &str| text(words.to_owned()).font(k.ty.text_xsmall).color(k.c.text_faint);
    let held = thread.queue_held.then(|| {
        let tab = tab.to_owned();
        row()
            .gap(8.0)
            .items_center()
            .child(small("The queue paused when the turn stopped."))
            .child(Button::new("Resume").control_size(ControlSize::Small).on_press(move |s: &mut Desk| s.core.send(&ClientMessage::QueueResume { tab_id: tab.clone() })).build(k))
    });
    let messages = thread.queue[..shown].iter().map(|message| queued(s, tab, message, k));
    let more = (thread.queue.len() > QUEUE_SHOWN).then(|| {
        let tab = tab.to_owned();
        let words = if all { "Show fewer".to_owned() } else { format!("Show all {} queued", thread.queue.len()) };
        text(words).font(k.ty.text_xsmall).color(k.c.text_faint).role("button").on_press(move |s: &mut Desk| {
            if !s.drafts.all_queued.remove(&tab) {
                s.drafts.all_queued.insert(tab.clone());
            }
        })
    });
    Some(col().key("queue").w_full().items_end().gap(6.0).mb(8.0).children(held).children(messages).children(more))
}

fn queued(s: &Desk, tab: &str, message: &QueuedMessage, k: &Kit) -> El {
    let ids = || (tab.to_owned(), message.id.clone());
    let bubble = el()
        .max_w(COLUMN * 0.8)
        .min_w(0.0)
        .radius(10.0)
        .border(1.0, k.c.text_faint.alpha(0.4))
        .border_dash(4.0, 3.0)
        .px(12.0)
        .py(8.0)
        // The text shrinks and wraps inside the bubble's cap, as `max-w-[80%]` lays it out.
        .child(text(message.text.clone()).wrap_anywhere().shrink().min_w(0.0).font(theme::thread_text(k, s.account.text_size())).color(k.c.text_muted));
    let (send_tab, send_id) = ids();
    let (edit_tab, edit_id) = ids();
    let (remove_tab, remove_id) = ids();
    let text_for_edit = message.text.clone();
    let actions = row()
        .gap(2.0)
        .items_center()
        .pr(4.0)
        .child(
            Button::new("Send now")
                .control_size(ControlSize::Small)
                .variant(ButtonVariant::GhostMuted)
                .icon(&ic::ARROW_UP)
                .on_press(move |s: &mut Desk| s.core.send(&ClientMessage::QueueSend { tab_id: send_tab.clone(), id: send_id.clone() }))
                .build(k),
        )
        .child(
            IconButton::new(&ic::EDIT)
                .variant(IconButtonVariant::GhostMuted)
                .control_size(ControlSize::Small)
                .label("Edit queued message")
                .help("Edit in the composer")
                .on_press(move |s: &mut Desk| s.edit_queued(&edit_tab, &edit_id, &text_for_edit))
                .build(k),
        )
        .child(
            IconButton::new(&ic::XMARK_SMALL)
                .variant(IconButtonVariant::GhostMuted)
                .control_size(ControlSize::Small)
                .label("Remove queued message")
                .help("Remove from queue")
                .on_press(move |s: &mut Desk| s.core.send(&ClientMessage::QueueRemove { tab_id: remove_tab.clone(), id: remove_id.clone() }))
                .build(k),
        );
    col().key(message.id.clone()).w_full().items_end().gap(4.0).child(bubble).child(actions)
}

impl Desk {
    /// Takes a queued message back into the composer to edit, after anything already typed.
    fn edit_queued(&mut self, tab: &str, id: &str, words: &str) {
        self.core.send(&ClientMessage::QueueRemove { tab_id: tab.to_owned(), id: id.to_owned() });
        let edit = self.drafts.edit(tab);
        let joined = if edit.text.trim().is_empty() { words.to_owned() } else { format!("{}\n\n{words}", edit.text) };
        edit.replace_text(joined);
    }
}

fn send_button(s: &Desk, tab: &str, empty: bool, k: &Kit) -> El {
    let round = |b: IconButton| b.control_size(ControlSize::Large).build(k).radius(16.0);
    if !s.busy(tab) {
        return round(IconButton::new(&ic::ARROW_UP).variant(IconButtonVariant::Submit).label("Send").disabled(empty).on_press_tx(|s: &mut Desk, _| {
            let alternate = s.cmd_held();
            s.submit(alternate);
        }))
        .key("send");
    }
    if empty {
        let tab = tab.to_owned();
        return round(IconButton::new(&ic::STOP).variant(IconButtonVariant::Contrast).label("Stop").on_press_tx(move |s: &mut Desk, _| s.interrupt(&tab))).key("stop");
    }
    let follow = s.follow_up(false);
    round(
        IconButton::new(follow.icon())
            .variant(IconButtonVariant::Submit)
            .label(follow.label())
            .help(format!("Click to {}, ⌘-click or ⌘Enter to {}", follow.name(), follow.other().name()))
            .on_press_tx(|s: &mut Desk, _| {
                let alternate = s.cmd_held();
                s.submit(alternate);
            }),
    )
    .key("follow-up")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::Event;
    use crate::protocol::{CoreMessage, TabInfo, ThreadEvent};
    use serde_json::Map;

    /// A window with one untitled tab, as restored from the core.
    fn desk() -> Desk {
        let mut s = Desk::default();
        let tab = TabInfo { id: "t".into(), title: crate::workspace::NEW_TAB_TITLE.into(), project: "/code/x".into(), terminals: vec![], model: "default".into(), effort: None, fast: None, permission_mode: "auto".into(), files: vec![], panel_active: None, review_scope: None, panel_open: None, rest: Map::new() };
        s.receive(Event::Message(CoreMessage::Tabs { tabs: vec![tab], active: Some("t".into()) })).unwrap();
        let _ = s.core.sent();
        s
    }

    fn type_text(s: &mut Desk, words: &str) {
        s.drafts.edit("t").text = words.into();
    }

    #[test]
    fn sending_names_an_untitled_tab_and_clears_the_draft() {
        let mut s = desk();
        type_text(&mut s, "  Fix the login form  ");
        s.submit(false);
        let sent = s.core.sent();
        let send = sent.iter().find(|m| m["type"] == "session.send").expect("a send");
        assert_eq!(send["text"], "Fix the login form");
        assert!(send.get("followUp").is_none(), "an idle tab starts a turn");
        assert_eq!(s.workspace.tabs[0].title, "Fix the login form");
        assert_eq!(s.drafts.text("t"), "");
    }

    #[test]
    fn while_claude_works_a_message_steers_and_cmd_queues() {
        let mut s = desk();
        s.threads.apply("t", ThreadEvent::Status { busy: true });
        type_text(&mut s, "go on");
        s.submit(false);
        type_text(&mut s, "and then this");
        s.submit(true);
        let follow: Vec<_> = s.core.sent().into_iter().filter(|m| m["type"] == "session.send").map(|m| m["followUp"].clone()).collect();
        assert_eq!(follow, ["steer", "queue"]);
    }

    #[test]
    fn a_pick_answers_a_single_question_and_typed_text_answers_in_its_place() {
        let mut s = desk();
        let item: crate::protocol::ThreadItem = serde_json::from_value(serde_json::json!({
            "type": "question", "id": "q", "requestId": "r",
            "questions": [
                { "header": "Scope", "question": "Which form?", "options": [{ "label": "Login" }, { "label": "Signup" }], "multiSelect": false },
                { "header": "Tests", "question": "Add tests?", "options": [{ "label": "Yes" }], "multiSelect": false }
            ]
        })).unwrap();
        s.threads.apply("t", ThreadEvent::Item { item });
        s.pick("t", "r", "Signup");
        type_text(&mut s, "Only unit tests");
        s.submit(false);
        let sent = s.core.sent();
        let answer = sent.iter().find(|m| m["type"] == "question.answer").expect("the answers go out");
        assert_eq!(answer["answers"], serde_json::json!({ "Which form?": "Signup", "Add tests?": "Only unit tests" }));
        assert!(sent.iter().all(|m| m["type"] != "session.send"), "an answer is not a message");
    }

    /// Types `words` with the caret at their end, in a focused composer.
    fn type_focused(s: &mut Desk, words: &str) {
        let edit = s.drafts.edit("t");
        edit.replace_text(words);
        edit.set_caret(words.len());
        edit.focused = true;
    }

    #[test]
    fn a_file_mention_asks_the_core_and_picks_a_path() {
        let mut s = desk();
        type_focused(&mut s, "look at @log");
        s.drafts.edited_at = None;
        sync(&mut s);
        let sent = s.core.sent();
        assert!(sent.iter().any(|m| m["type"] == "files.search" && m["query"] == "log" && m["project"] == "/code/x"));
        s.found_files("/code/x".into(), "log".into(), vec!["src/login.ts".into(), "src/logout.ts".into()]);
        assert!(s.list_key("t", &Key::Down));
        assert!(s.list_key("t", &Key::Enter));
        assert_eq!(s.drafts.text("t"), "look at @src/logout.ts ");
    }

    #[test]
    fn commands_list_desk_s_own_first_and_clear_runs_at_once() {
        let mut s = desk();
        type_focused(&mut s, "/cl");
        let names: Vec<String> = s.suggestions("t").iter().map(|x| suggestion_name(x).to_owned()).collect();
        assert_eq!(names, ["clear"]);
        assert!(s.list_key("t", &Key::Enter));
        assert_eq!(s.drafts.text("t"), "");
        assert_eq!(s.core.sent().last().unwrap()["type"], "thread.clear");
    }

    #[test]
    fn escape_closes_the_list_for_that_trigger() {
        let mut s = desk();
        type_focused(&mut s, "/");
        assert!(!s.suggestions("t").is_empty());
        assert!(s.list_key("t", &Key::Escape));
        assert!(s.suggestions("t").is_empty());
    }

    #[test]
    fn images_go_with_the_message_and_alone_are_enough_to_send() {
        let mut s = desk();
        let dir = std::env::temp_dir().join(format!("desk-composer-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (png, text) = (dir.join("a.png"), dir.join("a.txt"));
        std::fs::write(&png, [137, 80, 78, 71]).unwrap();
        std::fs::write(&text, "x").unwrap();
        s.attach(&[png, text]);
        assert_eq!(s.toasts.messages(), ["a.txt is not a PNG, JPEG, GIF or WebP image."]);
        s.submit(false);
        let sent = s.core.sent();
        let send = sent.iter().find(|m| m["type"] == "session.send").expect("an image alone sends");
        assert_eq!(send["images"], serde_json::json!([{ "mediaType": "image/png", "data": "iVBORw==" }]));
        assert!(s.drafts.images.get("t").is_none_or(Vec::is_empty));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn escape_stops_claude_only_when_pressed_twice() {
        let mut s = desk();
        s.threads.apply("t", ThreadEvent::Status { busy: true });
        s.escape("t");
        assert!(s.core.sent().is_empty());
        s.escape("t");
        assert_eq!(s.core.sent()[0]["type"], "session.interrupt");
    }

    #[test]
    fn a_slash_command_always_waits_in_the_queue() {
        assert_eq!(FollowUp::Steer.for_text("/compact"), FollowUp::Queue);
        assert_eq!(FollowUp::Steer.for_text("go on"), FollowUp::Steer);
        assert_eq!(FollowUp::Steer.other(), FollowUp::Queue);
    }
}
