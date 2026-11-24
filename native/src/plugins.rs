//! Plugin views. Plugin code runs in
//! the core and sends its UI as operations on a tree of nodes. The app keeps each plugin's nodes and
//! draws each node with Comet's own component for its primitive.

use crate::diff_view::{DiffMode, DiffState, DiffView, parse};
use crate::format;
use crate::protocol::{ClientMessage, DrawnView, TabLayout, UiOp};
use crate::shell::Comet;
use crate::theme;
use crate::icons;
use rune::{El, ScrollSpec, TextEdit, col, el, icon, row, text, text_input};
use rune_theme_opencode::icons as ic;
use rune_kit::{ButtonVariant, Kit};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// The node a view is drawn into, and the node type of a text. Neither is a primitive.
const ROOT_NODE: &str = "root";
const TEXT_NODE: &str = "#text";
const DIFF_NODE: &str = "diff";

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
    /// Each diff node as drawn, by plugin and node.
    diffs: HashMap<(String, u64), PluginDiff>,
    /// The pictures each Markdown node shows, by source. Views read the app's state without changing it, so
    /// they are kept behind a cell.
    pictures: std::cell::RefCell<HashMap<(String, u64), crate::images::Kept>>,
}

/// A diff node as drawn: the props it was made from, so a change parses it again, its sections'
/// headings, and the files a diff view draws.
struct PluginDiff {
    source: Value,
    sections: Vec<SectionHeading>,
    state: DiffState,
}

/// A section's heading, as the plugin sent it: a quiet label, a title and a note.
struct SectionHeading {
    label: Option<String>,
    title: String,
    note: Option<String>,
}

/// What a diff node is made from: its patch, or its sections, each with a patch of its own.
fn diff_source(props: &Map<String, Value>) -> Value {
    serde_json::json!([props.get("patch"), props.get("sections")])
}

impl Plugins {
    pub fn apply(&mut self, plugin: &str, ops: &[UiOp], reset: bool) {
        let nodes = self.nodes.entry(plugin.to_owned()).or_default();
        if reset {
            nodes.clear();
        }
        apply_ops(nodes, ops);
    }

    /// Diffs draw as Review's do, unified or split.
    pub fn set_diff_mode(&mut self, mode: DiffMode) {
        for diff in self.diffs.values_mut() {
            diff.state.set_mode(mode);
        }
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

impl Comet {
    /// Applies a plugin's operations. A diff node whose patch or sections changed is parsed again, which
    /// resets its folds. A diff node that left keeps no state.
    pub fn take_plugin_ops(&mut self, plugin: &str, ops: &[UiOp], reset: bool) {
        self.plugins.apply(plugin, ops, reset);
        let nodes = self.plugins.nodes.get(plugin);
        let is_diff = |id: u64| nodes.and_then(|n| n.get(&id)).is_some_and(|n| n.kind == DIFF_NODE);
        self.plugins.diffs.retain(|(owner, id), _| owner != plugin || is_diff(*id));
        self.plugins.pictures.borrow_mut().retain(|(owner, id), _| owner != plugin || nodes.is_some_and(|n| n.get(id).is_some_and(|n| n.kind == "markdown")));
        let changed: Vec<(u64, Map<String, Value>)> = nodes
            .into_iter()
            .flatten()
            .filter(|(_, n)| n.kind == DIFF_NODE)
            .filter(|(id, n)| self.plugins.diffs.get(&(plugin.to_owned(), **id)).is_none_or(|had| had.source != diff_source(&n.props)))
            .map(|(id, n)| (*id, n.props.clone()))
            .collect();
        for (id, props) in changed {
            let diff = self.plugin_diff(&props);
            self.plugins.diffs.insert((plugin.to_owned(), id), diff);
        }
    }

    /// Parses a diff node's patch, or each of its sections' patches, into the files a diff view draws.
    fn plugin_diff(&self, props: &Map<String, Value>) -> PluginDiff {
        let source = diff_source(props);
        let Some(sections) = props.get("sections").and_then(Value::as_array) else {
            return PluginDiff { source, sections: Vec::new(), state: self.panel.diff_state(parse(prop(props, "patch").unwrap_or(""))) };
        };
        let (mut files, mut firsts, mut headings) = (Vec::new(), Vec::new(), Vec::new());
        for section in sections {
            let text = |name: &str| section.get(name).and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_owned);
            firsts.push(files.len());
            files.extend(parse(section.get("patch").and_then(Value::as_str).unwrap_or("")));
            headings.push(SectionHeading { label: text("label"), title: text("title").unwrap_or_default(), note: text("note") });
        }
        // Review folds a long list of files so it reads as an overview. Headings give a split diff its
        // overview, and its files read in order, so they start open.
        let mut state = DiffState::new(files);
        state.set_mode(self.panel.diff_mode());
        state.set_sections(firsts);
        PluginDiff { source, sections: headings, state }
    }

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

/// Where a plugin's view sits. A card's rows take the spacing of Comet's own cards, such as Subagents, so
/// the stack reads as one. A sidebar's and a panel's take a list's.
#[derive(Clone, Copy, PartialEq)]
pub enum Frame {
    Card,
    Pane,
}

/// A view a plugin drew for a tab. Where it sits gives it its frame.
pub fn view(s: &Comet, view: &DrawnView, project: &str, frame: Frame, k: &Kit) -> El {
    node_view(s, &view.plugin, view.root, project, frame, k)
}

fn children(s: &Comet, plugin: &str, node: &Node, project: &str, frame: Frame, k: &Kit) -> Vec<El> {
    node.children.iter().map(|c| node_view(s, plugin, *c, project, frame, k).key(format!("node-{c}"))).collect()
}

fn node_view(s: &Comet, plugin: &str, id: u64, project: &str, frame: Frame, k: &Kit) -> El {
    let Some(node) = s.plugins.node(plugin, id) else { return el() };
    let props = &node.props;
    let plugin_owned = plugin.to_owned();
    match node.kind.as_str() {
        TEXT_NODE => text(node.text.clone().unwrap_or_default()).font(crate::theme::text(13.0)).color(k.c.text_base).wrap(),
        ROOT_NODE => col().w_full().grow(1.0).min_h(0.0).children(children(s, plugin, node, project, frame, k)),
        "stack" => {
            let row_direction = prop(props, "direction") == Some("row");
            let gap = props.get("gap").and_then(Value::as_f64).unwrap_or(2.0) as f32 * 4.0;
            let base = if row_direction { row().items_center() } else { col() };
            let base = base.min_w(0.0).min_h(0.0).gap(gap).children(children(s, plugin, node, project, frame, k));
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
        "list" => col().w_full().grow(1.0).min_h(0.0).gap(1.0).scroll(ScrollSpec { stick_bottom: false }).children(children(s, plugin, node, project, frame, k)),
        "item" => item_view(s, props, plugin_owned, frame, k),
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
                .on_press(move |s: &mut Comet| s.fire(&plugin_owned, on_click, Vec::new()))
                .build(k)
        }
        "textinput" => input_view(s, plugin, id, props, k),
        DIFF_NODE => diff_view(s, plugin, id, k),
        "messages" => messages_view(props, k),
        "markdown" => {
            // The node keeps the pictures it shows, and lets them go when it leaves.
            let kept = s.plugins.pictures.borrow_mut().entry((plugin.to_owned(), id)).or_default().clone();
            let markdown = crate::reply::outside(prop(props, "text").unwrap_or("")).images(s.images.file_loader(kept));
            col().w_full().grow(1.0).min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(markdown.style(theme::markdown(k, s.account.text_size())).build(k))
        }
        other => text(format!("{other} is not a Comet element.")).font(crate::theme::text(13.0)).color(k.c.text_faint),
    }
}

/// One row of a list. It is selectable when it has `onSelect`, and opens its `href` in the browser when it has one.
fn item_view(s: &Comet, props: &Map<String, Value>, plugin: String, frame: Frame, k: &Kit) -> El {
    let selected = props.get("selected").and_then(Value::as_bool) == Some(true);
    let on_select = handler(props, "onSelect");
    let href = prop(props, "href").map(str::to_owned);
    // An image file draws in place of a catalog icon. A name the catalog lacks draws nothing.
    let image = prop(props, "image").and_then(|path| s.images.file(std::path::Path::new(path)));
    let lead = match image {
        Some(image) => Some(el().size(icons::SIZE, icons::SIZE).pixels_fit(image.pixels(), rune::SurfaceFit::Fit)),
        None => prop(props, "icon").and_then(catalog_icon).map(|found| icon(found, icons::SIZE).color(k.c.text_muted)),
    };
    // A row's quieter lines stay one line each, so a message with line breaks does not make the row tall.
    let line = |name: &str| prop(props, name).map(|t| text(crate::format::one_line(t)).font(crate::theme::text(12.0)).color(k.c.text_faint).truncate());
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
    // A link says it leaves Comet with an arrow after the title.
    let out = href.is_some().then(|| icon(&ic::ARROW_UP_RIGHT, icons::SIZE).color(k.c.text_faint));
    let head = row().w_full().gap(8.0).items_center().child(text(prop(props, "title").unwrap_or("").to_owned()).font(crate::theme::text(13.0)).color(k.c.text_base).truncate().grow(1.0)).children(badge).children(out);
    // The title and its badge on one line, the quieter lines under it, no gap
    // between, rounded to 0.5rem of Comet's 13 pixel root.
    let lines = col().grow(1.0).min_w(0.0).child(head).children(line("subtitle")).children(line("detail"));
    // The icon sits on the title's line, 20 points tall at Comet's 13 point text.
    let lead = lead.map(|lead| el().h(20.0).center().child(lead));
    // A card's row is one of its lines, as in the Subagents card. A list's row is 0.5rem of Comet's 13 pixel root.
    let (gap, px, py, radius, hover) = match frame {
        Frame::Card => (10.0, 8.0, 7.0, 7.0, k.c.bg_base),
        Frame::Pane => (8.0, 10.0, 8.0, 6.5, k.c.hover),
    };
    let item = match frame {
        // The card's content sits 8 points in, so its text lines up with the card's title. A row reaches
        // back out by as much, so its hover fills the card's width, as the Subagents card's rows do. It
        // stretches to that width, since a full width would not take the margins.
        Frame::Card => row().mx(-px),
        Frame::Pane => row().w_full(),
    };
    let item = item
        .gap(gap)
        .items_start()
        .px(px)
        .py(py)
        .radius(radius)
        .fill(if selected { k.c.layer_02 } else { rune::Color::TRANSPARENT })
        .children(lead)
        .child(lines);
    match (href, on_select) {
        (Some(url), _) => item.hover(hover).role("link").on_press_tx(move |s: &mut Comet, tx| {
            if let Err(e) = tx.open_url(&url) {
                s.toasts.show(e.to_string(), true);
            }
            s.fire(&plugin, on_select, Vec::new());
        }),
        (None, Some(_)) => item.hover(hover).role("button").on_press(move |s: &mut Comet| s.fire(&plugin, on_select, Vec::new())),
        (None, None) => item,
    }
}

/// The catalog icon a plugin names, if the catalog has it. `protocol/src/icon-names.ts` lists the names a plugin may use.
fn catalog_icon(name: &str) -> Option<&'static rune::Icon> {
    ic::ALL.iter().copied().find(|found| found.name == name)
}

/// A plugin's text field. What is typed stays here, so typing never waits on the plugin.
fn input_view(s: &Comet, plugin: &str, id: u64, props: &Map<String, Value>, k: &Kit) -> El {
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
        .on_edit(move |s: &mut Comet| &mut s.plugins.inputs.entry(edit_key.clone()).or_insert_with(|| (TextEdit::new(initial.clone()), initial.clone())).0)
        .on_submit(move |s: &mut Comet, _| {
            // Enter submits, or ⌘Enter in a multiline field.
            if !multiline || s.cmd_held() {
                s.sync_plugin_inputs();
                s.fire(&submit_plugin, on_submit, Vec::new());
            }
        });
    let field = if multiline { field } else { field.single_line() };
    col().w_full().min_h(if multiline { 72.0 } else { 0.0 }).px(11.0).py(8.0).radius(8.0).fill(k.c.layer_01).border(1.0, k.c.border_base).child(field)
}

/// A patch, drawn by the diff view Review uses, with Review's file headers less the button that opens a
/// file: a plugin's diff may name files the project does not have, such as a pull request's.
fn diff_view(s: &Comet, plugin: &str, id: u64, k: &Kit) -> El {
    let key = (plugin.to_owned(), id);
    let Some(diff) = s.plugins.diffs.get(&key) else { return el() };
    if diff.state.files().is_empty() {
        return col().w_full().grow(1.0).center().child(text("No changes.").font(crate::theme::text(13.0)).color(k.c.text_faint));
    }
    let (get, get_mut, header_key, section_key) = (key.clone(), key.clone(), key.clone(), key.clone());
    let dark = k.dark;
    let view = DiffView::new(move |s: &Comet| &s.plugins.diffs[&get].state, move |s: &mut Comet| &mut s.plugins.diffs.get_mut(&get_mut).expect("a diff that showed").state)
        .key(format!("plugin-diff-{plugin}-{id}"))
        .section(move |s: &Comet, n: usize| s.plugins.diffs.get(&section_key).and_then(|d| d.sections.get(n)).map_or_else(el, |heading| section_heading(heading, crate::theme::kit(dark))))
        .file_header(move |s: &Comet, f: usize, collapsed: bool| {
            let Some(file) = s.plugins.diffs.get(&header_key).and_then(|d| d.state.files().get(f)) else { return el() };
            let toggle_key = header_key.clone();
            let toggle = move |s: &mut Comet| {
                if let Some(diff) = s.plugins.diffs.get_mut(&toggle_key) {
                    diff.state.set_collapsed(f, !collapsed);
                }
            };
            crate::panel::diff_file_header(crate::theme::kit(dark), file, collapsed, toggle, None)
        })
        .syntax_theme(crate::theme::code_colors(dark))
        .code_font(crate::theme::mono(12.0))
        .build(s, crate::theme::review_kit(dark));
    // The diff view finds its width by its own key, so it sits in a wrapper that takes the node's key.
    col().w_full().grow(1.0).min_h(0.0).child(view)
}

/// A section's heading above its files: its label, quiet, then its title and its note.
fn section_heading(heading: &SectionHeading, k: &Kit) -> El {
    let label = heading.label.clone().map(|t| text(t).font(crate::theme::text(12.0)).color(k.c.text_faint).wrap());
    let title = text(heading.title.clone()).font(crate::theme::medium(14.0)).color(k.c.text_base).wrap();
    let note = heading.note.clone().map(|t| text(t).font(crate::theme::text(13.0)).color(k.c.text_muted).wrap());
    col().w_full().px(12.0).pt(20.0).pb(10.0).gap(2.0).children(label).child(title).children(note.map(|n| n.mt(4.0)))
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
        let bubble = el().shrink().min_w(0.0).radius(10.0).fill(fill).px(12.0).py(8.0).child(crate::reply::outside(&words).style(theme::markdown(k, 13.0)).build(k).shrink().min_w(0.0));
        // `max-w-[90%]`: a spacer keeps a tenth of the row, so the bubble wraps within the rest of the panel.
        let room = el().w_frac(0.1);
        let line = if incoming { row().w_full().child(bubble).child(room) } else { row().w_full().justify_end().child(room).child(bubble) };
        column.child(text(meta).font(crate::theme::text(12.0)).color(k.c.text_faint)).child(line)
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

    #[test]
    fn a_diff_node_parses_its_patch_again_only_when_it_changes_and_leaves_with_its_node() {
        let mut s = Comet::default();
        let patch = |line: &str| format!("diff --git a/a.rb b/a.rb\n--- a/a.rb\n+++ b/a.rb\n@@ -1 +1 @@\n-old\n+{line}\n");
        let first = patch("new");
        s.take_plugin_ops("p", &ops(serde_json::json!([
            { "op": "create", "id": 1, "type": "root" },
            { "op": "create", "id": 2, "type": "diff" },
            { "op": "set", "id": 2, "key": "patch", "value": first },
            { "op": "insert", "parent": 1, "id": 2 }
        ])), false);
        let key = ("p".to_owned(), 2);
        assert_eq!(s.plugins.diffs[&key].state.files().len(), 1);
        s.plugins.diffs.get_mut(&key).unwrap().state.set_collapsed(0, true);

        // Operations that leave the patch alone keep the state, folds included.
        s.take_plugin_ops("p", &ops(serde_json::json!([{ "op": "create", "id": 3, "type": "text" }, { "op": "insert", "parent": 1, "id": 3 }])), false);
        assert!(s.plugins.diffs[&key].state.collapsed(0));

        s.take_plugin_ops("p", &ops(serde_json::json!([{ "op": "set", "id": 2, "key": "patch", "value": patch("newer") }])), false);
        assert!(!s.plugins.diffs[&key].state.collapsed(0), "a new patch parses again");

        s.take_plugin_ops("p", &ops(serde_json::json!([{ "op": "remove", "parent": 1, "id": 2 }])), false);
        assert!(s.plugins.diffs.is_empty());
    }

    #[test]
    fn a_diff_node_with_sections_parses_each_and_heads_its_first_file() {
        let mut s = Comet::default();
        let patch = |file: &str| format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n@@ -1 +1 @@\n-old\n+new\n");
        let sections = serde_json::json!([
            { "label": "Runtime · 1 of 2", "title": "Count attempts", "note": "A limiter counts them.", "patch": format!("{}{}", patch("a.ts"), patch("b.ts")) },
            { "title": "Test the limiter", "patch": patch("a.test.ts") }
        ]);
        s.take_plugin_ops("p", &ops(serde_json::json!([
            { "op": "create", "id": 1, "type": "root" },
            { "op": "create", "id": 2, "type": "diff" },
            { "op": "set", "id": 2, "key": "sections", "value": sections },
            { "op": "insert", "parent": 1, "id": 2 }
        ])), false);
        let key = ("p".to_owned(), 2);
        let diff = &s.plugins.diffs[&key];
        assert_eq!(diff.state.files().iter().map(|f| f.path()).collect::<Vec<_>>(), ["a.ts", "b.ts", "a.test.ts"]);
        assert_eq!(diff.sections.iter().map(|h| (h.label.as_deref(), h.title.as_str(), h.note.as_deref())).collect::<Vec<_>>(), [
            (Some("Runtime · 1 of 2"), "Count attempts", Some("A limiter counts them.")),
            (None, "Test the limiter", None),
        ]);
        // The diff view's rows are its own, so the test reads them by name.
        let headings: Vec<usize> = diff.state.rows.iter().filter(|r| format!("{r:?}").starts_with("Section")).map(|r| r.file()).collect();
        assert_eq!(headings, [0, 2]);

        // New sections parse again.
        s.take_plugin_ops("p", &ops(serde_json::json!([{ "op": "set", "id": 2, "key": "sections", "value": [{ "title": "All", "patch": patch("c.ts") }] }])), false);
        assert_eq!(s.plugins.diffs[&key].state.files().len(), 1);
    }

    #[test]
    fn a_markdown_node_lets_its_pictures_go_when_it_leaves() {
        let mut s = Comet::default();
        s.take_plugin_ops("p", &ops(serde_json::json!([
            { "op": "create", "id": 1, "type": "root" },
            { "op": "create", "id": 2, "type": "markdown" },
            { "op": "insert", "parent": 1, "id": 2 }
        ])), false);
        s.plugins.pictures.borrow_mut().entry(("p".to_owned(), 2)).or_default();
        s.take_plugin_ops("p", &ops(serde_json::json!([{ "op": "set", "id": 2, "key": "text", "value": "![a](/tmp/a.png)" }])), false);
        assert_eq!(s.plugins.pictures.borrow().len(), 1, "a node that stays keeps its pictures");
        s.take_plugin_ops("p", &ops(serde_json::json!([{ "op": "remove", "parent": 1, "id": 2 }])), false);
        assert!(s.plugins.pictures.borrow().is_empty());
    }
}
