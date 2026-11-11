//! The Commands card, as `app/src/renderer/commands.tsx` draws it: a project's commands, each run in the
//! background, with Run or Stop beside its name. Commands that share a group show as one row. A right-click
//! edits or deletes a row, and the editor adds, changes or removes commands.

use crate::protocol::{ClientMessage, CommandInfo, CommandProcess, CommandRun};
use crate::shell::Desk;
use rune::{El, PointerPress, TextEdit, col, el, icon, row, text};
use rune_kit::{ButtonVariant, ControlSize, Dialog, IconButton, IconButtonVariant, Kit, MenuItem, TextInput, context_menu};
use rune_theme_opencode::icons as ic;
use std::collections::HashSet;

/// A row of the card: a command on its own, or a group of commands that share a name.
enum Entry<'a> {
    Command(&'a CommandInfo),
    Group(&'a str, Vec<&'a CommandInfo>),
}

/// Commands in saved order. A group takes the place of its first member.
fn entries(commands: &[CommandInfo]) -> Vec<Entry<'_>> {
    let mut out: Vec<Entry> = Vec::new();
    for command in commands {
        match &command.group {
            None => out.push(Entry::Command(command)),
            Some(group) => match out.iter_mut().find(|e| matches!(e, Entry::Group(name, _) if name == group)) {
                Some(Entry::Group(_, members)) => members.push(command),
                _ => out.push(Entry::Group(group, vec![command])),
            },
        }
    }
    out
}

/// A group's run: running while any runs, failed when any failed, exited when all exited, else idle.
fn group_run(members: &[&CommandInfo]) -> CommandRun {
    let idle = |state: &str| CommandRun { state: state.into(), code: None };
    if members.iter().any(|m| m.run.state == "running") {
        return idle("running");
    }
    if let Some(failed) = members.iter().find(|m| m.run.state == "failed") {
        return failed.run.clone();
    }
    idle(if members.iter().all(|m| m.run.state == "exited") { "exited" } else { "idle" })
}

/// The editor's form: a name, and one process per command. A lone process is the command itself.
pub struct Draft {
    project: String,
    /// The saved commands it replaces, empty for a new command.
    original: Vec<String>,
    grouped: bool,
    name: TextEdit,
    processes: Vec<(Option<String>, TextEdit, TextEdit)>,
}

/// Which group is open, which row's menu shows and where, and the editor's form.
#[derive(Default)]
pub struct CommandsCard {
    open_groups: HashSet<String>,
    menu: Option<(String, PointerPress)>,
    draft: Option<Draft>,
}

impl Desk {
    fn edit_commands(&mut self, project: &str, name: Option<&str>, members: &[CommandInfo]) {
        let processes = if members.is_empty() {
            vec![(None, TextEdit::new(""), TextEdit::new(""))]
        } else {
            members.iter().map(|m| (Some(m.id.clone()), TextEdit::new(m.name.clone()), TextEdit::new(m.command.clone()))).collect()
        };
        self.commands_card.draft = Some(Draft {
            project: project.to_owned(),
            original: members.iter().map(|m| m.id.clone()).collect(),
            grouped: members.len() > 1,
            name: TextEdit::new(name.unwrap_or("")),
            processes,
        });
    }

    fn save_commands(&mut self) {
        let Some(draft) = self.commands_card.draft.take() else { return };
        let name = draft.name.text.trim().to_owned();
        let processes = draft
            .processes
            .iter()
            .filter(|(_, _, command)| !command.text.trim().is_empty())
            .map(|(id, process, command)| CommandProcess {
                id: id.clone(),
                name: if draft.grouped { process.text.trim().to_owned() } else { name.clone() },
                command: command.text.trim().to_owned(),
            })
            .collect();
        self.core.send(&ClientMessage::CommandsSave { project: draft.project, name, processes, replacing: draft.original });
    }

    fn command_message(&self, project: &str, ids: Vec<String>, run: bool) {
        let project = project.to_owned();
        self.core.send(&if run { ClientMessage::CommandsRun { project, ids } } else { ClientMessage::CommandsStop { project, ids } });
    }
}

pub fn card(s: &Desk, project: &str, k: &Kit, layer: &mut Vec<El>) -> Option<El> {
    let commands = s.projects.get(project)?.commands.as_ref()?;
    let rows: Vec<El> = entries(commands)
        .into_iter()
        .map(|entry| match entry {
            Entry::Command(command) => command_row(s, project, command, k, layer),
            Entry::Group(name, members) => group_row(s, project, name, &members, k, layer),
        })
        .collect();
    let dir = project.to_owned();
    let add = row()
        .key("add-command")
        .w_full()
        .gap(10.0)
        .items_center()
        .px(8.0)
        .py(7.0)
        .radius(8.0)
        .hover(k.c.bg_base)
        .role("button")
        .on_press(move |s: &mut Desk| s.edit_commands(&dir, None, &[]))
        .child(icon(&ic::PLUS, 15.0).color(k.c.text_faint))
        .child(text("Add command").font(crate::theme::text(13.0)).color(k.c.text_faint));
    editor(s, k, layer);
    // Its 1 point border takes room, as in CSS: Rune's does not, so the padding adds it.
    Some(col().key("commands-card").w_full().padding(7.0).radius(12.0).fill(k.c.layer_01).border(1.0, k.c.border_muted).children(rows).child(add))
}

/// A run's state as a dot: filled while running, red when failed, grey once exited, hollow when idle.
fn run_dot(run: &CommandRun, k: &Kit) -> El {
    let label = match run.state.as_str() {
        "running" => "Running".to_owned(),
        "exited" => "Exited".to_owned(),
        "failed" => format!("Failed with exit code {}", run.code.unwrap_or(1)),
        _ => "Not running".to_owned(),
    };
    let dot = el().size(7.0, 7.0).radius(3.5);
    let dot = match run.state.as_str() {
        "running" => dot.fill(k.c.success.fg),
        "failed" => dot.fill(k.c.danger.fg),
        "exited" => dot.fill(k.c.text_faint),
        _ => dot.border(1.0, k.c.text_faint),
    };
    row().size(15.0, 15.0).center().label(label.clone()).help(label).child(dot)
}

fn run_button(name: &str, running: bool, project: &str, ids: Vec<String>, k: &Kit) -> El {
    let project = project.to_owned();
    IconButton::new(if running { &ic::STOP } else { &crate::icons::PLAY })
        .variant(IconButtonVariant::GhostMuted)
        .label(format!("{} {name}", if running { "Stop" } else { "Run" }))
        .on_press(move |s: &mut Desk| s.command_message(&project, ids.clone(), !running))
        .build(k)
}

/// What a row's menu edits or deletes: a command, or a group by its name and members.
struct Target {
    project: String,
    name: String,
    members: Vec<CommandInfo>,
}

/// A row with a right-click menu to edit or delete what it shows.
fn with_menu(s: &Desk, key: String, target: Target, content: El, k: &Kit, layer: &mut Vec<El>) -> El {
    let Target { project, name, members } = target;
    let project = project.as_str();
    let point = s.commands_card.menu.as_ref().filter(|(k, _)| *k == key).map(|(_, p)| *p);
    let menu_key = key.clone();
    let trigger = content.on_secondary_press(move |s: &mut Desk, point, _| s.commands_card.menu = Some((menu_key.clone(), point)));
    let (edit_project, edit_name, edit_members) = (project.to_owned(), name, members.clone());
    let (delete_project, ids) = (project.to_owned(), members.iter().map(|m| m.id.clone()).collect::<Vec<_>>());
    context_menu(format!("{key}-menu"), trigger, point)
        .item(MenuItem::new("Edit…").on_select(move |s: &mut Desk| {
            s.commands_card.menu = None;
            s.edit_commands(&edit_project, Some(&edit_name), &edit_members);
        }))
        .separator()
        .item(MenuItem::new("Delete").danger(true).on_select(move |s: &mut Desk| {
            s.commands_card.menu = None;
            s.core.send(&ClientMessage::CommandsRemove { project: delete_project.clone(), ids: ids.clone() });
        }))
        .on_close(|s: &mut Desk| s.commands_card.menu = None)
        .build(k, layer)
}

fn line(k: &Kit) -> El {
    row().w_full().gap(10.0).items_center().pl(8.0).pr(4.0).py(3.0).radius(8.0).hover(k.c.bg_base)
}

fn command_row(s: &Desk, project: &str, command: &CommandInfo, k: &Kit, layer: &mut Vec<El>) -> El {
    let content = line(k)
        .key(format!("command-{}", command.id))
        .child(run_dot(&command.run, k))
        .child(text(command.name.clone()).font(crate::theme::text(13.0)).color(k.c.text_base).truncate().grow(1.0))
        .child(run_button(&command.name, command.run.state == "running", project, vec![command.id.clone()], k));
    let target = Target { project: project.to_owned(), name: command.name.clone(), members: vec![command.clone()] };
    with_menu(s, format!("command-{}", command.id), target, content, k, layer)
}

/// A group as one row that runs and stops all its commands. It opens to show each command.
fn group_row(s: &Desk, project: &str, name: &str, members: &[&CommandInfo], k: &Kit, layer: &mut Vec<El>) -> El {
    let open = s.commands_card.open_groups.contains(name);
    let ids: Vec<String> = members.iter().map(|m| m.id.clone()).collect();
    let running = members.iter().filter(|m| m.run.state == "running").count();
    let toggle = name.to_owned();
    let head = line(k)
        .key(format!("group-{name}"))
        .child(run_dot(&group_run(members), k))
        .child(
            row()
                .grow(1.0)
                .min_w(0.0)
                .gap(4.0)
                .items_center()
                .role("button")
                .expanded(open)
                .on_press(move |s: &mut Desk| {
                    if !s.commands_card.open_groups.remove(&toggle) {
                        s.commands_card.open_groups.insert(toggle.clone());
                    }
                })
                .child(text(name.to_owned()).font(crate::theme::text(13.0)).color(k.c.text_base).truncate())
                .child(text(members.len().to_string()).font(crate::theme::text(13.0)).color(k.c.text_faint))
                .child(crate::icons::chevron(k, open)),
        )
        .child(run_button(name, running > 0, project, ids, k));
    let owned: Vec<CommandInfo> = members.iter().map(|m| (*m).clone()).collect();
    let target = Target { project: project.to_owned(), name: name.to_owned(), members: owned };
    let head = with_menu(s, format!("group-{name}"), target, head, k, layer);
    let list = open.then(|| col().w_full().ml(15.0).pl(7.0).border_sides([0.0, 0.0, 0.0, 1.0], k.c.border_base).children(members.iter().map(|m| command_row(s, project, m, k, layer)).collect::<Vec<_>>()));
    col().w_full().child(head).children(list)
}

/// The command editor, as a dialog.
fn editor(s: &Desk, k: &Kit, layer: &mut Vec<El>) {
    let Some(draft) = &s.commands_card.draft else { return };
    let editing = !draft.original.is_empty();
    let title = match (editing, draft.grouped) {
        (true, true) => "Edit group",
        (true, false) => "Edit command",
        _ => "Add command",
    };
    let field = |label: &str, input: El| col().w_full().gap(6.0).child(text(label.to_owned()).font(crate::theme::medium(12.0)).color(k.c.text_muted)).child(input);
    let name = TextInput::new(&draft.name).placeholder("Dev server").on_edit(|s: &mut Desk| &mut s.commands_card.draft.as_mut().expect("the editor is open").name).build(k);
    let processes = draft.processes.iter().enumerate().map(|(i, (_, process, command))| {
        let process_name = draft.grouped.then(|| {
            TextInput::new(process).placeholder("Name").label("Process name").width(Some(140.0)).on_edit(move |s: &mut Desk| &mut s.commands_card.draft.as_mut().expect("the editor is open").processes[i].1).build(k)
        });
        let command = TextInput::new(command)
            .placeholder("bun run dev")
            .label("Command")
            .text_style(crate::theme::mono(12.0))
            .on_edit(move |s: &mut Desk| &mut s.commands_card.draft.as_mut().expect("the editor is open").processes[i].2)
            .build(k)
            .grow(1.0);
        let remove = draft.grouped.then(|| {
            IconButton::new(&ic::XMARK_SMALL)
                .variant(IconButtonVariant::GhostMuted)
                .control_size(ControlSize::Large)
                .label("Remove process")
                .on_press(move |s: &mut Desk| {
                    if let Some(d) = s.commands_card.draft.as_mut() {
                        d.processes.remove(i);
                        d.grouped = d.processes.len() > 1;
                    }
                })
                .build(k)
        });
        row().key(format!("process-{i}")).w_full().gap(6.0).items_center().children(process_name).child(command).children(remove)
    });
    let add = crate::theme::button("Add process")
        .variant(ButtonVariant::Ghost)
        .icon(&ic::PLUS)
        .on_press(|s: &mut Desk| {
            if let Some(d) = s.commands_card.draft.as_mut() {
                d.processes.push((None, TextEdit::new(""), TextEdit::new("")));
                d.grouped = d.processes.len() > 1;
            }
        })
        .build(k);
    let ready = !draft.name.text.trim().is_empty() && draft.processes.iter().any(|(_, _, c)| !c.text.trim().is_empty());
    let delete = editing.then(|| {
        let (project, ids) = (draft.project.clone(), draft.original.clone());
        crate::theme::button(if draft.grouped { "Delete group" } else { "Delete" })
            .variant(ButtonVariant::Danger)
            .on_press(move |s: &mut Desk| {
                s.core.send(&ClientMessage::CommandsRemove { project: project.clone(), ids: ids.clone() });
                s.commands_card.draft = None;
            })
            .build(k)
    });
    let footer = row()
        .w_full()
        .gap(8.0)
        .items_center()
        .children(delete)
        .child(row().grow(1.0))
        .child(crate::theme::button("Cancel").variant(ButtonVariant::Ghost).on_press(|s: &mut Desk| s.commands_card.draft = None).build(k))
        .child(crate::theme::button("Save").variant(ButtonVariant::Submit).disabled(!ready).on_press(|s: &mut Desk| s.save_commands()).build(k));
    let body = col()
        .w_full()
        .gap(12.0)
        .px(16.0)
        .pb(16.0)
        .child(field(if draft.grouped { "Group name" } else { "Name" }, name))
        .child(col().w_full().gap(6.0).child(text("Processes").font(crate::theme::medium(12.0)).color(k.c.text_muted)).children(processes.collect::<Vec<_>>()).child(add))
        .child(footer);
    Dialog::new("command-editor", title)
        .description("Runs in the background in the project's folder.")
        .open(true)
        .fit()
        .on_close(|s: &mut Desk| s.commands_card.draft = None)
        .child(body)
        .build(k, layer);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(id: &str, group: Option<&str>, state: &str) -> CommandInfo {
        CommandInfo { id: id.into(), name: id.into(), command: "x".into(), group: group.map(Into::into), run: CommandRun { state: state.into(), code: None } }
    }

    #[test]
    fn groups_take_their_first_member_s_place_and_run_together() {
        let commands = [command("a", None, "idle"), command("b", Some("Dev"), "exited"), command("c", None, "idle"), command("d", Some("Dev"), "running")];
        let rows = entries(&commands);
        assert!(matches!(&rows[1], Entry::Group("Dev", members) if members.len() == 2));
        assert_eq!(rows.len(), 3);
        let Entry::Group(_, members) = &rows[1] else { unreachable!() };
        assert_eq!(group_run(members).state, "running");
    }

    #[test]
    fn a_lone_process_saves_under_the_command_s_name() {
        let mut s = Desk::default();
        s.edit_commands("/code/x", None, &[]);
        let draft = s.commands_card.draft.as_mut().unwrap();
        draft.name = TextEdit::new("Tests");
        draft.processes[0].2 = TextEdit::new("bun test");
        s.save_commands();
        let sent = s.core.sent();
        assert_eq!(sent[0]["processes"], serde_json::json!([{ "name": "Tests", "command": "bun test" }]));
        assert_eq!(sent[0]["replacing"], serde_json::json!([]));
    }
}
