//! Desk's settings, after OpenCode's settings screen as `app/src/renderer/settings` draws it: a sidebar of
//! pages, and the chosen page beside it, in place of the session. Back, or Escape, returns to it.

use crate::format;
use crate::models::{effort_label, permission, permission_for, permission_modes};
use crate::protocol::{ClientMessage, ProjectSettings, ThemeChoice};
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
    fields: std::collections::HashMap<String, TextEdit>,
}

impl Desk {
    /// Shows a settings page in place of the session, reading what it shows.
    pub fn open_settings(&mut self, page: &str) {
        // Settings opened afresh drop what was typed and never saved.
        if self.workspace.settings_page.is_none() {
            self.settings = SettingsUi::default();
        }
        self.workspace.settings_page = Some(page.to_owned());
        self.settings.open_select = None;
        match page {
            "providers" => self.core.send(&ClientMessage::ClaudeVersionGet),
            "mcps" | "skills" => {
                if let Some(project) = self.workspace.active_tab().map(|t| t.project.clone()) {
                    self.core.send(&ClientMessage::ProjectGet { project, part: if page == "mcps" { "mcp" } else { "skills" }.into() });
                }
            }
            _ => {}
        }
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
            .on_press(move |s: &mut Desk| s.open_settings(id))
            .child(icon(mark, 15.0).color(if selected { k.c.text_base } else { k.c.text_muted }))
            .child(text(*title).font(crate::theme::text(13.0)).color(if selected { k.c.text_base } else { k.c.text_muted }))
    });
    let sidebar = col().w(280.0).h_full().pt(40.0).pl(24.0).pr(40.0).gap(2.0).child(back).children(nav.collect::<Vec<_>>());
    let content = match page {
        "appearance" => appearance(s, k, layer),
        "projects" => projects(s, k, layer),
        "mcps" => mcps(s, k),
        "skills" => skills(s, k),
        _ => providers(s, k, layer),
    };
    let content = col().grow(1.0).min_w(0.0).max_w(crate::thread_view::COLUMN).h_full().scroll(ScrollSpec { stick_bottom: false }).child(content);
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
        .child(text(title.to_owned()).font(rune::TextStyle { size: 15.0, weight: 640.0, ..crate::theme::text(13.0) }).color(k.c.text_base))
        .child(text(description.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_muted).wrap())
}

fn body(children: Vec<El>) -> El {
    col().w_full().gap(32.0).px(40.0).pt(24.0).pb(80.0).children(children)
}

fn section(k: &Kit, title: String, child: El) -> El {
    col().w_full().gap(12.0).child(text(title).font(crate::theme::medium(13.0)).color(k.c.text_base)).child(child)
}

/// Rows on one raised surface, after OpenCode's SettingsList.
fn list(k: &Kit, rows: Vec<El>) -> El {
    let count = rows.len();
    col().w_full().radius(8.0).fill(k.c.layer_01).border(0.5, k.c.border_muted).px(20.5).py(0.5).children(rows.into_iter().enumerate().map(|(i, r)| {
        if i + 1 < count { r.border_sides([0.0, 0.0, 0.5, 0.0], k.c.border_base) } else { r }
    }))
}

/// One setting: its name and what it does on the left, its control on the right.
fn setting(k: &Kit, title: El, description: Option<String>, control: Option<El>) -> El {
    row()
        .w_full()
        .gap(16.0)
        .items_center()
        .py(18.0)
        .child(col().grow(1.0).min_w(0.0).gap(6.0).child(title).children(description.map(|d| text(d).font(crate::theme::text(13.0)).color(k.c.text_muted).wrap())))
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

fn providers(s: &Desk, k: &Kit, layer: &mut Vec<El>) -> El {
    let account = &s.account;
    let claude = account.settings.as_ref().map(|x| &x.claude);
    let model = claude.and_then(|c| account.model(&c.model));
    let line = match &account.user {
        None => "Checking the account…".to_owned(),
        Some(None) => "Not signed in. Run claude in a terminal to sign in.".to_owned(),
        Some(Some(user)) => match &user.email {
            Some(email) => format!("Signed in as {email}{}", user.organization.as_ref().map(|o| format!(" · {o}")).unwrap_or_default()),
            None => match &user.api_key_source {
                Some(source) => format!("Signed in with an API key from {source}."),
                None => format!("Signed in through {}.", user.api_provider.as_deref().unwrap_or("another provider")),
            },
        },
    };
    let connected = account.user.as_ref().map(|u| {
        Badge::new(if u.is_some() { "Connected" } else { "Not signed in" }).variant(if u.is_some() { BadgeVariant::Accent } else { BadgeVariant::Neutral }).build(k)
    });
    let claude_title = row().gap(8.0).items_center().child(icon(&crate::icons::CLAUDE, 16.0).color(crate::theme::claude())).child(title(k, "Claude Code"));
    let version = match &account.claude_code {
        None => "Checking the version…".to_owned(),
        Some(v) => match &v.installed {
            None => "Desk found no Claude Code on your PATH.".to_owned(),
            Some(installed) if v.update_available => format!("Claude Code {installed}. {} is out.{}", v.latest.as_deref().unwrap_or("A newer version"), if v.updatable { "" } else { " Update it the way you installed it." }),
            Some(installed) => format!("Claude Code {installed}{}.", if v.latest.is_some() { ", the newest" } else { "" }),
        },
    };
    let update = account.claude_code.as_ref().filter(|v| v.update_available && v.updatable).map(|_| {
        crate::theme::small_button(if account.updating { "Updating…" } else { "Update" })
            .variant(ButtonVariant::Contrast)
            .disabled(account.updating)
            .on_press(|s: &mut Desk| {
                s.account.updating = true;
                s.core.send(&ClientMessage::ClaudeUpdate);
            })
            .build(k)
    });
    let mut rows = vec![setting(k, claude_title, Some(line), connected), setting(k, title(k, "Version"), Some(version), update)];
    if let Some(claude) = claude {
        let models: Vec<(String, String)> = account.models.iter().map(|m| (m.value.clone(), m.label.clone())).collect();
        rows.push(setting(
            k,
            title(k, "Default model"),
            Some("The model a new tab starts on. A tab can change it in the model picker.".into()),
            Some(select(s, k, layer, "default-model", &models, &claude.model, |s: &mut Desk, value: &str| {
                let effort = s.account.model(value).and_then(|m| crate::models::effort_for(m, s.account.settings.as_ref()?.claude.effort.as_deref()));
                s.update_settings(json!({ "claude": { "model": value, "effort": effort } }));
            })),
        ));
        if let Some(option) = model.filter(|m| !m.efforts.is_empty()) {
            let default = format!("Default{}", option.default_effort.as_deref().map(|e| format!(" ({})", effort_label(e))).unwrap_or_default());
            let efforts: Vec<(String, String)> = std::iter::once(("default".to_owned(), default)).chain(option.efforts.iter().map(|e| (e.clone(), effort_label(e).to_owned()))).collect();
            rows.push(setting(
                k,
                title(k, "Default effort"),
                Some("How long Claude thinks before it answers, on the default model.".into()),
                Some(select(s, k, layer, "default-effort", &efforts, claude.effort.as_deref().unwrap_or("default"), |s: &mut Desk, value: &str| {
                    s.update_settings(json!({ "claude": { "effort": if value == "default" { None } else { Some(value) } } }));
                })),
            ));
        }
        let modes: Vec<(String, String)> = permission_modes(model).map(|m| (m.to_owned(), permission(m).0.to_owned())).collect();
        rows.push(setting(
            k,
            title(k, "Default permissions"),
            Some("How a new tab's Claude handles tool calls. A tab can change it in the model picker. Auto needs a model that supports it.".into()),
            Some(select(s, k, layer, "default-permissions", &modes, &permission_for(model, &claude.permission_mode), |s: &mut Desk, value: &str| {
                s.update_settings(json!({ "claude": { "permissionMode": value } }));
            })),
        ));
        let follow = [("steer".to_owned(), "Steer".to_owned()), ("queue".to_owned(), "Queue".to_owned())];
        rows.push(setting(
            k,
            title(k, "Follow-ups"),
            Some("What Enter does while Claude works: steer the running turn, or queue the message for when it ends. ⌘Enter does the other, for one message.".into()),
            Some(select(s, k, layer, "follow-ups", &follow, &claude.follow_up, |s: &mut Desk, value: &str| s.update_settings(json!({ "claude": { "followUp": value } })))),
        ));
        let compact = account.settings.as_ref().is_some_and(|x| x.claude.compact_idle);
        rows.push(setting(
            k,
            title(k, "Compact idle threads"),
            Some("When you return to a large thread that sat idle, Claude Code compacts it first, so its next reply reads a summary, not the whole history.".into()),
            Some(Switch::new(compact).label("Compact idle threads").hide_label().on_toggle(move |s: &mut Desk| s.update_settings(json!({ "claude": { "compactIdle": !compact } }))).build(k)),
        ));
    }
    let mut sections = vec![section(k, "Claude Code".into(), list(k, rows))];
    if let Some(usage) = &account.usage {
        let plan = account.user.as_ref().and_then(|u| u.as_ref()?.plan.clone()).map_or_else(|| "Plan".to_owned(), |p| format!("Claude {}{}", p[..1].to_uppercase(), &p[1..]));
        let windows = col().w(260.0).gap(12.0).children(usage.windows.iter().map(|w| {
            col()
                .w_full()
                .gap(5.0)
                .child(row().w_full().child(text(w.label.clone()).font(crate::theme::text(13.0)).color(k.c.text_base).grow(1.0)).child(text(format!("{}%", w.percent.round())).font(crate::theme::text(13.0)).color(k.c.text_muted)))
                .child(rune_kit::Progress::new(Some(w.percent as f32 / 100.0)).build(k))
        }));
        sections.push(section(k, "Subscription".into(), list(k, vec![setting(k, title(k, &plan), Some("Your plan's usage limits, as Claude Code reports them.".into()), Some(windows))])));
    }
    col().w_full().child(header(k, "Providers", "The coding agents Desk runs, and what a new tab starts with.")).child(body(sections))
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

fn projects(s: &Desk, k: &Kit, _layer: &mut Vec<El>) -> El {
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
        let swatches = row().gap(6.0).children(PROJECT_COLORS.iter().map(|color| {
            let picked = settings.color.as_deref() == Some(*color);
            let dir = dir.clone();
            let fill = rune_theme_opencode::theme(k.dark).color(&format!("v2-avatar-bg-{color}"));
            el().key(format!("color-{color}"))
                .size(20.0, 20.0)
                .radius(5.0)
                .fill(fill)
                .border(if picked { 2.0 } else { 0.5 }, if picked { k.c.text_base } else { k.c.border_base })
                .role("radio")
                .checked(picked)
                .label(*color)
                .on_press(move |s: &mut Desk| s.save_project(&dir, |p| p.color = Some(color.to_string())))
        }));
        let heading = format!("{} · {}", s.account.project_label(dir), format::short_path(dir));
        section(
            k,
            heading,
            list(k, vec![
                setting(k, title(k, "Name"), Some("Leave it empty to use the folder's name. Enter saves it.".into()), Some(name)),
                setting(k, title(k, "Color"), Some("The colour of the project's letter, when it has no icon.".into()), Some(swatches)),
            ]),
        )
    });
    col().w_full().child(header(k, "Projects", "How each project open in a tab shows in tabs and menus.")).child(body(sections.collect()))
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
                setting(k, title(k, &server.name), Some(description), Some(Switch::new(enabled).label(format!("Use {}", server.name)).hide_label().on_toggle(move |s: &mut Desk| s.core.send(&ClientMessage::McpToggle { project: dir.clone(), name: name.clone(), enabled: !enabled })).build(k)))
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
            { "type": "settings", "settings": { "appearance": { "theme": "dark", "fontSize": 14 }, "claude": { "model": "default", "effort": null, "permissionMode": "auto", "followUp": "steer" }, "projects": { "/code/web": { "color": "blue", "icon": "web.png" } } } },
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "Fix login", "project": "/code/web", "terminals": [], "model": "default", "permissionMode": "auto" }] }
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
