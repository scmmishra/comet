//! Each tab's thread as the core sends it.

use crate::protocol::{ContextReading, Question, QueuedMessage, Retry, Subagent, ThreadEvent, ThreadItem, ThreadRow};
use std::collections::{HashMap, HashSet};

/// A stop that waits for its turn to end.
#[derive(Clone, Debug, PartialEq)]
pub struct Stopping {
    /// When the user asked, in milliseconds since the epoch.
    pub since: f64,
    /// Whether the agent has not stopped in time, so Force stop can end it.
    pub unresponsive: bool,
    /// Whether the user pressed Force stop.
    pub forcing: bool,
}

#[derive(Default)]
pub struct Thread {
    pub items: Vec<ThreadItem>,
    /// Each item's place in `items`, by id.
    index: HashMap<String, usize>,
    /// Each item's revision, in `items` order. A row redraws only when a revision it shows moves.
    revisions: Vec<u64>,
    /// The items laid out as rows, as the core sends them.
    pub rows: Vec<ThreadRow>,
    /// Moves whenever `rows` changes.
    pub rows_version: u64,
    pub busy: bool,
    /// The model that ran, as the session reported it.
    pub model: Option<String>,
    pub context: Option<ContextReading>,
    /// Messages waiting for the running turn to end, as the core keeps them.
    pub queue: Vec<QueuedMessage>,
    /// Whether a stop or an error paused the queue.
    pub queue_held: bool,
    /// The subagents of the latest turn, and any still running from an earlier one, by id.
    pub subagents: Vec<Subagent>,
    /// The commands the agent left running in the background.
    pub background: Vec<crate::protocol::BackgroundTask>,
    /// The agent's session the thread runs in, once its first message started one.
    pub session_id: Option<String>,
    /// The branch the thread last ran on, as the core recorded it.
    pub branch: Option<String>,
    /// A stop the user asked of the running turn, until the turn ends.
    pub stopping: Option<Stopping>,
    /// The agent's latest retry of a failed request, until the turn's next output or its end.
    pub retry: Option<Retry>,
    /// Whether the end of the thread is out of view, which shows the Scroll to end pill.
    pub away_from_end: bool,
    /// The folds, groups and steps the user opened, by row or item id.
    pub open: HashSet<String>,
    /// Counts the messages the user sent as they arrive, not those the agent started itself.
    sent: u64,
    /// `sent` as the view last followed it to the end.
    followed: u64,
}

impl Thread {
    pub fn item(&self, id: &str) -> Option<&ThreadItem> {
        self.index.get(id).map(|&i| &self.items[i])
    }

    /// The questions the agent is waiting on, if any: their request id and the questions.
    pub fn pending_question(&self) -> Option<(&str, &[Question])> {
        self.items.iter().rev().find_map(|item| match item {
            ThreadItem::Question { request_id, questions, answered: false, .. } => Some((request_id.as_str(), questions.as_slice())),
            _ => None,
        })
    }

    /// The revision of the item with this id, or 0 before it arrives.
    /// The latest turn's changed files, whose box opens Review on the turn.
    pub fn latest_changes(&self) -> Option<&str> {
        self.items.iter().rev().find_map(|item| match item {
            ThreadItem::Changes { id, .. } => Some(id.as_str()),
            _ => None,
        })
    }

    /// Whether the user sent a message since the last call. The view then goes to the end.
    pub fn take_sent(&mut self) -> bool {
        let new = self.sent != self.followed;
        self.followed = self.sent;
        new
    }

    pub fn revision(&self, id: &str) -> u64 {
        self.index.get(id).map_or(0, |&i| self.revisions[i])
    }

    fn put(&mut self, item: ThreadItem, revision: u64) {
        match self.index.get(item.id()) {
            Some(&i) => {
                self.items[i] = item;
                self.revisions[i] = revision;
            }
            None => {
                self.index.insert(item.id().to_owned(), self.items.len());
                self.items.push(item);
                self.revisions.push(revision);
            }
        }
    }
}

/// Every tab's thread. A revision counter, shared by all, marks each change.
#[derive(Default)]
pub struct Threads {
    by_tab: HashMap<String, Thread>,
    revision: u64,
    /// The approval request whose More menu is open, by tab and request id.
    pub approval_menu: Option<(String, String)>,
}

impl Threads {
    pub fn get(&self, tab: &str) -> Option<&Thread> {
        self.by_tab.get(tab)
    }

    pub fn get_mut(&mut self, tab: &str) -> &mut Thread {
        self.by_tab.entry(tab.to_owned()).or_default()
    }

    fn next(&mut self) -> u64 {
        self.revision += 1;
        self.revision
    }

    /// A thread read back from the transcript replaces what the tab showed. Its rows follow, so the
    /// old rows stay until they arrive.
    pub fn history(&mut self, tab: &str, items: Vec<ThreadItem>, context: Option<ContextReading>) {
        let revision = self.next();
        let thread = self.get_mut(tab);
        thread.items.clear();
        thread.index.clear();
        thread.revisions.clear();
        for item in items {
            thread.put(item, revision);
        }
        thread.busy = false;
        thread.stopping = None;
        thread.retry = None;
        thread.context = context;
    }

    pub fn rows(&mut self, tab: &str, rows: Vec<ThreadRow>) {
        let revision = self.next();
        let thread = self.get_mut(tab);
        thread.rows = rows;
        thread.rows_version = revision;
    }

    pub fn apply(&mut self, tab: &str, event: ThreadEvent) {
        let revision = self.next();
        let thread = self.get_mut(tab);
        match event {
            ThreadEvent::Item { item } => {
                if matches!(item, ThreadItem::User { self_started: false, .. }) && thread.item(item.id()).is_none() {
                    thread.sent += 1;
                }
                if matches!(item, ThreadItem::Result { .. }) {
                    thread.stopping = None;
                }
                thread.retry = None;
                thread.put(item, revision);
            }
            ThreadEvent::TextDelta { id, delta } => {
                thread.retry = None;
                if let Some(&i) = thread.index.get(&id)
                    && let ThreadItem::Text { text, .. } = &mut thread.items[i]
                {
                    text.push_str(&delta);
                    thread.revisions[i] = revision;
                }
            }
            ThreadEvent::Status { busy } => {
                thread.busy = busy;
                if !busy {
                    thread.stopping = None;
                    thread.retry = None;
                }
            }
            ThreadEvent::Context { reading } => thread.context = Some(reading),
            ThreadEvent::Init { model } => thread.model = Some(model),
            ThreadEvent::Subagent { subagent } => match thread.subagents.iter_mut().find(|x| x.id == subagent.id) {
                Some(known) => *known = subagent,
                None => thread.subagents.push(subagent),
            },
            ThreadEvent::Background { tasks } => thread.background = tasks,
            // Force stop, once pressed, stays pressed while the same stop waits.
            ThreadEvent::Stopping { since, unresponsive } => {
                let forcing = thread.stopping.as_ref().is_some_and(|stop| stop.forcing);
                thread.stopping = Some(Stopping { since, unresponsive, forcing });
            }
            ThreadEvent::Retry(retry) => thread.retry = Some(retry),
            ThreadEvent::Other => {}
        }
    }

    pub fn queue(&mut self, tab: &str, messages: Vec<QueuedMessage>, held: bool) {
        let thread = self.get_mut(tab);
        thread.queue = messages;
        thread.queue_held = held;
    }

    /// Notes that the user pressed Force stop. True when a stop waits for it.
    pub fn force_stopping(&mut self, tab: &str) -> bool {
        match self.get_mut(tab).stopping.as_mut() {
            Some(stop) if stop.unresponsive && !stop.forcing => {
                stop.forcing = true;
                true
            }
            _ => false,
        }
    }

    /// A new turn starts a new set of subagents, and those still running stay.
    pub fn new_turn(&mut self, tab: &str) {
        self.get_mut(tab).subagents.retain(|x| x.status == "running");
    }

    /// Opens a fold, group or step that is closed, and closes one that is open.
    pub fn toggle(&mut self, tab: &str, id: &str) {
        let open = &mut self.get_mut(tab).open;
        if !open.remove(id) {
            open.insert(id.to_owned());
        }
    }

    /// Drops the threads of tabs that are gone.
    pub fn keep(&mut self, tabs: &[String]) {
        self.by_tab.retain(|id, _| tabs.contains(id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(id: &str, body: &str, done: bool) -> ThreadItem {
        ThreadItem::Text { id: id.into(), text: body.into(), done, at: None }
    }

    fn user(id: &str, self_started: bool) -> ThreadItem {
        ThreadItem::User { id: id.into(), text: "hi".into(), images: vec![], at: None, steered: false, self_started }
    }

    #[test]
    fn a_message_the_user_sends_is_noted_once() {
        let mut threads = Threads::default();
        threads.history("t", vec![user("old", false)], None);
        assert!(!threads.get_mut("t").take_sent(), "a thread read back is not a send");
        threads.apply("t", ThreadEvent::Item { item: user("u1", false) });
        threads.apply("t", ThreadEvent::Item { item: user("u1", false) });
        assert!(threads.get_mut("t").take_sent());
        assert!(!threads.get_mut("t").take_sent(), "an update to the same message is not a new one");
        threads.apply("t", ThreadEvent::Item { item: user("task", true) });
        assert!(!threads.get_mut("t").take_sent(), "a turn the agent started is not the user's");
    }

    #[test]
    fn deltas_grow_a_text_and_move_only_its_revision() {
        let mut threads = Threads::default();
        threads.history("t", vec![text("a", "first", true), text("b", "", false)], None);
        let (a, b) = (threads.get("t").unwrap().revision("a"), threads.get("t").unwrap().revision("b"));
        threads.apply("t", ThreadEvent::TextDelta { id: "b".into(), delta: "Hel".into() });
        threads.apply("t", ThreadEvent::TextDelta { id: "b".into(), delta: "lo".into() });
        let thread = threads.get("t").unwrap();
        assert_eq!(thread.item("b"), Some(&text("b", "Hello", false)));
        assert_eq!(thread.revision("a"), a);
        assert!(thread.revision("b") > b);
    }

    #[test]
    fn an_item_with_a_known_id_replaces_it_in_place() {
        let mut threads = Threads::default();
        threads.apply("t", ThreadEvent::Item { item: text("a", "", false) });
        threads.apply("t", ThreadEvent::Item { item: text("b", "x", true) });
        threads.apply("t", ThreadEvent::Item { item: text("a", "done", true) });
        let ids: Vec<&str> = threads.get("t").unwrap().items.iter().map(|i| i.id()).collect();
        assert_eq!(ids, ["a", "b"]);
        assert_eq!(threads.get("t").unwrap().item("a"), Some(&text("a", "done", true)));
    }

    fn retry(attempt: u32) -> ThreadEvent {
        ThreadEvent::Retry(Retry { attempt, max_retries: 10, delay_ms: 1500.0, error: "Overloaded".into() })
    }

    #[test]
    fn a_stop_lasts_until_the_turn_ends() {
        let mut threads = Threads::default();
        threads.apply("t", ThreadEvent::Status { busy: true });
        threads.apply("t", ThreadEvent::Stopping { since: 5.0, unresponsive: false });
        assert!(!threads.force_stopping("t"), "Force stop waits for the agent to be unresponsive");
        threads.apply("t", ThreadEvent::Stopping { since: 5.0, unresponsive: true });
        assert!(threads.force_stopping("t"));
        assert!(!threads.force_stopping("t"), "a second press sends nothing more");
        threads.apply("t", ThreadEvent::Item { item: text("a", "x", true) });
        assert_eq!(threads.get("t").unwrap().stopping, Some(Stopping { since: 5.0, unresponsive: true, forcing: true }), "output does not end the stop");
        threads.apply("t", ThreadEvent::Status { busy: false });
        assert!(threads.get("t").unwrap().stopping.is_none());
        threads.apply("t", ThreadEvent::Stopping { since: 9.0, unresponsive: false });
        threads.apply("t", ThreadEvent::Item { item: ThreadItem::Result { id: "r".into(), duration_ms: 1.0, is_error: false, stopped: true } });
        assert!(threads.get("t").unwrap().stopping.is_none(), "the turn's result ends it too");
    }

    #[test]
    fn a_retry_gives_way_to_the_next_retry_and_to_output() {
        let mut threads = Threads::default();
        threads.apply("t", ThreadEvent::Item { item: text("a", "", false) });
        threads.apply("t", retry(1));
        threads.apply("t", retry(2));
        assert_eq!(threads.get("t").unwrap().retry.as_ref().map(|r| r.attempt), Some(2));
        threads.apply("t", ThreadEvent::TextDelta { id: "a".into(), delta: "Hi".into() });
        assert!(threads.get("t").unwrap().retry.is_none());
        threads.apply("t", retry(3));
        threads.apply("t", ThreadEvent::Item { item: text("b", "x", true) });
        assert!(threads.get("t").unwrap().retry.is_none());
        threads.apply("t", retry(4));
        threads.apply("t", ThreadEvent::Status { busy: false });
        assert!(threads.get("t").unwrap().retry.is_none(), "the turn's end clears it");
    }

    #[test]
    fn history_keeps_the_rows_until_new_ones_arrive() {
        let mut threads = Threads::default();
        threads.rows("t", vec![ThreadRow::Item { id: "a".into() }]);
        threads.apply("t", ThreadEvent::Status { busy: true });
        threads.history("t", vec![text("a", "x", true)], None);
        let thread = threads.get("t").unwrap();
        assert_eq!(thread.rows.len(), 1);
        assert!(!thread.busy);
    }
}
