//! Plugin views, as `app/src/renderer/plugins.ts` and `plugin-view.tsx` draw them. Plugin code runs in
//! the core and sends its UI as operations on a tree of nodes. The app keeps each plugin's nodes and
//! draws each node with Desk's own component for its primitive.

use crate::format;
use crate::protocol::{ClientMessage, DrawnView, TabLayout, UiOp};
use crate::shell::Desk;
use crate::theme;
use rune::{El, ScrollSpec, TextEdit, col, el, row, text, text_input};
use rune_kit::{ButtonVariant, Kit, Markdown};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// The node a view is drawn into, and the node type of a text. Neither is a primitive.
const ROOT_NODE: &str = "root";
const TEXT_NODE: &str = "#text";

/// A plugin's UI node, as the app keeps it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Node {
    pub kind: String,
    pub props: Map<String, Value>,
    pub children: Vec<u64>,
    pub text: Option<String>,
    parent: Option<u64>,
}

/// Applies a batch of operations to a plugin's nodes, in place, as the protocol's `applyOps` does. A node
/// moved to another parent leaves its old one first. A removed node is dropped only if the batch ends
/// with it out, since Solid removes and inserts a node again in one update.
pub fn apply_ops(nodes: &mut HashMap<u64, Node>, ops: &[UiOp]) {
    fn detach(nodes: &mut HashMap<u64, Node>, id: u64) {
        let parent = nodes.get_mut(&id).and_then(|n| n.parent.take());
        if let Some(parent) = parent.and_then(|p| nodes.get_mut(&p)) {
            parent.children.retain(|c| *c != id);
        }
    }
    fn drop_tree(nodes: &mut HashMap<u64, Node>, id: u64) {
        if let Some(node) = nodes.remove(&id) {
            for child in node.children {
                drop_tree(nodes, child);
            }
        }
    }
    let mut removed = Vec::new();
    for op in ops {
        match op {
            UiOp::Create { id, kind } => {
                nodes.insert(*id, Node { kind: kind.clone(), ..Node::default() });
            }
            UiOp::Text { id, text } => match nodes.get_mut(id) {
                Some(node) => node.text = Some(text.clone()),
                None => {
                    nodes.insert(*id, Node { kind: TEXT_NODE.into(), text: Some(text.clone()), ..Node::default() });
                }
            },
            UiOp::Set { id, key, value } => {
                if let Some(node) = nodes.get_mut(id) {
                    node.props.insert(key.clone(), value.clone());
                }
            }
            UiOp::Insert { parent, id, before } => {
                if !nodes.contains_key(parent) || !nodes.contains_key(id) {
                    continue;
                }
                detach(nodes, *id);
                let siblings = &mut nodes.get_mut(parent).expect("checked above").children;
                match before.and_then(|b| siblings.iter().position(|c| *c == b)) {
                    Some(at) => siblings.insert(at, *id),
                    None => siblings.push(*id),
                }
                nodes.get_mut(id).expect("checked above").parent = Some(*parent);
            }
            UiOp::Remove { id, .. } => {
                detach(nodes, *id);
                removed.push(*id);
            }
        }
    }
    for id in removed {
        if nodes.get(&id).is_some_and(|n| n.parent.is_none()) {
            drop_tree(nodes, id);
        }
    }
}

/// Each plugin's nodes, what plugins show in each tab, and what the user typed into plugin fields.
#[derive(Default)]
pub struct Plugins {
    nodes: HashMap<String, HashMap<u64, Node>>,
    pub layouts: HashMap<String, TabLayout>,
    /// Tabs whose layout was asked for, so each asks once.
    asked: HashSet<String>,
    /// Each plugin text field's text, and the value it last heard from the plugin or sent to it.
    inputs: HashMap<(String, u64), (TextEdit, String)>,
    /// Setups across projects, as last read for the palette.
    pub setups: Vec<crate::protocol::ProjectSetup>,
}

impl Plugins {
    pub fn apply(&mut self, plugin: &str, ops: &[UiOp], reset: bool) {
        let nodes = self.nodes.entry(plugin.to_owned()).or_default();
        if reset {
            nodes.clear();
        }
        apply_ops(nodes, ops);
    }

    fn node(&self, plugin: &str, id: u64) -> Option<&Node> {
        self.nodes.get(plugin)?.get(&id)
    }

    /// Whether a view drew nothing, such as a card that does not apply.
    pub fn is_empty(&self, view: &DrawnView) -> bool {
        self.node(&view.plugin, view.root).is_none_or(|n| n.children.is_empty())
    }
}

fn handler(props: &Map<String, Value>, name: &str) -> Option<u64> {
    props.get(name)?.get("handler")?.as_u64()
}

fn prop<'a>(props: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    props.get(name)?.as_str()
}

impl Desk {
    /// Asks the core for the active tab's layout, once per tab.
    pub fn load_layout(&mut self) {
        let Some(tab) = self.workspace.active.clone() else { return };
        if self.plugins.asked.insert(tab.clone()) {
            self.core.send(&ClientMessage::LayoutGet { tab_id: tab });
        }
    }

    /// The core sent the tabs, as it does on each connect. A core that restarted holds no drawn views, so
    /// each tab asks again.
    pub fn reload_layouts(&mut self) {
        self.plugins.asked.clear();
        self.load_layout();
    }

    /// Opens a plugin's setup in a tab of its own, in its project. The core lays the tab out once it is saved.
    pub fn open_setup(&mut self, project: &str, id: &str, title: &str) {
        let Ok(tab) = self.workspace.new_tab(crate::workspace::Place::End, Some(project.to_owned()), &self.account, &self.core) else { return };
        self.workspace.name_tab(&tab, title, &self.core);
        self.plugins.asked.insert(tab.clone());
        self.core.send(&ClientMessage::SetupOpen { tab_id: tab, setup: id.to_owned() });
        self.sync_start();
    }

    /// Runs a handler a plugin's node holds, such as a button's onClick.
    fn fire(&self, plugin: &str, handler: Option<u64>, args: Vec<Value>) {
        if let Some(handler) = handler {
            self.core.send(&ClientMessage::PluginEvent { plugin: plugin.to_owned(), handler, args });
        }
    }

    /// A panel instance opened, so it comes to the front. The pane opens only in a tab where the user has
    /// not opened or closed it yet.
    pub fn panel_shown(&mut self, tab: &str, id: &str) {
        let untouched = self.workspace.tabs.iter().find(|t| t.id == tab).is_some_and(|t| t.panel_open.is_none());
        let id = id.to_owned();
        self.workspace.change_tab(
            tab,
            |t| {
                t.panel_active = Some(id);
                if untouched {
                    t.panel_open = Some(true);
                }
            },
            &self.core,
        );
        self.sync_panel();
    }

    /// Tells plugins what was typed into their fields, and takes values they set that differ from what they last heard.
    pub fn sync_plugin_inputs(&mut self) {
        let mut events = Vec::new();
        for ((plugin, id), (edit, heard)) in &mut self.plugins.inputs {
            let Some(node) = self.plugins.nodes.get(plugin).and_then(|n| n.get(id)) else { continue };
            let value = prop(&node.props, "value").unwrap_or("");
            if edit.text != *heard {
                *heard = edit.text.clone();
                events.push((plugin.clone(), handler(&node.props, "onInput"), vec![Value::String(edit.text.clone())]));
            } else if value != heard {
                *heard = value.to_owned();
                edit.replace_text(value);
            }
        }
        for (plugin, handler, args) in events {
            self.fire(&plugin, handler, args);
        }
    }
}

/// A view a plugin drew for a tab. Where it sits gives it its frame.
pub fn view(s: &Desk, view: &DrawnView, project: &str, k: &Kit) -> El {
    node_view(s, &view.plugin, view.root, project, k)
}

fn children(s: &Desk, plugin: &str, node: &Node, project: &str, k: &Kit) -> Vec<El> {
    node.children.iter().map(|c| node_view(s, plugin, *c, project, k).key(format!("node-{c}"))).collect()
}

fn node_view(s: &Desk, plugin: &str, id: u64, project: &str, k: &Kit) -> El {
    let Some(node) = s.plugins.node(plugin, id) else { return el() };
    let props = &node.props;
    let plugin_owned = plugin.to_owned();
    match node.kind.as_str() {
        TEXT_NODE => text(node.text.clone().unwrap_or_default()).font(crate::theme::text(13.0)).color(k.c.text_base).wrap(),
        ROOT_NODE => col().w_full().grow(1.0).min_h(0.0).children(children(s, plugin, node, project, k)),
        "stack" => {
            let row_direction = prop(props, "direction") == Some("row");
            let gap = props.get("gap").and_then(Value::as_f64).unwrap_or(2.0) as f32 * 4.0;
            let base = if row_direction { row().items_center() } else { col() };
            let base = base.min_w(0.0).min_h(0.0).gap(gap).children(children(s, plugin, node, project, k));
            if props.get("grow").and_then(Value::as_bool) == Some(true) { base.grow(1.0) } else { base }
        }
        "text" => {
            let (font, color) = match prop(props, "tone") {
                Some("muted") => (crate::theme::text(13.0), k.c.text_faint),
                Some("strong") => (crate::theme::medium(13.0), k.c.text_base),
                _ => (crate::theme::text(13.0), k.c.text_base),
            };
            let words: String = node.children.iter().filter_map(|c| s.plugins.node(plugin, *c)?.text.clone()).collect();
            text(words).font(font).color(color).wrap()
        }
        "list" => col().w_full().grow(1.0).min_h(0.0).gap(1.0).scroll(ScrollSpec { stick_bottom: false }).children(children(s, plugin, node, project, k)),
        "item" => item_view(props, plugin_owned, k),
        "button" => {
            let variant = match prop(props, "variant") {
                Some("primary") => ButtonVariant::Contrast,
                Some("ghost") => ButtonVariant::Ghost,
                _ => ButtonVariant::Neutral,
            };
            let on_click = handler(props, "onClick");
            crate::theme::button(prop(props, "label").unwrap_or(""))
                .variant(variant)
                .disabled(props.get("disabled").and_then(Value::as_bool) == Some(true))
                .on_press(move |s: &mut Desk| s.fire(&plugin_owned, on_click, Vec::new()))
                .build(k)
        }
        "textinput" => input_view(s, plugin, id, props, k),
        "messages" => messages_view(props, k),
        "markdown" => col()
            .w_full()
            .min_h(0.0)
            .scroll(ScrollSpec { stick_bottom: false })
            .child(Markdown::new(prop(props, "text").unwrap_or("")).style(theme::markdown(k, s.account.text_size())).build(k)),
        other => text(format!("{other} is not a Desk element.")).font(crate::theme::text(13.0)).color(k.c.text_faint),
    }
}

/// One row of a list. It is selectable when it has `onSelect`.
fn item_view(props: &Map<String, Value>, plugin: String, k: &Kit) -> El {
    let selected = props.get("selected").and_then(Value::as_bool) == Some(true);
    let on_select = handler(props, "onSelect");
    let line = |name: &str| prop(props, name).map(|t| text(t.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_faint).truncate());
    let badge = props.get("badge").map(|b| {
        let words = b.get("text").and_then(Value::as_str).unwrap_or("");
        let (fill, ink) = match b.get("tint").and_then(Value::as_str) {
            Some("blue" | "purple") => (k.c.text_accent.alpha(0.14), k.c.text_accent),
            Some("green") => (k.c.success.bg, k.c.success.fg),
            Some("red") => (k.c.danger.bg, k.c.danger.fg),
            Some("orange") => (theme::claude().alpha(0.15), theme::claude()),
            _ => (k.c.layer_02, k.c.text_muted),
        };
        crate::ui::tinted_badge(words, fill, ink)
    });
    let head = row().w_full().gap(8.0).items_center().child(text(prop(props, "title").unwrap_or("").to_owned()).font(crate::theme::text(13.0)).color(k.c.text_base).truncate().grow(1.0)).children(badge);
    // The Electron app's grid: the title and its badge on one line, the quieter lines under it, no gap
    // between, rounded to 0.5rem of Desk's 13 pixel root.
    let item = col()
        .w_full()
        .px(10.0)
        .py(8.0)
        .radius(6.5)
        .fill(if selected { k.c.layer_02 } else { rune::Color::TRANSPARENT })
        .child(head)
        .children(line("subtitle"))
        .children(line("detail"));
    match on_select {
        Some(_) => item.hover(k.c.hover).role("button").on_press(move |s: &mut Desk| s.fire(&plugin, on_select, Vec::new())),
        None => item,
    }
}

/// A plugin's text field. What is typed stays here, so typing never waits on the plugin.
fn input_view(s: &Desk, plugin: &str, id: u64, props: &Map<String, Value>, k: &Kit) -> El {
    let key = (plugin.to_owned(), id);
    let edit = s.plugins.inputs.get(&key).map(|(e, _)| e.clone()).unwrap_or_else(|| TextEdit::new(prop(props, "value").unwrap_or("")));
    let multiline = props.get("multiline").and_then(Value::as_bool) == Some(true);
    let on_submit = handler(props, "onSubmit");
    let initial = prop(props, "value").unwrap_or("").to_owned();
    let (edit_key, submit_plugin) = (key.clone(), plugin.to_owned());
    let field = text_input(&edit, crate::theme::text(13.0))
        .w_full()
        .color(k.c.text_base)
        .placeholder(prop(props, "placeholder").unwrap_or("").to_owned(), k.c.text_faint)
        .caret(k.c.text_base, k.selection())
        .on_edit(move |s: &mut Desk| &mut s.plugins.inputs.entry(edit_key.clone()).or_insert_with(|| (TextEdit::new(initial.clone()), initial.clone())).0)
        .on_submit(move |s: &mut Desk, _| {
            // Enter submits, or ⌘Enter in a multiline field.
            if !multiline || s.cmd_held() {
                s.sync_plugin_inputs();
                s.fire(&submit_plugin, on_submit, Vec::new());
            }
        });
    let field = if multiline { field } else { field.single_line() };
    col().w_full().min_h(if multiline { 72.0 } else { 0.0 }).px(11.0).py(8.0).radius(8.0).fill(k.c.layer_01).border(1.0, k.c.border_base).child(field)
}

/// A conversation, oldest first, kept scrolled to its end.
fn messages_view(props: &Map<String, Value>, k: &Kit) -> El {
    let items = props.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    let rows = items.iter().map(|m| {
        let get = |name: &str| m.get(name).and_then(Value::as_str);
        let at = m.get("at").and_then(Value::as_f64).map(|at| format!(" · {}", format::message_time(at, format::now_ms()))).unwrap_or_default();
        let words = get("text").unwrap_or("").to_owned();
        if get("kind") == Some("activity") {
            return row().w_full().justify_center().child(text(format!("{words}{at}")).font(crate::theme::text(12.0)).color(k.c.text_faint));
        }
        let incoming = m.get("incoming").and_then(Value::as_bool) == Some(true);
        let note = get("kind") == Some("note");
        let meta = format!("{}{}{at}", if note { "Private note · " } else { "" }, get("author").unwrap_or(""));
        let fill = if incoming {
            k.c.layer_02
        } else if note {
            theme::claude().alpha(0.15)
        } else {
            k.c.text_accent.alpha(0.14)
        };
        let column = col().w_full().gap(4.0);
        let column = if incoming { column.items_start() } else { column.items_end() };
        column
            .child(text(meta).font(crate::theme::text(12.0)).color(k.c.text_faint))
            .child(el().max_w(420.0).min_w(0.0).radius(10.0).fill(fill).px(12.0).py(8.0).child(text(words).font(crate::theme::text(13.0)).color(k.c.text_base).wrap().shrink().min_w(0.0)))
    });
    col().w_full().grow(1.0).min_h(0.0).gap(12.0).scroll(ScrollSpec { stick_bottom: true }).children(rows.collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ops(json: serde_json::Value) -> Vec<UiOp> {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn a_node_removed_and_inserted_again_in_one_batch_stays() {
        let mut nodes = HashMap::new();
        apply_ops(&mut nodes, &ops(serde_json::json!([
            { "op": "create", "id": 1, "type": "root" },
            { "op": "create", "id": 2, "type": "text" },
            { "op": "text", "id": 3, "text": "a" },
            { "op": "insert", "parent": 1, "id": 2 },
            { "op": "insert", "parent": 2, "id": 3 },
            { "op": "remove", "parent": 2, "id": 3 },
            { "op": "insert", "parent": 2, "id": 3 }
        ])));
        assert_eq!(nodes[&2].children, [3]);
        apply_ops(&mut nodes, &ops(serde_json::json!([{ "op": "remove", "parent": 1, "id": 2 }])));
        assert!(!nodes.contains_key(&2) && !nodes.contains_key(&3), "a removed node goes with its children");
    }

    #[test]
    fn insert_before_places_a_node_and_moving_detaches_it() {
        let mut nodes = HashMap::new();
        apply_ops(&mut nodes, &ops(serde_json::json!([
            { "op": "create", "id": 1, "type": "stack" },
            { "op": "create", "id": 2, "type": "stack" },
            { "op": "create", "id": 3, "type": "button" },
            { "op": "create", "id": 4, "type": "button" },
            { "op": "insert", "parent": 1, "id": 3 },
            { "op": "insert", "parent": 1, "id": 4, "before": 3 },
            { "op": "insert", "parent": 2, "id": 3 },
            { "op": "set", "id": 4, "key": "label", "value": "Go" }
        ])));
        assert_eq!(nodes[&1].children, [4]);
        assert_eq!(nodes[&2].children, [3]);
        assert_eq!(nodes[&4].props["label"], "Go");
    }
}
