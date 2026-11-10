//! Each tab's thread as the core sends it, as `app/src/renderer/threads.ts` keeps it.

use crate::protocol::{ContextReading, Question, QueuedMessage, Subagent, ThreadEvent, ThreadItem, ThreadRow};
use std::collections::{HashMap, HashSet};

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
    /// The commands Claude left running in the background.
    pub background: Vec<crate::protocol::BackgroundTask>,
    /// The folds, groups and steps the user opened, by row or item id.
    pub open: HashSet<String>,
}

impl Thread {
    pub fn item(&self, id: &str) -> Option<&ThreadItem> {
        self.index.get(id).map(|&i| &self.items[i])
    }

    /// The questions Claude is waiting on, if any: their request id and the questions.
    pub fn pending_question(&self) -> Option<(&str, &[Question])> {
        self.items.iter().rev().find_map(|item| match item {
            ThreadItem::Question { request_id, questions, answered: false, .. } => Some((request_id.as_str(), questions.as_slice())),
            _ => None,
        })
    }

    /// The revision of the item with this id, or 0 before it arrives.
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
            ThreadEvent::Item { item } => thread.put(item, revision),
            ThreadEvent::TextDelta { id, delta } => {
                if let Some(&i) = thread.index.get(&id)
                    && let ThreadItem::Text { text, .. } = &mut thread.items[i]
                {
                    text.push_str(&delta);
                    thread.revisions[i] = revision;
                }
            }
            ThreadEvent::Status { busy } => thread.busy = busy,
            ThreadEvent::Context { reading } => thread.context = Some(reading),
            ThreadEvent::Init { model } => thread.model = Some(model),
            ThreadEvent::Subagent { subagent } => match thread.subagents.iter_mut().find(|x| x.id == subagent.id) {
                Some(known) => *known = subagent,
                None => thread.subagents.push(subagent),
            },
            ThreadEvent::Background { tasks } => thread.background = tasks,
            ThreadEvent::Other => {}
        }
    }

    pub fn queue(&mut self, tab: &str, messages: Vec<QueuedMessage>, held: bool) {
        let thread = self.get_mut(tab);
        thread.queue = messages;
        thread.queue_held = held;
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
