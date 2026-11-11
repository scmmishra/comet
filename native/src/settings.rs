//! Desk's settings, after OpenCode's settings screen: a sidebar of
//! pages, and the chosen page beside it, on a card over the session. Back, or Escape, returns to it.

use crate::agents::{mark, state_label, status_line};
use crate::format;
use crate::models::{effort_label, permission, permission_for, permission_modes};
use crate::protocol::{AgentDefaults, AgentInfo, AgentState, AgentVersion, ClientMessage, ProjectSettings, ThemeChoice};
use crate::shell::Desk;
use rune::{El, Key, KeyEvent, ScrollSpec, TextEdit, col, el, icon, row, text};
use rune_kit::{Badge, BadgeVariant, ButtonVariant, Kit, Select, Switch, TextInput};
use rune_theme_opencode::icons as ic;
use serde_json::json;

/// The pages, in the sidebar's order: id, title and icon.
pub const PAGES: [(&str, &str, &rune::Icon); 5] = [
    ("providers", "Providers", &ic::PROVIDERS),
    ("appearance", "Appearance", &ic::APPEARANCE),
    ("projects", "Projects", &ic::FOLDER),
    ("mcps", "MCP servers", &ic::MCP),
    ("skills", "Skills", &ic::POST_SKILL),
];
/// The thread text sizes Appearance offers, Desk's `FONT_SIZES`.
const FONT_SIZES: std::ops::RangeInclusive<u32> = 11..=20;
/// The colours a project's letter can take, Desk's `PROJECT_COLORS`.
const PROJECT_COLORS: [&str; 9] = ["orange", "yellow", "cyan", "green", "red", "pink", "blue", "purple", "gray"];

/// The select that is open, and text settings being typed, by field. The workspace keeps the page on show.
#[derive(Default)]
pub struct SettingsUi {
    open_select: Option<String>,
    /// The agent Providers shows. None shows the default agent.
    agent: Option<String>,
    /// The project whose icon picker is open.
    icon_picker: Option<String>,
    fields: std::collections::HashMap<String, TextEdit>,
}

impl Desk {
    /// Shows a settings page over the session, reading what it shows.
    pub fn open_settings(&mut self, page: &str) {
        // Settings opened afresh drop what was typed and never saved.
        if self.workspace.settings_page.is_none() {
            self.settings = SettingsUi::default();
        }
        self.workspace.settings_page = Some(page.to_owned());
        self.settings.open_select = None;
        match page {
            // The agents are read again, so one installed or signed in outside Desk shows.
            "providers" => self.core.send(&ClientMessage::AgentsGet),
            "mcps" | "skills" => {
                if let Some(project) = self.workspace.active_tab().map(|t| t.project.clone()) {
                    self.core.send(&ClientMessage::ProjectGet { project, part: if page == "mcps" { "mcp" } else { "skills" }.into() });
                }
            }
            _ => {}
        }
    }

    /// Shows an agent on Providers, as its tab does.
    pub fn show_settings_agent(&mut self, agent: &str) {
        self.settings.agent = Some(agent.to_owned());
        self.settings.open_select = None;
    }

    /// Closes the icon picker, as Escape does. Whether it was open.
    pub fn close_icon_picker(&mut self) -> bool {
        self.settings.icon_picker.take().is_some()
    }

    /// Returns to the tab.
    pub fn close_settings(&mut self) {
        self.workspace.settings_page = None;
        self.settings = SettingsUi::default();
    }

    pub fn set_theme(&self, theme: &str) {
        self.update_settings(json!({ "appearance": { "theme": theme } }));
    }

    fn update_settings(&self, change: serde_json::Value) {
        self.core.send(&ClientMessage::SettingsUpdate { change });
    }

    fn project_settings(&self, dir: &str) -> ProjectSettings {
        self.account.settings.as_ref().and_then(|s| s.projects.get(dir).cloned()).unwrap_or_default()
    }

    fn save_project(&self, dir: &str, change: impl FnOnce(&mut ProjectSettings)) {
        let mut settings = self.project_settings(dir);
        change(&mut settings);
        self.update_settings(json!({ "project": { "dir": dir, "settings": settings } }));
    }

    fn toggle_select(&mut self, key: &str) {
        self.settings.open_select = if self.settings.open_select.as_deref() == Some(key) { None } else { Some(key.to_owned()) };
    }
}

/// The settings screen, filling the main card.
pub fn screen(s: &Desk, k: &Kit, layer: &mut Vec<El>) -> El {
    let page = s.workspace.settings_page.as_deref().unwrap_or("providers");
    let back = row()
        .key("settings-back")
        .gap(6.0)
        .items_center()
        .h(28.0)
        .px(6.0)
        .mb(20.0)
        .radius(4.0)
        .hover(k.c.hover)
        .role("button")
        .on_press(|s: &mut Desk| s.close_settings())
        .child(icon(&ic::OUTLINE_ARROW_LEFT, 15.0).color(k.c.text_muted))
        .child(text("Back to app").font(crate::theme::text(13.0)).color(k.c.text_muted));
    let nav = PAGES.iter().map(|(id, title, mark)| {
        let selected = *id == page;
        let id = *id;
        row()
            .key(format!("settings-{id}"))
            .w_full()
            .h(28.0)
            .gap(6.0)
            .items_center()
            .px(6.0)
            .radius(4.0)
            .fill(if selected { k.c.layer_03 } else { rune::Color::TRANSPARENT })
            .hover(k.c.hover)
            .role("tab")
            .on_press_tx(move |s: &mut Desk, tx| {
                s.open_settings(id);
                // The new page shows whole, with no fade or slide of its parts.
                tx.instant();
            })
            .child(icon(mark, 15.0).color(if selected { k.c.text_base } else { k.c.text_muted }))
            .child(text(*title).font(crate::theme::text(13.0)).color(if selected { k.c.text_base } else { k.c.text_muted }))
    });
    // `.settings-nav`: Back, 20 points and a 16 point gap, then the pages 2 points apart.
    let sidebar = col().w(280.0).h_full().pt(40.0).pl(24.0).pr(40.0).gap(16.0).child(back).child(col().w_full().gap(2.0).children(nav.collect::<Vec<_>>()));
    let content = match page {
        "appearance" => appearance(s, k, layer),
        "projects" => projects(s, k, layer),
        "mcps" => mcps(s, k),
        "skills" => skills(s, k),
        _ => providers(s, k, layer),
    };
    // `.settings-panel` keeps 4 points each side for the lists' shadows. Each page is its own element:
    // unkeyed, Rune would morph one page's parts into the next page's.
    let content = col().key(format!("settings-page-{page}")).grow(1.0).min_w(0.0).max_w(crate::thread_view::COLUMN).h_full().scroll(ScrollSpec { stick_bottom: false }).px(4.0).child(content);
    row()
        .key("settings")
        .w_full()
        .h_full()
        .justify_center()
        .focusable(true)
        .on_key(|s: &mut Desk, event: &KeyEvent, _| {
            if event.key == Key::Escape {
                s.close_settings();
                return true;
            }
            false
        })
        .child(row().w_full().max_w(1048.0).h_full().child(sidebar).child(content))
}

fn header(k: &Kit, title: &str, description: &str) -> El {
    col()
        .w_full()
        .gap(4.0)
        .pt(40.0)
        .px(40.0)
        .child(text(title.to_owned()).font(rune::TextStyle::new(15.0, 640.0).lh(22.5)).color(k.c.text_base))
        .child(text(description.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_muted).wrap())
}

fn body(children: Vec<El>) -> El {
    col().w_full().gap(32.0).px(40.0).pt(24.0).pb(80.0).children(children)
}

fn section(k: &Kit, title: String, child: El) -> El {
    section_with(text(title).font(crate::theme::medium(13.0)).color(k.c.text_base), child)
}

/// A section under a heading of the caller's making, such as a project's mark, name and folder.
fn section_with(heading: El, child: El) -> El {
    col().w_full().gap(12.0).child(heading).child(child)
}

/// Rows on one raised surface, after OpenCode's SettingsList.
fn list(k: &Kit, rows: Vec<El>) -> El {
    let count = rows.len();
    // The list's outline takes no room. A row's bottom border takes half a point in Desk's design, which
    // Rune's does not, so the row's padding adds it.
    col().w_full().radius(8.0).fill(k.c.layer_01).border(0.5, k.c.border_muted).px(20.0).children(rows.into_iter().enumerate().map(|(i, r)| {
        if i + 1 < count { r.pb(18.5).border_sides([0.0, 0.0, 0.5, 0.0], k.c.border_base) } else { r }
    }))
}

/// One setting: its name and what it does on the left, its control on the right.
fn setting(k: &Kit, title: El, description: Option<String>, control: Option<El>) -> El {
    row()
        .w_full()
        .gap(16.0)
        .items_center()
        .py(18.0)
        .child(col().grow(1.0).min_w(0.0).gap(6.0).child(title).children(description.map(|d| text(d).font(crate::theme::text(13.0).lh(20.0)).color(k.c.text_muted).wrap())))
        .children(control)
}

fn title(k: &Kit, words: &str) -> El {
    text(words.to_owned()).font(crate::theme::medium(13.0)).color(k.c.text_base)
}

/// A text setting that saves on Enter, so typing does not save each letter. `key` names its draft.
fn field(s: &Desk, k: &Kit, key: String, saved: String, placeholder: &str, label: &str, save: impl Fn(&mut Desk, String) + 'static) -> El {
    let edit = s.settings.fields.get(&key).cloned().unwrap_or_else(|| TextEdit::new(saved.clone()));
    let draft = key.clone();
    TextInput::new(&edit)
        .placeholder(placeholder)
        .label(label)
        .width(Some(220.0))
        .spellcheck(false)
        .on_edit(move |s: &mut Desk| s.settings.fields.entry(draft.clone()).or_insert_with(|| TextEdit::new(saved.clone())))
        .on_submit(move |s: &mut Desk, _| {
            let typed = s.settings.fields.get(&key).map(|e| e.text.trim().to_owned()).unwrap_or_default();
            save(s, typed);
        })
        .build(k)
}

/// A select of `options`, as `(value, label)`, that saves through `pick`.
fn select(s: &Desk, k: &Kit, layer: &mut Vec<El>, key: &str, options: &[(String, String)], current: &str, pick: impl Fn(&mut Desk, &str) + Clone + 'static) -> El {
    let labels: Vec<&str> = options.iter().map(|o| o.1.as_str()).collect();
    let values: Vec<(String, String)> = options.to_vec();
    let current_label = options.iter().find(|o| o.0 == current).map(|o| o.1.as_str());
    let toggle_key = key.to_owned();
    Select::new(key.to_owned(), &labels)
        .current(current_label)
        .open(s.settings.open_select.as_deref() == Some(key))
        .placement(rune_kit::Placement::BottomEnd)
        .on_toggle(move |s: &mut Desk| s.toggle_select(&toggle_key))
        .on_close(|s: &mut Desk| s.settings.open_select = None)
        .on_choose(move |s: &mut Desk, label: &str, _| {
            s.settings.open_select = None;
            if let Some((value, _)) = values.iter().find(|o| o.1 == label) {
                pick(s, value);
            }
        })
        .build(k, layer)
}

/// Providers: what a new tab starts with, then one section per agent Desk runs.
fn providers(s: &Desk, k: &Kit, layer: &mut Vec<El>) -> El {
    let mut sections = Vec::new();
    if let Some(settings) = &s.account.settings {
        sections.push(section(k, "New tabs".into(), new_tabs(s, &settings.threads, k, layer)));
    }
    if s.account.agents.is_empty() {
        sections.push(text("Reading the agents…").font(crate::theme::text(13.0)).color(k.c.text_faint));
    }
    // One agent shows at a time, so the page stays short however many agents Desk runs.
    if let Some(agent) = s.settings.agent.as_deref().and_then(|id| s.account.agent(id)).or_else(|| s.account.agent(s.account.default_agent())).or(s.account.agents.first()) {
        // An agent that is not ready says so in its first row, beside the button that gets it ready.
        let heading = agent_action(agent, k).is_none().then(|| agent_heading(agent, k));
        sections.push(section_with(agent_tabs(s, &agent.id, k), col().w_full().gap(12.0).children(heading).child(agent_settings(s, agent, k, layer))));
    }
    col().w_full().child(header(k, "Providers", "The coding agents Desk runs, and what a new tab starts with.")).child(body(sections))
}

/// What every new tab starts with, whichever agent it runs.
fn new_tabs(s: &Desk, threads: &crate::protocol::ThreadSettings, k: &Kit, layer: &mut Vec<El>) -> El {
    let agents: Vec<(String, String)> = s.account.agents.iter().map(|a| (a.id.clone(), a.name.clone())).collect();
    let follow = [("steer".to_owned(), "Steer".to_owned()), ("queue".to_owned(), "Queue".to_owned())];
    list(k, vec![
        setting(
            k,
            title(k, "Default agent"),
            Some("The agent a new tab starts on. A tab can change it in the model picker until its first message.".into()),
            Some(select(s, k, layer, "default-agent", &agents, &threads.agent, |s: &mut Desk, value: &str| s.update_settings(json!({ "threads": { "agent": value } })))),
        ),
        setting(
            k,
            title(k, "Follow-ups"),
            Some("What Enter does while the agent works: steer the running turn, or queue the message for when it ends. ⌘Enter does the other, for one message. An agent that cannot be steered always queues.".into()),
            Some(select(s, k, layer, "follow-ups", &follow, &threads.follow_up, |s: &mut Desk, value: &str| s.update_settings(json!({ "threads": { "followUp": value } })))),
        ),
    ])
}

/// The agents as tabs: each one's mark and name, with a dot on one that is not ready.
fn agent_tabs(s: &Desk, shown: &str, k: &Kit) -> El {
    let tabs = s.account.agents.iter().map(|agent| {
        let on = agent.id == shown;
        let id = agent.id.clone();
        let dot = (agent.state != AgentState::Ready).then(|| el().size(6.0, 6.0).radius(3.0).fill(if agent.state == AgentState::Checking { k.c.text_faint } else { k.c.warning.fg }));
        row()
            .key(format!("settings-agent-{}", agent.id))
            .h(32.0)
            .gap(8.0)
            .items_center()
            .px(10.0)
            .radius(6.0)
            .fill(if on { k.c.layer_03 } else { rune::Color::TRANSPARENT })
            .hover(k.c.hover)
            .role("tab")
            .checked(on)
            .label(format!("{}, {}", agent.name, state_label(agent.state)))
            .on_press_tx(move |s: &mut Desk, tx| {
                s.show_settings_agent(&id);
                // The agent's rows show whole, with no morph from the rows of the agent before.
                tx.instant();
            })
            .child(mark(&agent.id, 15.0, k))
            .child(text(agent.name.clone()).font(crate::theme::medium(13.0)).color(if on { k.c.text_base } else { k.c.text_muted }))
            .children(dot)
    });
    row().w_full().gap(4.0).role("tablist").label("Agents").children(tabs)
}

/// What the agent on show runs on: who is signed in, and where it stands.
fn agent_heading(agent: &AgentInfo, k: &Kit) -> El {
    let badge = Badge::new(state_label(agent.state)).variant(if agent.state == AgentState::Ready { BadgeVariant::Accent } else { BadgeVariant::Neutral }).build(k);
    row().key(format!("agent-heading-{}", agent.id)).w_full().gap(8.0).items_center().child(text(status_line(agent)).font(crate::theme::text(13.0)).color(k.c.text_muted).truncate().grow(1.0).min_w(0.0)).child(badge)
}

/// An agent's rows: its account, its version, what a new tab starts it with, and its plan usage. An agent
/// that is not ready shows only what stands in the way, with the button that clears it.
fn agent_settings(s: &Desk, agent: &AgentInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let mut rows = Vec::new();
    // An agent that is not ready leads with the button that gets it ready.
    if let Some(action) = agent_action(agent, k) {
        rows.push(setting(k, title(k, &crate::agents::state_sentence(agent)), agent.problem.clone(), Some(action)));
    }
    if let Some(version) = agent.version.as_ref().filter(|v| v.installed.is_some()) {
        rows.push(setting(k, title(k, "Version"), Some(version_line(agent, version)), update_button(agent, version, k)));
    }
    if let Some(defaults) = s.account.defaults(&agent.id).filter(|_| !agent.models.is_empty()) {
        rows.extend(default_rows(s, agent, defaults, k, layer));
    }
    if agent.features.iter().any(|f| f == "compact-idle") {
        let compact = s.account.settings.as_ref().is_some_and(|x| x.threads.compact_idle);
        rows.push(setting(
            k,
            title(k, "Compact idle threads"),
            Some(format!("When you return to a large thread that sat idle, {} compacts it first, so its next reply reads a summary, not the whole history.", agent.name)),
            Some(Switch::new(compact).web().label("Compact idle threads").hide_label().on_toggle(move |s: &mut Desk| s.update_settings(json!({ "threads": { "compactIdle": !compact } }))).build(k)),
        ));
    }
    if let Some(usage) = &agent.usage {
        let plan = agent.account.as_ref().and_then(|a| a.plan.as_deref()).map_or_else(|| "Plan usage".to_owned(), |p| format!("{} plan", crate::agents::capitalized(p)));
        rows.push(setting(k, title(k, &plan), Some(format!("Your plan's usage limits, as {} reports them.", agent.name)), Some(usage_windows(usage, k))));
    }
    if rows.is_empty() {
        return text(agent.problem.clone().unwrap_or_else(|| "Nothing to set yet.".to_owned())).key(format!("agent-rows-{}", agent.id)).font(crate::theme::text(13.0)).color(k.c.text_faint).wrap();
    }
    list(k, rows).key(format!("agent-rows-{}", agent.id))
}

/// The button that gets an agent ready: its install, or its sign-in. None when Desk can do neither, or nothing is needed.
fn agent_action(agent: &AgentInfo, k: &Kit) -> Option<El> {
    let id = agent.id.clone();
    let can = |feature: &str| agent.features.iter().any(|f| f == feature);
    match agent.state {
        AgentState::Missing if can("install") => Some(crate::theme::small_button("Install").variant(ButtonVariant::Contrast).on_press(move |s: &mut Desk| s.core.send(&ClientMessage::AgentInstall { agent: id.clone() })).build(k)),
        AgentState::SignedOut if can("sign-in") => Some(crate::theme::small_button("Sign in").variant(ButtonVariant::Contrast).on_press(move |s: &mut Desk| s.core.send(&ClientMessage::AgentSignIn { agent: id.clone() })).build(k)),
        AgentState::Installing => Some(crate::theme::small_button("Installing…").disabled(true).build(k)),
        AgentState::SigningIn => Some(crate::theme::small_button("Signing in…").disabled(true).build(k)),
        _ => None,
    }
}

fn version_line(agent: &AgentInfo, version: &AgentVersion) -> String {
    let installed = version.installed.as_deref().unwrap_or_default();
    if version.update_available {
        let how = if version.updatable { "" } else { " Update it the way you installed it." };
        return format!("{} {installed}. {} is out.{how}", agent.name, version.latest.as_deref().unwrap_or("A newer version"));
    }
    format!("{} {installed}{}.", agent.name, if version.latest.is_some() { ", the newest" } else { "" })
}

fn update_button(agent: &AgentInfo, version: &AgentVersion, k: &Kit) -> Option<El> {
    let updating = agent.state == AgentState::Updating;
    let id = agent.id.clone();
    (updating || (version.update_available && version.updatable)).then(|| {
        crate::theme::small_button(if updating { "Updating…" } else { "Update" }).variant(ButtonVariant::Contrast).disabled(updating).on_press(move |s: &mut Desk| s.core.send(&ClientMessage::AgentUpdate { agent: id.clone() })).build(k)
    })
}

/// What a new tab starts an agent with: its model, that model's effort, and its permission mode.
fn default_rows(s: &Desk, agent: &AgentInfo, defaults: &AgentDefaults, k: &Kit, layer: &mut Vec<El>) -> Vec<El> {
    let model = s.account.model(&agent.id, &defaults.model);
    let save = |id: &str| {
        let id = id.to_owned();
        move |s: &mut Desk, change: serde_json::Value| s.update_settings(json!({ "agent": { "id": id, "defaults": change } }))
    };
    let models: Vec<(String, String)> = agent.models.iter().map(|m| (m.value.clone(), m.label.clone())).collect();
    let (id, save_model) = (agent.id.clone(), save(&agent.id));
    let mut rows = vec![setting(
        k,
        title(k, "Default model"),
        Some(format!("The model a new {} tab starts on. A tab can change it in the model picker.", agent.name)),
        Some(select(s, k, layer, &format!("default-model-{}", agent.id), &models, &defaults.model, move |s: &mut Desk, value: &str| {
            // The effort stays only if the new model takes it.
            let effort = s.account.model(&id, value).and_then(|m| crate::models::effort_for(m, s.account.defaults(&id)?.effort.as_deref()));
            save_model(s, json!({ "model": value, "effort": effort }));
        })),
    )];
    if let Some(option) = model.filter(|m| !m.efforts.is_empty()) {
        let default = format!("Default{}", option.default_effort.as_deref().map(|e| format!(" ({})", effort_label(e))).unwrap_or_default());
        let efforts: Vec<(String, String)> = std::iter::once(("default".to_owned(), default)).chain(option.efforts.iter().map(|e| (e.clone(), effort_label(e).to_owned()))).collect();
        let save_effort = save(&agent.id);
        rows.push(setting(
            k,
            title(k, "Default effort"),
            Some("How long the model thinks before it answers, on the default model.".into()),
            Some(select(s, k, layer, &format!("default-effort-{}", agent.id), &efforts, defaults.effort.as_deref().unwrap_or("default"), move |s: &mut Desk, value: &str| {
                save_effort(s, json!({ "effort": if value == "default" { None } else { Some(value) } }));
            })),
        ));
    }
    let modes: Vec<(String, String)> = permission_modes(model).map(|m| (m.to_owned(), permission(m).0.to_owned())).collect();
    let save_mode = save(&agent.id);
    rows.push(setting(
        k,
        title(k, "Default permissions"),
        Some(format!("How {} handles tool calls in a new tab. A tab can change it in the model picker.", agent.name)),
        Some(select(s, k, layer, &format!("default-permissions-{}", agent.id), &modes, &permission_for(model, &defaults.permission_mode), move |s: &mut Desk, value: &str| save_mode(s, json!({ "permissionMode": value })))),
    ));
    rows
}

/// A plan's usage windows, each with how full it is.
fn usage_windows(usage: &crate::protocol::PlanUsage, k: &Kit) -> El {
    col().w(260.0).gap(12.0).children(usage.windows.iter().map(|w| {
        col()
            .w_full()
            .gap(5.0)
            .child(row().w_full().child(text(w.label.clone()).font(crate::theme::text(13.0)).color(k.c.text_base).grow(1.0)).child(text(format!("{}%", w.percent.round())).font(crate::theme::text(13.0)).color(k.c.text_muted)))
            .child(rune_kit::Progress::new(Some(w.percent as f32 / 100.0)).build(k))
    }))
}

fn appearance(s: &Desk, k: &Kit, layer: &mut Vec<El>) -> El {
    let Some(settings) = &s.account.settings else { return col() };
    let themes: Vec<(String, String)> = ThemeChoice::ALL.iter().map(|t| (t.id().to_owned(), t.label().to_owned())).collect();
    let theme = settings.appearance.theme.id();
    let sizes: Vec<(String, String)> = FONT_SIZES.map(|n| (n.to_string(), format!("{n}px"))).collect();
    let rows = vec![
        setting(
            k,
            title(k, "Theme"),
            Some("System follows macOS's light or dark setting.".into()),
            Some(select(s, k, layer, "theme", &themes, theme, |s: &mut Desk, value: &str| s.set_theme(value))),
        ),
        setting(
            k,
            title(k, "Font size"),
            Some("The size of thread text. Code blocks and the message box follow it.".into()),
            Some(select(s, k, layer, "font-size", &sizes, &(settings.appearance.font_size as u32).to_string(), |s: &mut Desk, value: &str| {
                if let Ok(size) = value.parse::<u32>() {
                    s.update_settings(json!({ "appearance": { "fontSize": size } }));
                }
            })),
        ),
        setting(
            k,
            title(k, "Interface font"),
            Some("The font for everything but code. Leave it empty for Geist. Enter saves it.".into()),
            Some(field(s, k, "uiFont".into(), settings.appearance.ui_font.clone(), "Geist", "Interface font", |s, typed| s.update_settings(json!({ "appearance": { "uiFont": typed } })))),
        ),
        setting(
            k,
            title(k, "Code font"),
            Some("The font for code, diffs and terminals. Leave it empty for Geist Mono. Enter saves it.".into()),
            Some(field(s, k, "codeFont".into(), settings.appearance.code_font.clone(), "Geist Mono", "Code font", |s, typed| s.update_settings(json!({ "appearance": { "codeFont": typed } })))),
        ),
    ];
    col().w_full().child(header(k, "Appearance", "How Desk looks. Changes apply at once.")).child(body(vec![list(k, rows)]))
}

fn projects(s: &Desk, k: &Kit, layer: &mut Vec<El>) -> El {
    let mut dirs: Vec<String> = Vec::new();
    for tab in &s.workspace.tabs {
        if !dirs.contains(&tab.project) {
            dirs.push(tab.project.clone());
        }
    }
    let sections = dirs.iter().map(|dir| {
        let settings = s.project_settings(dir);
        let save_dir = dir.clone();
        let name = field(s, k, format!("name:{dir}"), settings.name.clone().unwrap_or_default(), format::project_name(dir), "Project name", move |s, typed| {
            s.save_project(&save_dir, |p| p.name = (!typed.is_empty()).then_some(typed));
        });
        // Each colour as the project's letter would draw in it, outlined in the accent when chosen.
        let initial = s.account.project_label(dir).chars().next().unwrap_or(' ').to_uppercase().to_string();
        let swatches = row().gap(6.0).role("radiogroup").label("Project color").children(PROJECT_COLORS.iter().map(|color| {
            let picked = settings.color.as_deref() == Some(*color);
            let dir = dir.clone();
            let swatch = row()
                .key(format!("color-{color}"))
                .padding(2.0)
                .radius(6.0)
                .role("radio")
                .checked(picked)
                .label(*color)
                .help(format!("{}{}", color[..1].to_uppercase(), &color[1..]))
                .on_press(move |s: &mut Desk| s.save_project(&dir, |p| p.color = Some(color.to_string())))
                .child(crate::shell::avatar(&initial, color, 24.0, k));
            if picked { swatch.border(2.0, k.c.text_accent) } else { swatch }
        }));
        let heading = row()
            .w_full()
            .gap(8.0)
            .items_center()
            .child(crate::shell::project_mark(s, dir, k))
            .child(text(s.account.project_label(dir)).font(crate::theme::medium(13.0)).color(k.c.text_base))
            .child(text(format::short_path(dir)).font(crate::theme::text(13.0)).color(k.c.text_faint).truncate().min_w(0.0));
        section_with(
            heading,
            list(k, vec![
                setting(k, title(k, "Name"), Some("Leave it empty to use the folder's name. Enter saves it.".into()), Some(name)),
                setting(k, title(k, "Color"), Some("The colour of the project's letter, when it has no icon.".into()), Some(swatches)),
                setting(k, title(k, "Icon"), Some("An image from the project, such as its logo or favicon.".into()), Some(icon_picker(s, dir, settings.icon.as_deref(), k, layer))),
            ]),
        )
    });
    col().w_full().child(header(k, "Projects", "How each project open in a tab shows in tabs and menus.")).child(body(sections.collect()))
}

/// The project's logo-like images to choose its icon from. It asks the
/// core for them each time it opens, so new files show.
fn icon_picker(s: &Desk, dir: &str, current: Option<&str>, k: &Kit, layer: &mut Vec<El>) -> El {
    let key = format!("icon-picker-{dir}");
    let open = s.settings.icon_picker.as_deref() == Some(dir);
    let toggle_dir = dir.to_owned();
    let words = if current.is_some() { "Change" } else { "Choose" };
    let mark = crate::shell::project_mark(s, dir, k);
    let trigger = crate::theme::button(words)
        .variant(ButtonVariant::Outline)
        .label_with(move |font, ink| row().gap(8.0).items_center().child(mark).child(text(words).font(font).color(ink)))
        .expanded(open)
        .on_press(move |s: &mut Desk| {
            let opening = s.settings.icon_picker.as_deref() != Some(toggle_dir.as_str());
            s.settings.icon_picker = opening.then(|| toggle_dir.clone());
            if opening {
                s.core.send(&ClientMessage::ProjectGet { project: toggle_dir.clone(), part: "icons".into() });
            }
        })
        .build(k);
    let trigger = row().key(key.clone()).child(trigger);
    if !open {
        return trigger;
    }
    let faint = |words: &str| text(words.to_owned()).font(crate::theme::text(13.0)).color(k.c.text_faint).wrap().px(4.0).py(8.0);
    let pick = |icon: Option<String>| {
        let dir = dir.to_owned();
        move |s: &mut Desk| {
            let icon = icon.clone();
            s.save_project(&dir, |p| p.icon = icon);
            s.settings.icon_picker = None;
        }
    };
    let found = s.projects.get(dir).and_then(|p| p.icons.as_ref());
    let content = match found {
        None => faint("Looking for images…"),
        Some(files) if files.is_empty() => faint("No logo, icon or favicon images in this project."),
        Some(files) => {
            let tiles: Vec<El> = files
                .iter()
                .map(|file| {
                    let image = s.images.file(&std::path::Path::new(dir).join(file));
                    let tile = row()
                        .key(format!("icon-{file}"))
                        .size(44.0, 44.0)
                        .center()
                        .radius(7.0)
                        .fill(k.c.layer_02)
                        .hover(k.c.hover)
                        .role("button")
                        .label(file.clone())
                        .help(file.clone())
                        .on_press(pick(Some(file.clone())))
                        .children(image.map(|image| el().size(28.0, 28.0).pixels_fit(image.pixels(), rune::SurfaceFit::Fit)));
                    if current == Some(file.as_str()) { tile.border(2.0, k.c.text_accent) } else { tile }
                })
                .collect();
            // Six to a row.
            let mut rows = Vec::new();
            let mut tiles = tiles.into_iter().peekable();
            while tiles.peek().is_some() {
                rows.push(row().gap(6.0).children(tiles.by_ref().take(6).collect::<Vec<_>>()));
            }
            col().gap(6.0).max_h(300.0).scroll(ScrollSpec { stick_bottom: false }).children(rows)
        }
    };
    let none = current.map(|_| crate::theme::button("No icon").variant(ButtonVariant::Ghost).on_press(pick(None)).build(k));
    let body = col().w(340.0).padding(12.0).gap(8.0).items_start().child(content).children(none);
    layer.insert(0, rune_kit::scrim("icon-picker-scrim", |s: &mut Desk| s.settings.icon_picker = None));
    layer.push(rune_kit::popover::anchored(k, crate::ui::popover(k, body), &key, rune_kit::Placement::BottomEnd, 6.0));
    trigger
}

fn mcps(s: &Desk, k: &Kit) -> El {
    let project = s.workspace.active_tab().map(|t| t.project.clone());
    let servers = project.as_ref().and_then(|p| s.projects.get(p)).and_then(|p| p.mcp.clone());
    let faint = |words: &str| text(words.to_owned()).font(crate::theme::text(13.0)).color(k.c.text_faint).wrap();
    let content = match (project, servers) {
        (None, _) => vec![faint("Open a tab in a project to see its servers.")],
        (Some(_), None) => vec![faint("Starting the servers to read them…")],
        (Some(_), Some(None)) => vec![faint("Desk could not ask Claude Code for its MCP servers.")],
        (Some(project), Some(Some(servers))) => {
            let row_for = |server: &crate::protocol::McpServer| {
                let enabled = server.status != "disabled";
                let (dir, name) = (project.clone(), server.name.clone());
                let status = match server.status.as_str() {
                    "connected" => format!("Connected · {}", format::plural(server.tools as usize, "tool")),
                    "failed" => format!("Failed{}", server.error.as_ref().map(|e| format!(": {e}")).unwrap_or_default()),
                    "needs-auth" => "Needs sign-in".into(),
                    "pending" => "Connecting…".into(),
                    _ => "Off in this project".into(),
                };
                let description = [Some(status), server.target.clone()].into_iter().flatten().collect::<Vec<_>>().join(" · ");
                setting(k, title(k, &server.name), Some(description), Some(Switch::new(enabled).web().label(format!("Use {}", server.name)).hide_label().on_toggle(move |s: &mut Desk| s.core.send(&ClientMessage::McpToggle { project: dir.clone(), name: name.clone(), enabled: !enabled })).build(k)))
            };
            let own: Vec<El> = servers.iter().filter(|x| x.own_project).map(row_for).collect();
            let shared: Vec<El> = servers.iter().filter(|x| !x.own_project).map(row_for).collect();
            let name = s.account.project_label(&project);
            vec![
                section(k, format!("Installed in {name}"), if own.is_empty() { faint("No MCP servers are installed in this project. Add one to its .mcp.json, or with claude mcp add.") } else { list(k, own) }),
                section(k, "Available in every project".into(), if shared.is_empty() { faint("No MCP servers are available to all projects.") } else { list(k, shared) }),
            ]
        }
    };
    col()
        .w_full()
        .child(header(k, "MCP servers", "The servers Claude Code loads. A project's switches act in that project only."))
        .child(body(content))
}

fn skills(s: &Desk, k: &Kit) -> El {
    let project = s.workspace.active_tab().map(|t| t.project.clone());
    let skills = project.as_ref().and_then(|p| s.projects.get(p)).and_then(|p| p.skills.clone());
    let faint = |words: &str| text(words.to_owned()).font(crate::theme::text(13.0)).color(k.c.text_faint).wrap();
    let content = match skills {
        None => vec![faint("Reading skills…")],
        Some(skills) => {
            let rows: Vec<El> = skills
                .iter()
                .filter(|x| !x.builtin)
                .map(|skill| setting(k, text(format!("/{}", skill.name)).font(crate::theme::mono(12.0)).color(k.c.text_base), Some(skill.description.clone()), None))
                .collect();
            if rows.is_empty() { vec![faint("No skills are available.")] } else { vec![list(k, rows)] }
        }
    };
    col().w_full().child(header(k, "Skills", "The skills and commands Claude Code offers. Type / in a thread to use one.")).child(body(content))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::Event;
    use crate::protocol::CoreMessage;

    fn desk() -> Desk {
        let mut s = Desk::default();
        let messages = serde_json::json!([
            { "type": "settings", "settings": { "appearance": { "theme": "dark", "fontSize": 14 }, "threads": { "agent": "claude", "followUp": "steer" }, "agents": { "claude": { "model": "default", "effort": null, "permissionMode": "auto" } }, "projects": { "/code/web": { "color": "blue", "icon": "web.png" } } } },
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "Fix login", "project": "/code/web", "terminals": [], "agent": "claude", "model": "default", "permissionMode": "auto" }] }
        ]);
        for m in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(m)).unwrap();
        }
        let _ = s.core.sent();
        s
    }

    #[test]
    fn opening_a_page_reads_what_it_shows_and_showing_a_tab_closes_settings() {
        let mut s = desk();
        s.open_settings("mcps");
        assert!(s.core.sent().iter().any(|m| m["type"] == "project.get" && m["part"] == "mcp"));
        s.workspace.show_tab("t", &s.core);
        assert_eq!(s.workspace.settings_page, None);
    }

    #[test]
    fn a_project_shows_its_saved_name_and_fonts_fall_back_to_geist() {
        let mut s = desk();
        assert_eq!(s.account.project_label("/code/web"), "web");
        assert_eq!(s.account.project_color("/code/web"), Some("blue"));
        assert_eq!(s.account.font_families(), ("Geist".to_owned(), "Geist Mono".to_owned()));
        let settings = s.account.settings.as_mut().unwrap();
        settings.projects.get_mut("/code/web").unwrap().name = Some("Web".into());
        settings.appearance.ui_font = "Inter".into();
        assert_eq!(s.account.project_label("/code/web"), "Web");
        assert_eq!(s.account.font_families().0, "Inter, Geist");
    }

    #[test]
    fn a_project_change_keeps_the_settings_it_does_not_touch() {
        let s = desk();
        s.save_project("/code/web", |p| p.name = Some("Web".into()));
        let sent = s.core.sent();
        let change = sent.iter().find(|m| m["type"] == "settings.update").expect("a settings update");
        assert_eq!(change["change"], json!({ "project": { "dir": "/code/web", "settings": { "name": "Web", "color": "blue", "icon": "web.png" } } }));
    }
}
