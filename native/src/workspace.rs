//! The window's tabs and which one is in front, as `app/src/renderer/workspace.ts` keeps them. The
//! core saves the tabs as the app sends them, and sends them back on connect.

use crate::account::Account;
use crate::models::permission_for;
use crate::core::Core;
use crate::ids;
use crate::protocol::{ClientMessage, TabInfo};
use serde_json::Map;

pub const NEW_TAB_TITLE: &str = "New session";
/// A tab named after a message keeps this many characters of its first line.
const TITLE_LENGTH: usize = 40;

/// Whether a tab still has the name a new tab gets.
pub fn is_untitled(tab: &TabInfo) -> bool {
    tab.title == NEW_TAB_TITLE
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Place {
    /// At the end of the bar.
    End,
    /// Right after the active tab.
    Next,
}

/// A new tab needs a project, and the window has none yet. The caller asks for a folder.
#[derive(Debug, PartialEq)]
pub struct NeedsFolder;

#[derive(Default)]
pub struct Workspace {
    pub tabs: Vec<TabInfo>,
    pub active: Option<String>,
    /// Folders tabs have opened, most recent first, as the core keeps them.
    pub recent: Vec<String>,
    /// Whether the saved tabs are back. Until then, a change to the tabs would overwrite them.
    restored: bool,
}

impl Workspace {
    pub fn active_tab(&self) -> Option<&TabInfo> {
        self.tabs.iter().find(|t| Some(&t.id) == self.active.as_ref())
    }

    /// The project the window works in: the active tab's, else the most recent one.
    fn project(&self) -> Option<String> {
        self.active_tab().map(|t| t.project.clone()).or_else(|| self.recent.first().cloned())
    }

    /// Takes the saved tabs. An empty window opens a tab, or needs a folder for one.
    pub fn restore(&mut self, tabs: Vec<TabInfo>, active: Option<String>, account: &Account, core: &Core) -> Result<(), NeedsFolder> {
        self.active = active.filter(|id| tabs.iter().any(|t| &t.id == id)).or_else(|| tabs.first().map(|t| t.id.clone()));
        self.tabs = tabs;
        self.restored = true;
        if self.tabs.is_empty() {
            self.new_tab(Place::End, None, account, core)?;
        }
        Ok(())
    }

    /// Opens a tab in `project`, else in the window's project, and brings it to the front.
    pub fn new_tab(&mut self, place: Place, project: Option<String>, account: &Account, core: &Core) -> Result<String, NeedsFolder> {
        let project = project.or_else(|| self.project()).ok_or(NeedsFolder)?;
        let tab = self.tab_in(project, account);
        let id = tab.id.clone();
        let index = match place {
            Place::Next => self.tabs.iter().position(|t| Some(&t.id) == self.active.as_ref()).map_or(self.tabs.len(), |i| i + 1),
            Place::End => self.tabs.len(),
        };
        self.tabs.insert(index, tab);
        self.active = Some(id.clone());
        self.save(core);
        Ok(id)
    }

    /// A new tab's thread starts on the default model, effort and permission mode, and on the speed of the tab in front.
    fn tab_in(&self, project: String, account: &Account) -> TabInfo {
        let claude = account.settings.as_ref().map(|s| &s.claude);
        let model = claude.map_or_else(|| "default".to_owned(), |c| c.model.clone());
        let mode = claude.map_or("default", |c| c.permission_mode.as_str());
        TabInfo {
            id: ids::uuid(),
            title: NEW_TAB_TITLE.into(),
            project,
            terminals: Vec::new(),
            permission_mode: permission_for(account.model(&model), mode),
            effort: claude.and_then(|c| c.effort.clone()),
            fast: self.active_tab().and_then(|t| t.fast),
            model,
            files: vec![], panel_active: None, review_scope: None, panel_open: None, rest: Map::new(),
        }
    }

    /// Closes a tab. The tab before it comes to the front. A window keeps at least one tab.
    pub fn close_tab(&mut self, id: &str, account: &Account, core: &Core) -> Result<(), NeedsFolder> {
        let Some(index) = self.tabs.iter().position(|t| t.id == id) else { return Ok(()) };
        self.tabs.remove(index);
        if self.active.as_deref() == Some(id) {
            self.active = self.tabs.get(index.saturating_sub(1)).map(|t| t.id.clone());
        }
        if self.tabs.is_empty() {
            self.new_tab(Place::End, None, account, core)?;
        } else {
            self.save(core);
        }
        Ok(())
    }

    /// Moves a tab to `to` in the bar. ⌘1 to ⌘9 follow the new order.
    pub fn move_tab(&mut self, from: usize, to: usize, core: &Core) {
        if from == to || from >= self.tabs.len() || to >= self.tabs.len() {
            return;
        }
        let tab = self.tabs.remove(from);
        self.tabs.insert(to, tab);
        self.save(core);
    }

    pub fn show_tab(&mut self, id: &str, core: &Core) {
        self.active = Some(id.to_owned());
        self.save(core);
    }

    /// Selects the tab at `index`, as ⌘1 to ⌘9 do. There is no tab past the last.
    pub fn show_tab_at(&mut self, index: usize, core: &Core) {
        if let Some(id) = self.tabs.get(index).map(|t| t.id.clone()) {
            self.show_tab(&id, core);
        }
    }

    /// Puts back a closed tab the core returned, where it was.
    pub fn reopened(&mut self, tab: TabInfo, index: usize, core: &Core) {
        self.active = Some(tab.id.clone());
        self.tabs.insert(index.min(self.tabs.len()), tab);
        self.save(core);
    }

    /// Changes a tab's run settings or project, and saves it.
    pub fn change_tab(&mut self, id: &str, change: impl FnOnce(&mut TabInfo), core: &Core) {
        if let Some(tab) = self.tabs.iter_mut().find(|t| t.id == id) {
            change(tab);
            self.save(core);
        }
    }

    /// Opens or closes a tab's view pane. Each tab keeps its own.
    pub fn set_panel_open(&mut self, id: &str, open: bool, core: &Core) {
        self.change_tab(id, |t| t.panel_open = Some(open), core);
    }

    /// Shows a panel tab: a file, or Review when `panel` is None.
    pub fn show_panel_tab(&mut self, id: &str, panel: Option<String>, core: &Core) {
        self.change_tab(id, |t| t.panel_active = panel, core);
    }

    pub fn set_review_scope(&mut self, id: &str, scope: &str, core: &Core) {
        self.change_tab(id, |t| t.review_scope = Some(scope.to_owned()), core);
    }

    /// Shows a file in a tab's panel, at `line`, opening the panel. Each file has one tab: a file already
    /// open comes to the front and moves to the line.
    pub fn open_file_tab(&mut self, id: &str, path: &str, line: Option<u32>, core: &Core) {
        self.change_tab(
            id,
            |t| {
                let file_id = match t.files.iter_mut().find(|f| f.path == path) {
                    Some(open) => {
                        open.line = line;
                        open.id.clone()
                    }
                    None => {
                        let file = crate::protocol::FileTabInfo { id: ids::uuid(), path: path.to_owned(), line };
                        let file_id = file.id.clone();
                        t.files.push(file);
                        file_id
                    }
                };
                t.panel_active = Some(file_id);
                t.panel_open = Some(true);
            },
            core,
        );
    }

    /// Opens a terminal in a tab's panel, opening the panel. Returns its id.
    pub fn new_terminal(&mut self, id: &str, core: &Core) -> Option<String> {
        let terminal = ids::uuid();
        let created = terminal.clone();
        let found = self.tabs.iter().any(|t| t.id == id);
        self.change_tab(
            id,
            |t| {
                let title = if t.terminals.is_empty() { "Terminal".to_owned() } else { format!("Terminal {}", t.terminals.len() + 1) };
                t.terminals.push(crate::protocol::TerminalInfo { id: terminal.clone(), title });
                t.panel_active = Some(terminal);
                t.panel_open = Some(true);
            },
            core,
        );
        found.then_some(created)
    }

    /// Closes a panel terminal. The core ends the shell of a terminal no tab lists.
    pub fn close_terminal(&mut self, id: &str, terminal: &str, core: &Core) {
        self.change_tab(id, |t| t.terminals.retain(|x| x.id != terminal), core);
    }

    pub fn close_file_tab(&mut self, id: &str, file: &str, core: &Core) {
        self.change_tab(id, |t| t.files.retain(|f| f.id != file), core);
    }

    /// Names a tab after the first line of `text`.
    pub fn name_tab(&mut self, id: &str, text: &str, core: &Core) {
        let Some(tab) = self.tabs.iter_mut().find(|t| t.id == id) else { return };
        let line = text.trim().lines().next().unwrap_or("");
        tab.title = match line.chars().count() {
            0 => NEW_TAB_TITLE.into(),
            n if n > TITLE_LENGTH => format!("{}…", line.chars().take(TITLE_LENGTH).collect::<String>()),
            _ => line.into(),
        };
        self.save(core);
    }

    fn save(&self, core: &Core) {
        if self.restored {
            core.send(&ClientMessage::TabsSave { tabs: self.tabs.clone(), active: self.active.clone() });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(id: &str) -> TabInfo {
        TabInfo { id: id.into(), title: id.into(), project: format!("/code/{id}"), terminals: vec![], model: "default".into(), effort: None, fast: None, permission_mode: "auto".into(), files: vec![], panel_active: None, review_scope: None, panel_open: None, rest: Map::new() }
    }

    fn restored(ids: &[&str], active: &str) -> (Workspace, Core) {
        let (mut w, core) = (Workspace::default(), Core::default());
        w.restore(ids.iter().map(|id| tab(id)).collect(), Some(active.into()), &Account::default(), &core).unwrap();
        (w, core)
    }

    fn order(w: &Workspace) -> Vec<&str> {
        w.tabs.iter().map(|t| t.id.as_str()).collect()
    }

    #[test]
    fn nothing_saves_before_the_tabs_are_back() {
        let (mut w, core) = (Workspace::default(), Core::default());
        w.show_tab("a", &core);
        assert!(core.sent().is_empty());
    }

    #[test]
    fn an_empty_window_needs_a_folder_until_it_has_a_recent_project() {
        let (mut w, core) = (Workspace::default(), Core::default());
        assert_eq!(w.restore(vec![], None, &Account::default(), &core), Err(NeedsFolder));
        w.recent = vec!["/code/x".into()];
        w.new_tab(Place::End, None, &Account::default(), &core).unwrap();
        assert_eq!(w.tabs[0].project, "/code/x");
        assert_eq!(w.tabs[0].title, NEW_TAB_TITLE);
        assert_eq!(w.tabs[0].permission_mode, "default", "Auto needs a model known to take it");
    }

    #[test]
    fn a_next_tab_opens_after_the_active_one_in_its_project() {
        let (mut w, core) = restored(&["a", "b", "c"], "a");
        let id = w.new_tab(Place::Next, None, &Account::default(), &core).unwrap();
        assert_eq!(order(&w)[1], id);
        assert_eq!(w.tabs[1].project, "/code/a");
        assert_eq!(w.active.as_deref(), Some(id.as_str()));
        let sent = core.sent();
        assert_eq!(sent.last().unwrap()["type"], "tabs.save");
        assert_eq!(sent.last().unwrap()["active"], id.as_str());
    }

    #[test]
    fn closing_the_active_tab_shows_the_one_before_and_the_last_tab_is_replaced() {
        let (mut w, core) = restored(&["a", "b"], "b");
        w.recent = vec!["/code/recent".into()];
        w.close_tab("b", &Account::default(), &core).unwrap();
        assert_eq!(w.active.as_deref(), Some("a"));
        w.close_tab("a", &Account::default(), &core).unwrap();
        assert_eq!(w.tabs.len(), 1, "a window keeps one tab");
        assert_eq!(w.tabs[0].project, "/code/recent", "with no tab left, the new one opens in the most recent project");
    }

    #[test]
    fn moving_and_reopening_keep_the_order() {
        let (mut w, core) = restored(&["a", "b", "c"], "a");
        w.move_tab(0, 2, &core);
        assert_eq!(order(&w), ["b", "c", "a"]);
        w.reopened(tab("d"), 9, &core);
        assert_eq!(order(&w), ["b", "c", "a", "d"]);
        assert_eq!(w.active.as_deref(), Some("d"));
    }

    #[test]
    fn a_file_opens_once_and_comes_to_the_front_at_its_new_line() {
        let (mut w, core) = restored(&["a"], "a");
        w.open_file_tab("a", "/code/a/x.rs", Some(3), &core);
        w.show_panel_tab("a", None, &core);
        w.open_file_tab("a", "/code/a/x.rs", Some(9), &core);
        let tab = &w.tabs[0];
        assert_eq!(tab.files.len(), 1);
        assert_eq!(tab.files[0].line, Some(9));
        assert_eq!(tab.panel_active.as_deref(), Some(tab.files[0].id.as_str()));
        assert_eq!(tab.panel_open, Some(true));
    }

    #[test]
    fn a_long_first_line_names_the_tab() {
        let (mut w, core) = restored(&["a"], "a");
        w.name_tab("a", &format!("{}\nsecond line", "x".repeat(50)), &core);
        assert_eq!(w.tabs[0].title, format!("{}…", "x".repeat(40)));
        w.name_tab("a", "  \n", &core);
        assert_eq!(w.tabs[0].title, NEW_TAB_TITLE);
    }
}
