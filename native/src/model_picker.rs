//! The composer's model button, as `app/src/renderer/model-picker.tsx` draws it. The popover sets the
//! model on the left and its effort on the right, with speed and the permission mode under them. The
//! button names the model that runs, so "Default" reads as "Opus 5.5".

use crate::icons;
use crate::models::{self, effort_label, is_alias, option_label, permission, permission_for, permission_modes};
use crate::protocol::{ModelOption, TabInfo};
use crate::shell::Desk;
use crate::theme;
use rune::{El, col, el, icon, row, text};
use rune_kit::{Keybind, KeybindVariant, Kit, Menu, MenuItem, Placement, popover, scrim};
use rune_theme_opencode::icons as ic;

/// The popover's width, `w-[min(520px,…)]`, and its effort column, `168px`.
const WIDTH: f32 = 520.0;
const EFFORT_WIDTH: f32 = 168.0;
const MAX_HEIGHT: f32 = 420.0;
const ROW_HEIGHT: f32 = 36.0;
/// ⌘1 to ⌘9, the tab shortcuts, pick the first nine aliases while the picker is open.
const TAB_SHORTCUTS: usize = 9;

/// Whether the picker is open, with every model or only the aliases, and whether its permission menu is open.
#[derive(Default)]
pub struct Picker {
    open: bool,
    show_all: bool,
    modes_open: bool,
}

impl Desk {
    fn model_option(&self, tab: &TabInfo) -> Option<&ModelOption> {
        self.account.model(&tab.model)
    }

    /// What the new model does not take falls back: its default effort, standard speed, Supervised.
    fn pick_model(&mut self, tab: &str, value: &str) {
        let Some(option) = self.account.model(value).cloned() else { return };
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

    /// ⌘1 to ⌘9 pick a model alias while the picker is open, as the Electron app's `pickModelByNumber` does.
    /// Whether the picker took the shortcut.
    pub fn pick_model_by_number(&mut self, index: usize) -> bool {
        if !self.picker.open {
            return false;
        }
        let Some(value) = self.account.models.iter().filter(|o| is_alias(o)).nth(index).map(|o| o.value.clone()) else { return false };
        let Some(tab) = self.workspace.active.clone() else { return false };
        self.pick_model(&tab, &value);
        true
    }

    pub fn toggle_picker(&mut self) {
        let opening = !self.picker.open;
        // A pinned model shows only in the full list, so choosing one opens it that way.
        let pinned = self.workspace.active_tab().and_then(|t| self.model_option(t)).is_some_and(|o| !is_alias(o));
        self.picker = Picker { open: opening, show_all: opening && pinned, modes_open: false };
    }
}

pub fn model_picker(s: &Desk, tab: &TabInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let selected = s.model_option(tab);
    let ran = s.threads.get(&tab.id).and_then(|t| t.model.as_deref());
    let name = selected.map(option_label).or_else(|| ran.map(models::model_label)).unwrap_or_else(|| "Claude Code".into());
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
        .expanded(s.picker.open)
        .on_press(|s: &mut Desk| s.toggle_picker())
        .child(claude_mark(tab.fast == Some(true), k))
        .child(text(name).font(crate::theme::text(13.0)).color(k.c.text_base))
        .children(effort.map(|e| faint(effort_label(&e).to_owned())))
        // Supervised is the plain case. Any other mode shows, so a thread never runs looser than you think.
        .children((tab.permission_mode != "default").then(|| row().gap(8.0).child(faint("·".into())).child(faint(permission(&tab.permission_mode).0.to_owned()))))
        .child(icon(&ic::CHEVRON_DOWN, crate::icons::SIZE).color(k.c.text_faint));
    if !s.picker.open {
        return trigger;
    }
    // rune-kit's Popover caps its width at 320, `@opencode/ui`'s default. Desk widens this one, so it
    // builds the surface from the same parts.
    let body = popover_body(s, tab, selected, k, layer).role("dialog").label("Model and effort");
    layer.insert(0, scrim("model-scrim", |s: &mut Desk| s.picker = Picker::default()));
    layer.push(popover::anchored(k, crate::ui::popover(k, body), "model-picker", Placement::TopEnd, 8.0));
    trigger
}

/// Claude's mark, in its colour, with a bolt in fast mode.
fn claude_mark(fast: bool, k: &Kit) -> El {
    let bolt = fast.then(|| icon(&icons::BOLT_FILLED, 13.0).color(theme::fast(k.dark)).absolute(10.0, 5.0));
    el().size(16.0, 16.0).child(icon(&icons::CLAUDE, 16.0).color(theme::claude())).children(bolt)
}

fn popover_body(s: &Desk, tab: &TabInfo, selected: Option<&ModelOption>, k: &Kit, layer: &mut Vec<El>) -> El {
    let models = &s.account.models;
    let aliases: Vec<&ModelOption> = models.iter().filter(|o| is_alias(o)).collect();
    let shown: Vec<&ModelOption> = if s.picker.show_all { models.iter().collect() } else { aliases.clone() };
    let heading = |words: &str| row().h(36.0).items_center().px(14.0).pt(6.0).child(text(words.to_owned()).font(crate::theme::text(12.0)).color(k.c.text_faint));
    let check = || icon(&ic::CHECK, 15.0).color(k.c.text_base);
    let rows = shown.iter().map(|option| {
        let picked = option.value == tab.model;
        let shortcut = aliases.iter().position(|a| a.value == option.value).filter(|i| *i < TAB_SHORTCUTS).map(|i| (i + 1).to_string());
        let (id, value) = (tab.id.clone(), option.value.clone());
        row()
            .key(format!("model-{}", option.value))
            .h(ROW_HEIGHT)
            .w_full()
            .gap(10.0)
            .items_center()
            .px(10.0)
            .radius(7.0)
            .hover(k.c.hover)
            .role("button")
            .on_press(move |s: &mut Desk| s.pick_model(&id, &value))
            .child(text(option.label.clone()).font(crate::theme::text(13.0)).color(k.c.text_base))
            .child(text(option.description.clone()).font(crate::theme::text(12.0)).color(k.c.text_faint).truncate().grow(1.0))
            .children(picked.then(check))
            .children(shortcut.map(|n| Keybind::new(&["⌘", n.as_str()]).variant(KeybindVariant::Ghost).build(k)))
    });
    let older = (!s.picker.show_all && models.len() > aliases.len()).then(|| {
        row().h(ROW_HEIGHT).items_center().px(10.0).radius(7.0).role("button").on_press(|s: &mut Desk| s.picker.show_all = true).child(text("Show older models").font(crate::theme::text(13.0)).color(k.c.text_faint))
    });
    let loading = models.is_empty().then(|| row().px(10.0).py(8.0).child(text("Loading models…").font(crate::theme::text(13.0)).color(k.c.text_faint)));
    let list = col().w_full().gap(1.0).padding(6.0).children(loading).children(rows).children(older);
    let model_column = col().grow(1.0).min_w(0.0).child(heading("Model")).child(col().w_full().shrink().min_h(0.0).scroll(rune::ScrollSpec { stick_bottom: false }).child(list));

    let efforts = match selected.filter(|o| !o.efforts.is_empty()) {
        None => col().px(8.0).py(8.0).child(text("This model has no effort levels.").font(crate::theme::text(12.0)).color(k.c.text_faint).wrap()),
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
                .on_press(move |s: &mut Desk| {
                    let value = value.clone();
                    s.workspace.change_tab(&id, |t| t.effort = value, &s.core);
                })
                .child(row().grow(1.0).gap(6.0).child(text(words).font(crate::theme::text(13.0)).color(if picked { k.c.text_base } else { k.c.text_muted })).children(default.map(|d| text(d.to_owned()).font(crate::theme::text(13.0)).color(k.c.text_faint))))
                .children(picked.then(check))
        })),
    };
    let effort_heading = row()
        .h(36.0)
        .items_center()
        .px(14.0)
        .pt(6.0)
        .gap(8.0)
        .child(text("Effort").font(crate::theme::text(12.0)).color(k.c.text_faint).grow(1.0))
        .children(selected.map(|o| text(option_label(o)).font(crate::theme::text(12.0)).color(k.c.text_faint).truncate()));
    // The borders take a point of room in CSS, which Rune's do not.
    let effort_column = col().w(EFFORT_WIDTH).pl(1.0).border_sides([0.0, 0.0, 0.0, 1.0], k.c.border_muted).child(effort_heading).child(efforts);

    // Fast mode is only offered on a model that has it.
    let speed = selected.filter(|o| o.fast).map(|_| {
        let id = tab.id.clone();
        crate::ui::segmented(
            k,
            "Speed",
            &[crate::ui::Segment { icon: None, words: Some("Standard"), name: "Standard" }, crate::ui::Segment { icon: Some(&icons::BOLT), words: Some("Fast"), name: "Fast" }],
            usize::from(tab.fast == Some(true)),
            move |s: &mut Desk, i| {
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
    col().w(WIDTH).max_h(MAX_HEIGHT).child(row().w_full().shrink().min_h(0.0).child(model_column).child(effort_column)).child(footer)
}

/// The permission mode: a menu that opens above its button, over the model list.
fn permission_menu(s: &Desk, tab: &TabInfo, selected: Option<&ModelOption>, k: &Kit, layer: &mut Vec<El>) -> El {
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
        .on_press(|s: &mut Desk| s.picker.modes_open = !s.picker.modes_open)
        .child(icon(mark, 15.0).color(k.c.text_muted))
        .child(text(label).font(crate::theme::text(13.0)).color(k.c.text_muted))
        .child(icon(&ic::CHEVRON_DOWN, crate::icons::SIZE).color(k.c.text_faint));
    let mut menu = Menu::new("permission-menu").trigger(trigger).open(s.picker.modes_open).placement(Placement::TopEnd).min_width(320.0).on_close(|s: &mut Desk| s.picker.modes_open = false);
    for mode in permission_modes(selected) {
        let (label, description, mark) = permission(mode);
        let id = tab.id.clone();
        menu = menu.item(MenuItem::new(label).icon(mark).description(description).checked(mode == tab.permission_mode).on_select(move |s: &mut Desk| {
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
    use crate::shell::Desk;

    #[test]
    fn a_number_picks_an_alias_only_while_the_picker_is_open() {
        let mut s = Desk::default();
        let messages = serde_json::json!([
            { "type": "models", "models": [
                { "value": "default", "label": "Default", "description": "", "efforts": [], "fast": false, "autoMode": true },
                { "value": "claude-opus-4-8", "label": "Opus 4.8", "description": "", "efforts": [], "fast": false, "autoMode": true },
                { "value": "sonnet", "label": "Sonnet", "description": "", "efforts": [], "fast": false, "autoMode": true }
            ] },
            { "type": "tabs", "active": "t", "tabs": [{ "id": "t", "title": "New session", "project": "/code/web", "terminals": [], "model": "default", "permissionMode": "auto" }] }
        ]);
        for m in serde_json::from_value::<Vec<CoreMessage>>(messages).unwrap() {
            s.receive(Event::Message(m)).unwrap();
        }
        assert!(!s.pick_model_by_number(1), "a closed picker leaves ⌘2 to the tabs");
        s.toggle_picker();
        assert!(s.pick_model_by_number(1));
        // The second alias: the pinned model is not one.
        assert_eq!(s.workspace.active_tab().unwrap().model, "sonnet");
        assert!(!s.pick_model_by_number(5), "past the aliases, the tabs take it");
    }
}
