//! The composer's model button. Its popover has a rail of the agents Comet runs, the chosen agent's models
//! beside it, and the model's effort on the right, with speed and the permission mode under them. The
//! button shows the agent's mark and names the model that runs, so "Default" reads as "Opus 5.5".
//!
//! A thread keeps the agent it started on. Until its first message a tab can move to any agent. After
//! it, the other agents still show their models, with a button that opens a new tab on that agent.

use crate::agents::{self, mark, state_label};
use crate::icons;
use crate::models::{self, effort_label, option_label, permission, permission_for, permission_modes};
use crate::protocol::{AgentInfo, AgentState, ModelOption, TabInfo};
use crate::shell::Comet;
use crate::theme;
use crate::workspace::Place;
use rune::{El, col, el, icon, row, text};
use rune_kit::{ButtonVariant, Keybind, KeybindVariant, Kit, Menu, MenuItem, Placement, popover};
use rune_theme_opencode::icons as ic;

/// The popover's width, its agent rail and its effort column.
const WIDTH: f32 = 580.0;
const RAIL_WIDTH: f32 = 52.0;
const EFFORT_WIDTH: f32 = 168.0;
/// Short enough to open above the composer of a new tab, which sits mid-window. Longer lists scroll.
const HEIGHT: f32 = 340.0;
const ROW_HEIGHT: f32 = 36.0;
/// A rail button and the mark inside it.
const RAIL_BUTTON: f32 = 36.0;
const RAIL_MARK: f32 = 18.0;
/// How faint an agent that is not ready draws.
const NOT_READY: f32 = 0.45;

/// Whether the picker is open, the agent whose models it shows, whether older models show, and whether
/// its permission menu is open.
#[derive(Default)]
pub struct Picker {
    open: bool,
    /// The agent on show in the rail. None shows the tab's own.
    viewing: Option<String>,
    show_older: bool,
    modes_open: bool,
}

impl Comet {
    fn model_option(&self, tab: &TabInfo) -> Option<&ModelOption> {
        self.account.model(&tab.agent, &tab.model)
    }

    /// Whether a tab's thread has started, which fixes its agent.
    fn started(&self, tab: &str) -> bool {
        self.threads.get(tab).is_some_and(|t| t.session_id.is_some())
    }

    /// The agent whose models the picker shows for a tab.
    fn viewed_agent<'a>(&'a self, tab: &'a TabInfo) -> &'a str {
        self.picker.viewing.as_deref().unwrap_or(&tab.agent)
    }

    /// Puts a tab on a model. A model of another agent moves the tab to that agent first, which only a
    /// tab whose thread has not started can do. What the new model does not take falls back: its default
    /// effort, standard speed, Supervised.
    fn pick_model(&mut self, tab: &str, agent: &str, value: &str) {
        let Some(option) = self.account.model(agent, value).cloned() else { return };
        let moving = self.tab_agent(tab) != agent;
        if moving && self.started(tab) {
            return;
        }
        if moving {
            self.workspace.set_agent(tab, agent, &self.account, &self.core);
        }
        self.workspace.change_tab(
            tab,
            |t| {
                t.effort = models::effort_for(&option, t.effort.as_deref());
                t.fast = t.fast.filter(|_| option.fast);
                t.permission_mode = permission_for(Some(&option), &t.permission_mode);
                t.model = option.value.clone();
            },
            &self.core,
        );
    }

    /// Whether ⌘1 to ⌘9 pick models, not tabs: while the picker is open.
    pub fn digits_pick_models(&self) -> bool {
        self.picker.open
    }

    /// ⌘1 to ⌘9, the tab shortcuts, pick one of the models on show while the picker is open. Whether the picker took the shortcut.
    pub fn pick_model_by_number(&mut self, index: usize) -> bool {
        if !self.digits_pick_models() {
            return false;
        }
        let Some(tab) = self.workspace.active_tab().cloned() else { return false };
        let agent = self.viewed_agent(&tab).to_owned();
        let Some(value) = self.account.agent(&agent).and_then(|a| a.models.iter().filter(|o| !o.older).nth(index)).map(|o| o.value.clone()) else { return false };
        self.pick_model(&tab.id, &agent, &value);
        true
    }

    /// Opens a tab beside the active one, in its project, on another agent.
    fn new_tab_on(&mut self, agent: &str) {
        let project = self.workspace.active_tab().map(|t| t.project.clone());
        if let Ok(tab) = self.workspace.new_tab(Place::Next, project, &self.account, &self.core) {
            self.workspace.set_agent(&tab, agent, &self.account, &self.core);
        }
        self.picker = Picker::default();
    }

    /// Shows an agent's models in the open picker, as its mark in the rail does.
    pub fn view_agent(&mut self, agent: &str) {
        self.picker.viewing = Some(agent.to_owned());
        self.picker.show_older = false;
    }

    pub fn toggle_picker(&mut self) {
        let opening = !self.picker.open;
        // An older model shows only in the full list, so a tab on one opens the list that way.
        let older = self.workspace.active_tab().and_then(|t| self.model_option(t)).is_some_and(|o| o.older);
        self.picker = Picker { open: opening, viewing: None, show_older: opening && older, modes_open: false };
    }
}

pub fn model_picker(s: &Comet, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let selected = s.model_option(tab);
    let ran = s.threads.get(&tab.id).and_then(|t| t.model.clone());
    let name = selected.map(|o| option_label(o).to_owned()).or(ran).unwrap_or_else(|| s.agent_name(&tab.agent).to_owned());
    let effort = tab.effort.clone().or_else(|| selected.and_then(|o| o.default_effort.clone()));
    let faint = |words: String| text(words).font(crate::theme::text(13.0)).color(k.c.text_faint);
    let trigger = row()
        .key("model-picker")
        .h(32.0)
        .gap(8.0)
        .items_center()
        .px(8.0)
        .radius(8.0)
        .hover(k.c.hover)
        .fill(if s.picker.open { k.c.hover } else { rune::Color::TRANSPARENT })
        .role("button")
        .label(format!("{} model", s.agent_name(&tab.agent)))
        .expanded(s.picker.open)
        .on_press(|s: &mut Comet| s.toggle_picker())
        .child(agent_mark(&tab.agent, tab.fast == Some(true), k))
        .child(text(name).font(crate::theme::text(13.0)).color(k.c.text_base))
        .children(effort.map(|e| faint(effort_label(&e).to_owned())))
        // Supervised is the plain case. Any other mode shows, so a thread never runs looser than you think.
        .children((tab.permission_mode != "default").then(|| row().gap(8.0).child(faint("·".into())).child(faint(permission(&tab.permission_mode).0.to_owned()))))
        .child(icon(&ic::CHEVRON_DOWN, crate::icons::SIZE).color(k.c.text_faint));
    if !s.picker.open {
        return trigger;
    }
    // rune-kit's Popover caps its width at 320, `@opencode/ui`'s default. Comet widens this one, so it
    // builds the surface from the same parts.
    let mut menus = Vec::new();
    let body = popover_body(s, tab, selected, k, &mut menus).role("dialog").label("Agent, model and effort");
    let picker = crate::ui::popover(k, body).modal(true, |s: &mut Comet| s.picker = Picker::default());
    layer.push(popover::anchored(k, picker, "model-picker", Placement::TopEnd, 8.0));
    layer.extend(menus);
    trigger
}

/// An agent's mark, with a bolt in fast mode.
fn agent_mark(agent: &str, fast: bool, k: &Kit) -> El {
    let bolt = fast.then(|| icon(&icons::BOLT_FILLED, 13.0).color(theme::fast(k.dark)).absolute(10.0, 5.0));
    el().size(16.0, 16.0).child(mark(agent, 16.0, k)).children(bolt)
}

fn popover_body(s: &Comet, tab: &TabInfo, selected: Option<&ModelOption>, k: &Kit, layer: &mut Vec<El>) -> El {
    let viewed = s.viewed_agent(tab);
    // The effort belongs to the tab's model, so it shows only beside the tab's own agent.
    let own = viewed == tab.agent;
    let columns = row().w_full().grow(1.0).min_h(0.0).child(rail(s, tab, viewed, k)).child(model_column(s, tab, viewed, k)).child(effort_column(tab, selected.filter(|_| own), own, k));

    // Fast mode is only offered on a model that has it.
    let speed = selected.filter(|o| o.fast).map(|_| {
        let id = tab.id.clone();
        crate::ui::segmented(
            k,
            "Speed",
            &[crate::ui::Segment { icon: None, words: Some("Standard"), name: "Standard" }, crate::ui::Segment { icon: Some(&icons::BOLT), words: Some("Fast"), name: "Fast" }],
            usize::from(tab.fast == Some(true)),
            move |s: &mut Comet, i| {
                let id = id.clone();
                s.workspace.change_tab(&id, |t| t.fast = Some(i == 1), &s.core);
            },
        )
    });
    let footer = row()
        .w_full()
        .items_center()
        .padding(6.0)
        .pt(7.0)
        .border_sides([1.0, 0.0, 0.0, 0.0], k.c.border_muted)
        .child(speed.unwrap_or_else(el))
        .child(row().grow(1.0))
        .child(permission_menu(s, tab, selected, k, layer));
    col().w(WIDTH).h(HEIGHT).child(columns).child(footer)
}

/// The agents, one mark each. The agent on show is raised, and one that is not ready draws faint with a
/// dot, so its state reads before it is picked.
fn rail(s: &Comet, tab: &TabInfo, viewed: &str, k: &Kit) -> El {
    let button = |id: &str, name: &str, state: AgentState| {
        let on = id == viewed;
        let ready = state == AgentState::Ready;
        let pick = id.to_owned();
        let dot = (!ready).then(|| el().absolute(RAIL_BUTTON - 11.0, RAIL_BUTTON - 11.0).size(6.0, 6.0).radius(3.0).fill(if state == AgentState::Checking { k.c.text_faint } else { k.c.warning.fg }));
        row()
            .key(format!("agent-{id}"))
            .size(RAIL_BUTTON, RAIL_BUTTON)
            .center()
            .radius(8.0)
            .fill(if on { k.c.layer_03 } else { rune::Color::TRANSPARENT })
            .hover(k.c.hover)
            .role("tab")
            .checked(on)
            .label(name.to_owned())
            .help(if ready { name.to_owned() } else { format!("{name} · {}", state_label(state)) })
            .help_side(rune::Side::Right)
            .on_press(move |s: &mut Comet| s.view_agent(&pick))
            .child(mark(id, RAIL_MARK, k).opacity(if ready || on { 1.0 } else { NOT_READY }))
            .children(dot)
    };
    // Before the core has sent the agents, the tab's own stands in, so the rail is never empty.
    let buttons: Vec<El> = if s.account.agents.is_empty() {
        vec![button(&tab.agent, agents::fallback_name(&tab.agent), AgentState::Checking)]
    } else {
        s.account.agents.iter().map(|a| button(&a.id, &a.name, a.state)).collect()
    };
    let settings = row()
        .key("agent-settings")
        .size(RAIL_BUTTON, RAIL_BUTTON)
        .center()
        .radius(8.0)
        .hover(k.c.hover)
        .role("button")
        .label("Provider settings")
        .help("Provider settings")
        .help_side(rune::Side::Right)
        .on_press(|s: &mut Comet| {
            s.picker = Picker::default();
            s.open_settings("providers");
        })
        .child(icon(&ic::SETTINGS_GEAR, icons::SIZE).color(k.c.text_faint));
    col()
        .w(RAIL_WIDTH)
        .h_full()
        .items_center()
        .py(8.0)
        .gap(4.0)
        .border_sides([0.0, 1.0, 0.0, 0.0], k.c.border_muted)
        .role("tablist")
        .label("Agents")
        .children(buttons)
        .child(col().grow(1.0))
        .child(settings)
}

fn heading(k: &Kit, words: String, aside: Option<String>) -> El {
    let faint = |w: String| text(w).font(crate::theme::text(12.0)).color(k.c.text_faint);
    row().w_full().h(36.0).items_center().px(14.0).pt(6.0).gap(8.0).child(faint(words).grow(1.0)).children(aside.map(|a| faint(a).truncate()))
}

/// The models of the agent on show, or what stands between Comet and them.
fn model_column(s: &Comet, tab: &TabInfo, viewed: &str, k: &Kit) -> El {
    let agent = s.account.agent(viewed);
    let name = s.agent_name(viewed).to_owned();
    let plan = agent.and_then(|a| a.account.as_ref()?.plan.as_deref()).map(|p| format!("{} plan", agents::capitalized(p)));
    let content = match agent {
        Some(agent) if agent.state == AgentState::Ready || !agent.models.is_empty() => model_list(s, tab, agent, k),
        Some(agent) => not_ready(agent, k),
        None => col().w_full().padding(6.0).child(row().px(10.0).py(8.0).child(text("Loading models…").font(crate::theme::text(13.0)).color(k.c.text_faint))),
    };
    col().grow(1.0).min_w(0.0).h_full().child(heading(k, name, plan)).child(content)
}

fn model_list(s: &Comet, tab: &TabInfo, agent: &AgentInfo, k: &Kit) -> El {
    // A thread keeps the agent it started on, so another agent's models open a new tab instead.
    let locked = agent.id != tab.agent && s.started(&tab.id);
    let recent: Vec<&ModelOption> = agent.models.iter().filter(|o| !o.older).collect();
    let shown: Vec<&ModelOption> = if s.picker.show_older { agent.models.iter().collect() } else { recent.clone() };
    let check = || icon(&ic::CHECK, 15.0).color(k.c.text_base);
    let rows = shown.iter().map(|option| {
        let picked = agent.id == tab.agent && option.value == tab.model;
        let shortcut = recent.iter().position(|a| a.value == option.value).filter(|_| !locked).and_then(crate::workspace::tab_number).map(|n| n.to_string());
        let (id, on, value) = (tab.id.clone(), agent.id.clone(), option.value.clone());
        let ink = if locked { k.c.text_faint } else { k.c.text_base };
        let line = row()
            .key(format!("model-{}-{}", agent.id, option.value))
            .h(ROW_HEIGHT)
            .w_full()
            .gap(10.0)
            .items_center()
            .px(10.0)
            .radius(7.0)
            .role("button")
            .disabled(locked)
            .child(text(option.label.clone()).font(crate::theme::text(13.0)).color(ink))
            .child(text(option.runs.as_ref().map_or_else(|| option.description.clone(), |runs| format!("{runs} · {}", option.description))).font(crate::theme::text(12.0)).color(k.c.text_faint).truncate().grow(1.0))
            .children(picked.then(check))
            .children(shortcut.map(|n| Keybind::new(&["⌘", n.as_str()]).variant(KeybindVariant::Ghost).build(k)));
        if locked { line } else { line.hover(k.c.hover).on_press(move |s: &mut Comet| s.pick_model(&id, &on, &value)) }
    });
    let older = (!s.picker.show_older && agent.models.len() > recent.len()).then(|| {
        row().key("show-older").h(ROW_HEIGHT).items_center().px(10.0).radius(7.0).hover(k.c.hover).role("button").on_press(|s: &mut Comet| s.picker.show_older = true).child(text("Show older models").font(crate::theme::text(13.0)).color(k.c.text_faint))
    });
    let loading = agent.models.is_empty().then(|| row().px(10.0).py(8.0).child(text("Loading models…").font(crate::theme::text(13.0)).color(k.c.text_faint)));
    let list = col().w_full().gap(1.0).padding(6.0).children(loading).children(rows).children(older);
    col()
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .children(locked.then(|| other_agent_notice(s, tab, agent, k)))
        .child(col().w_full().shrink().min_h(0.0).scroll(rune::ScrollSpec { stick_bottom: false }).child(list))
}

/// Says why another agent's models cannot be picked in a started thread, and opens a new tab on that agent.
fn other_agent_notice(s: &Comet, tab: &TabInfo, agent: &AgentInfo, k: &Kit) -> El {
    let on = agent.id.clone();
    let words = format!("This thread runs on {}. A thread keeps the agent it started on.", s.agent_name(&tab.agent));
    col()
        .w_full()
        .px(6.0)
        .pt(2.0)
        .child(
            col()
                .w_full()
                .gap(10.0)
                .padding(10.0)
                .radius(7.0)
                .fill(k.c.layer_01)
                .child(text(words).font(crate::theme::text(12.0).lh(18.0)).color(k.c.text_muted).wrap())
                .child(row().child(crate::theme::small_button(format!("New tab on {}", agent.name)).variant(ButtonVariant::Outline).on_press(move |s: &mut Comet| s.new_tab_on(&on)).build(k))),
        )
}

/// An agent with no models to show yet: where it stands, what to do, and the button that does it.
fn not_ready(agent: &AgentInfo, k: &Kit) -> El {
    let actions = agents::setup_actions(agent, format!("Install {}", agent.name), k);
    col()
        .w_full()
        .grow(1.0)
        .center()
        .gap(12.0)
        .px(28.0)
        .child(mark(&agent.id, 28.0, k).opacity(NOT_READY))
        .child(text(agents::state_sentence(agent)).font(crate::theme::medium(13.0)).color(k.c.text_base))
        .children(agents::setup_hint(agent).map(|hint| text(hint).font(crate::theme::text(12.0).lh(18.0)).color(k.c.text_muted).wrap().align(rune::Align::Center)))
        .children((!actions.is_empty()).then(|| row().gap(8.0).children(actions)))
}

/// The effort levels of the tab's model. Another agent's models have none to set until one is picked.
fn effort_column(tab: &TabInfo, selected: Option<&ModelOption>, own: bool, k: &Kit) -> El {
    let note = |words: &str| col().px(14.0).py(8.0).child(text(words.to_owned()).font(crate::theme::text(12.0).lh(18.0)).color(k.c.text_faint).wrap());
    let check = || icon(&ic::CHECK, 15.0).color(k.c.text_base);
    let efforts = match selected.filter(|o| !o.efforts.is_empty()) {
        None if !own => note("Pick a model to set its effort."),
        None => note("This model has no effort levels."),
        Some(option) => col().w_full().gap(1.0).padding(6.0).children(std::iter::once(None).chain(option.efforts.iter().map(Some)).map(|effort| {
            let picked = effort.cloned() == tab.effort;
            let words = effort.map_or("Default", |e| effort_label(e)).to_owned();
            let default = effort.is_none().then(|| option.default_effort.as_deref().map(effort_label)).flatten();
            let (id, value) = (tab.id.clone(), effort.cloned());
            row()
                .key(format!("effort-{}", effort.map_or("default", |e| e.as_str())))
                .h(ROW_HEIGHT)
                .w_full()
                .items_center()
                .px(10.0)
                .radius(7.0)
                .hover(k.c.hover)
                .role("button")
                .on_press(move |s: &mut Comet| {
                    let value = value.clone();
                    s.workspace.change_tab(&id, |t| t.effort = value, &s.core);
                })
                .child(row().grow(1.0).gap(6.0).child(text(words).font(crate::theme::text(13.0)).color(if picked { k.c.text_base } else { k.c.text_muted })).children(default.map(|d| text(d.to_owned()).font(crate::theme::text(13.0)).color(k.c.text_faint))))
                .children(picked.then(check))
        })),
    };
    // The borders take a point of room in CSS, which Rune's do not.
    col()
        .w(EFFORT_WIDTH)
        .h_full()
        .pl(1.0)
        .border_sides([0.0, 0.0, 0.0, 1.0], k.c.border_muted)
        .child(heading(k, "Effort".into(), selected.map(|o| option_label(o).to_owned())))
        .child(col().w_full().shrink().min_h(0.0).scroll(rune::ScrollSpec { stick_bottom: false }).child(efforts))
}

/// The permission mode: a menu that opens above its button, over the model list.
fn permission_menu(s: &Comet, tab: &TabInfo, selected: Option<&ModelOption>, k: &Kit, layer: &mut Vec<El>) -> El {
    let (label, _, mark) = permission(&tab.permission_mode);
    let trigger = row()
        .key("permission-trigger")
        .h(32.0)
        .gap(8.0)
        .items_center()
        .px(10.0)
        .radius(8.0)
        .hover(k.c.hover)
        .role("button")
        .on_press(|s: &mut Comet| s.picker.modes_open = !s.picker.modes_open)
        .child(icon(mark, 15.0).color(k.c.text_muted))
        .child(text(label).font(crate::theme::text(13.0)).color(k.c.text_muted))
        .child(icon(&ic::CHEVRON_DOWN, crate::icons::SIZE).color(k.c.text_faint));
    let mut menu = Menu::new("permission-menu").trigger(trigger).open(s.picker.modes_open).placement(Placement::TopEnd).min_width(320.0).on_close(|s: &mut Comet| s.picker.modes_open = false);
    for mode in permission_modes(selected) {
        let (label, description, mark) = permission(mode);
        let id = tab.id.clone();
        menu = menu.item(MenuItem::new(label).icon(mark).description(description).checked(mode == tab.permission_mode).on_select(move |s: &mut Comet| {
            s.workspace.change_tab(&id, |t| t.permission_mode = mode.to_owned(), &s.core);
            s.picker.modes_open = false;
        }));
    }
    menu.build(k, layer)
}

#[cfg(test)]
mod tests {
    use crate::core::Event;
    use crate::protocol::CoreMessage;
    use crate::shell::Comet;

    /// A window with one Claude tab, and Claude and Codex both ready. Codex's defaults name a model and an effort.
    fn comet() -> Comet {
        let mut s = Comet::default();
        let model = |value: &str, older: bool| serde_json::json!({ "value": value, "label": value, "description": "", "efforts": ["low", "high"], "fast": value == "default", "permissionModes": ["default", "acceptEdits", "bypassPermissions"], "older": older });
        let messages = serde_json::json!([
            { "type": "settings", "settings": {
                "appearance": { "theme": "dark", "fontSize": 14 },
                "threads": { "agent": "claude", "followUp": "steer" },
                "agents": { "claude": { "model": "default", "permissionMode": "auto" }, "codex": { "model": "gpt-6-astra", "effort": "high", "permissionMode": "acceptEdits" } },
            } },
            { "type": "agents", "agents": [
                { "id": "claude", "name": "Claude Code", "state": "ready", "features": [], "models": [model("default", false), model("claude-opus-4-8", true), model("sonnet", false)] },
                { "id": "codex", "name": "Codex", "state": "ready", "features": [], "models": [model("default", false), model("gpt-6-astra", false)] },
            ] },
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "New session", "project": "/code/web", "terminals": [], "agent": "claude", "model": "default", "fast": true, "permissionMode": "auto" }] }
        ]);
        for m in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(m)).unwrap();
        }
        let _ = s.core.sent();
        s
    }

    fn start_thread(s: &mut Comet) {
        let message = serde_json::json!({ "type": "thread.session", "tabId": "t", "sessionId": "s1", "agent": "claude" });
        s.receive(Event::Message(serde_json::from_value(message).unwrap())).unwrap();
    }

    #[test]
    fn a_number_picks_a_model_on_show_only_while_the_picker_is_open() {
        let mut s = comet();
        assert!(!s.pick_model_by_number(1), "a closed picker leaves ⌘2 to the tabs");
        s.toggle_picker();
        assert!(s.pick_model_by_number(1));
        // The second model on show: the older one waits behind "Show older models".
        assert_eq!(s.workspace.active_tab().unwrap().model, "sonnet");
        assert!(!s.pick_model_by_number(5), "past the models, the tabs take it");
    }

    #[test]
    fn a_model_of_another_agent_moves_a_tab_that_has_not_started_and_drops_what_the_model_does_not_take() {
        let mut s = comet();
        s.toggle_picker();
        s.view_agent("codex");
        assert!(s.pick_model_by_number(1));
        let tab = s.workspace.active_tab().unwrap();
        assert_eq!((tab.agent.as_str(), tab.model.as_str()), ("codex", "gpt-6-astra"));
        // The tab takes Codex's default effort and mode, and loses the speed its Claude model had.
        assert_eq!((tab.effort.as_deref(), tab.fast, tab.permission_mode.as_str()), (Some("high"), None, "acceptEdits"));
    }

    #[test]
    fn a_started_thread_keeps_its_agent_and_another_agent_opens_a_new_tab() {
        let mut s = comet();
        start_thread(&mut s);
        s.toggle_picker();
        s.view_agent("codex");
        s.pick_model_by_number(1);
        assert_eq!(s.workspace.active_tab().unwrap().agent, "claude", "the thread stays on Claude");
        s.new_tab_on("codex");
        let tab = s.workspace.active_tab().unwrap();
        assert_eq!((tab.id != "t", tab.agent.as_str(), tab.model.as_str(), tab.project.as_str()), (true, "codex", "gpt-6-astra", "/code/web"));
        assert!(!s.picker.open);
    }
}
