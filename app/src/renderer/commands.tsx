import type { CommandInfo, CommandRun, CommandSource } from "@desk/protocol"
import { Button } from "@opencode/ui/button"
import { Collapsible } from "@opencode/ui/collapsible"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Field } from "@opencode/ui/field"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Icon } from "./icons"
import { discoverCommands, removeCommands, runCommand, runGroup, saveCommands, state, stopCommand, stopGroup } from "./store"

const COMMAND_DIALOG_ID = "command"
const COMMAND_FORM_ID = "command-form"

/** What each run state reads as, in its dot's tooltip. */
const RUN_LABEL: Record<CommandRun["state"], string> = { idle: "Not running", running: "Running", exited: "Exited", failed: "Failed" }

/** A row of the Commands card: a command on its own, or a group of commands that share a name. */
type Entry = { readonly kind: "command"; readonly command: CommandInfo } | { readonly kind: "group"; readonly name: string; readonly members: CommandInfo[] }

/** Commands in saved order. A group takes the place of its first member, as Rune ordered them. */
function entries(commands: readonly CommandInfo[]): Entry[] {
  const out: Entry[] = []
  const groups = new Map<string, CommandInfo[]>()
  for (const command of commands) {
    if (!command.group) {
      out.push({ kind: "command", command })
      continue
    }
    const members = groups.get(command.group)
    if (members) members.push(command)
    else {
      const created = [command]
      groups.set(command.group, created)
      out.push({ kind: "group", name: command.group, members: created })
    }
  }
  return out
}

/**
 * A group's run, read from its members: running while any runs, failed when any failed, exited when
 * all exited, and idle otherwise.
 */
function groupRun(members: readonly CommandInfo[]): CommandRun {
  if (members.some((member) => member.run.state === "running")) return { state: "running" }
  const failed = members.find((member) => member.run.state === "failed")
  if (failed) return failed.run
  return members.every((member) => member.run.state === "exited") ? { state: "exited" } : { state: "idle" }
}

const runLabel = (run: CommandRun) => (run.state === "failed" ? `Failed with exit code ${run.code}` : RUN_LABEL[run.state])

/** The Commands card: the space's commands, each run in the background, with Run or Stop beside its name. */
export function CommandsCard() {
  const dialog = useDialog()
  // Editing a command in a group edits the whole group, as Rune's editor did.
  const edit = (command?: CommandInfo) =>
    dialog.show(() => <CommandEditor draft={draftFor(command)} onDone={() => dialog.close(COMMAND_DIALOG_ID)} />, undefined, COMMAND_DIALOG_ID)
  const rows = createMemo(() => entries(state.commands))

  return (
    <section class="flex flex-col rounded-3xl border border-outline bg-card p-1.5">
      <For each={rows()}>
        {(entry) => (
          <Switch>
            <Match when={entry.kind === "command" && entry}>{(single) => <CommandRow command={single().command} onEdit={() => edit(single().command)} />}</Match>
            <Match when={entry.kind === "group" && entry}>{(group) => <GroupRow name={group().name} members={group().members} onEdit={edit} />}</Match>
          </Switch>
        )}
      </For>
      <button class="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-fg-3 hover:bg-panel hover:text-fg-2" onClick={() => edit()}>
        <Icon name="plus" />
        Add command
      </button>
    </section>
  )
}

/** A group as one row that runs and stops all its commands. It opens to show each command. */
function GroupRow(props: { name: string; members: CommandInfo[]; onEdit: (command: CommandInfo) => void }) {
  const [open, setOpen] = createSignal(false)
  const run = () => groupRun(props.members)
  const running = () => props.members.filter((member) => member.run.state === "running").length
  const status = () => (running() ? `${running()} of ${props.members.length} running` : runLabel(run()))
  return (
    <Collapsible variant="ghost" open={open()} onOpenChange={setOpen}>
      <RowMenu onEdit={() => props.onEdit(props.members[0]!)} onDelete={() => removeCommands(props.members.map((member) => member.id))} class="group flex min-w-0 items-center gap-2.5 rounded-lg py-[3px] pl-2 pr-1 hover:bg-panel">
        <RunDot run={run()} label={status()} />
        <Collapsible.Trigger class="flex h-auto min-w-0 flex-1 items-center gap-1 text-left text-[13px] font-normal text-fg">
          <span class="truncate">{props.name}</span>
          <span class="shrink-0 text-fg-3">{props.members.length}</span>
          <Icon name="chevron-right" class={`size-[13px] shrink-0 text-fg-3 transition-transform duration-150 ${open() ? "rotate-90" : ""}`} />
        </Collapsible.Trigger>
        <Show
          when={running()}
          fallback={<IconButton variant="ghost-muted" size="normal" aria-label={`Run ${props.name}`} icon={<Icon name="play" />} onClick={() => runGroup(props.name)} />}
        >
          <IconButton variant="ghost-muted" size="normal" aria-label={`Stop ${props.name}`} icon={<Icon name="stop" />} onClick={() => stopGroup(props.name)} />
        </Show>
      </RowMenu>
      <Collapsible.Content class="ml-[15px] pl-[7px] shadow-[inset_1px_0_0_var(--color-line)]">
        <For each={props.members}>{(member) => <CommandRow command={member} onEdit={() => props.onEdit(member)} />}</For>
      </Collapsible.Content>
    </Collapsible>
  )
}

/** A row with a right-click menu to edit or delete what it shows. */
function RowMenu(props: { onEdit: () => void; onDelete: () => void; class: string; children: JSX.Element }) {
  return (
    <Menu.Context>
      <Menu.Context.Trigger as="div" class={props.class}>
        {props.children}
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Menu.Item onSelect={props.onEdit}>Edit…</Menu.Item>
          <Menu.Separator />
          <Menu.Item data-variant="critical" onSelect={props.onDelete}>
            Delete
          </Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

/** A run's state as a dot: green while running, red when failed, grey when exited, hollow when idle. */
function RunDot(props: { run: CommandRun; label: string }) {
  return (
    <Tooltip value={props.label} placement="left">
      <span class="grid size-[15px] shrink-0 place-items-center" aria-label={props.label}>
        <span
          class="size-[7px] rounded-full"
          classList={{
            "bg-add": props.run.state === "running",
            "bg-del": props.run.state === "failed",
            "bg-fg-3": props.run.state === "exited",
            "border border-fg-3": props.run.state === "idle",
          }}
        />
      </span>
    </Tooltip>
  )
}

type Found = CommandSource["commands"][number]

/**
 * A menu of the commands the space's Procfiles, mise tasks and package.json define, grouped by file,
 * for the editor. Picking one fills a process, and "Import all as a group" fills one per command.
 * Commands already saved, by their command line, are left out.
 */
function ImportMenu(props: { onPick: (command: Found) => void; onPickAll: (group: string, commands: readonly Found[]) => void }) {
  // The menu mounts inside the dialog's content: the dialog closes on a press outside its content, and a
  // menu in its own portal at the end of the page counts as outside. Nothing between them clips it.
  const [mount, setMount] = createSignal<HTMLElement>()
  const saved = () => new Set(state.commands.map((command) => command.command))
  const sources = () =>
    state.commandSources
      ?.map((source) => ({ ...source, commands: source.commands.filter((command) => !saved().has(command.command)) }))
      .filter((source) => source.commands.length > 0)

  return (
    // Not modal: the dialog already traps focus, and a second trap fought it for focus and hung the page.
    <Menu placement="top-start" gutter={6} modal={false} onOpenChange={(open) => open && discoverCommands()}>
      <Menu.Trigger
        as={Button}
        variant="ghost"
        class="me-auto"
        ref={(trigger: HTMLElement) => queueMicrotask(() => setMount(trigger.closest<HTMLElement>("[data-slot=dialog-content]") ?? undefined))}
      >
        Import from…
      </Menu.Trigger>
      <Show when={mount()}>
        {(into) => (
          <Menu.Portal mount={into()}>
            <Menu.Content class="max-h-[360px] w-[360px] overflow-y-auto">
              <Show when={sources()} fallback={<Menu.Item disabled>Looking…</Menu.Item>}>
                {(found) => (
                  <Show when={found().length > 0} fallback={<Menu.Item disabled>No Procfile, mise task or package.json script to import.</Menu.Item>}>
                    <For each={found()}>
                      {(source) => (
                        <Menu.Group>
                          <Menu.GroupLabel>{source.name}</Menu.GroupLabel>
                          <Show when={source.commands.length > 1}>
                            <Menu.Item onSelect={() => props.onPickAll(source.name, source.commands)}>Import all as a group</Menu.Item>
                          </Show>
                          <For each={source.commands}>
                            {(command) => (
                              <Menu.Item onSelect={() => props.onPick(command)}>
                                <span class="flex min-w-0 items-baseline gap-2">
                                  <span class="shrink-0">{command.name}</span>
                                  <span class="truncate font-mono text-[11px] text-fg-3">{command.command}</span>
                                </span>
                              </Menu.Item>
                            )}
                          </For>
                        </Menu.Group>
                      )}
                    </For>
                  </Show>
                )}
              </Show>
            </Menu.Content>
          </Menu.Portal>
        )}
      </Show>
    </Menu>
  )
}

function CommandRow(props: { command: CommandInfo; onEdit: () => void }) {
  const running = () => props.command.run.state === "running"
  return (
    <RowMenu onEdit={props.onEdit} onDelete={() => removeCommands([props.command.id])} class="group flex min-w-0 items-center gap-2.5 rounded-lg py-[3px] pl-2 pr-1 hover:bg-panel">
      <RunDot run={props.command.run} label={runLabel(props.command.run)} />
      <Tooltip value={<span class="font-mono">{props.command.command}</span>} placement="top" class="min-w-0 flex-1">
        <span class="truncate">{props.command.name}</span>
      </Tooltip>
      <IconButton variant="ghost-muted" size="normal" aria-label={`Edit ${props.command.name}`} class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" icon={<Icon name="edit" />} onClick={props.onEdit} />
      <Show
        when={running()}
        fallback={<IconButton variant="ghost-muted" size="normal" aria-label={`Run ${props.command.name}`} icon={<Icon name="play" />} onClick={() => runCommand(props.command.id)} />}
      >
        <IconButton variant="ghost-muted" size="normal" aria-label={`Stop ${props.command.name}`} icon={<Icon name="stop" />} onClick={() => stopCommand(props.command.id)} />
      </Show>
    </RowMenu>
  )
}

/** A process in the editor. `key` tells rows apart. `id` is the saved command it replaces, if any. */
type DraftProcess = { readonly key: string; readonly id?: string; name: string; command: string }

/** What the editor opens on: a new command, a plain command, or a whole group. */
interface Draft {
  readonly name: string
  readonly processes: DraftProcess[]
  /** The saved commands the draft replaces. Empty when adding. */
  readonly original: readonly string[]
}

const blankProcess = (): DraftProcess => ({ key: crypto.randomUUID(), name: "", command: "" })

function draftFor(command: CommandInfo | undefined): Draft {
  if (!command) return { name: "", processes: [blankProcess()], original: [] }
  const members = command.group ? state.commands.filter((found) => found.group === command.group) : [command]
  return {
    name: command.group ?? command.name,
    processes: members.map((member) => ({ key: member.id, id: member.id, name: member.name, command: member.command })),
    original: members.map((member) => member.id),
  }
}

/**
 * Adds or edits a command, after Rune's editor: a name and its processes. One process is a plain
 * command with the name above. "Add process" turns it into a group, where each process has a name of
 * its own. The core checks the draft and reports what it refuses.
 */
function CommandEditor(props: { draft: Draft; onDone: () => void }) {
  const [name, setName] = createSignal(props.draft.name)
  const [processes, setProcesses] = createStore<DraftProcess[]>(props.draft.processes)
  const editing = props.draft.original.length > 0
  const grouped = () => processes.length > 1
  const ready = () => !!name().trim() && processes.every((process) => process.command.trim() && (!grouped() || process.name.trim()))

  // The first process keeps the command's name when a second one joins it, as in Rune.
  const addProcess = (process: DraftProcess) =>
    setProcesses(
      produce((list) => {
        if (list.length === 1 && !list[0]!.name.trim()) list[0]!.name = name().trim()
        list.push(process)
      }),
    )
  const isBlank = () => processes.length === 1 && !processes[0]!.command.trim()
  // An import fills the blank first process, or joins the draft as another process.
  const importOne = (found: Found) => {
    if (!isBlank()) return addProcess({ ...blankProcess(), ...found })
    if (!name().trim()) setName(found.name)
    setProcesses(0, { command: found.command })
  }
  const importAll = (source: string, commands: readonly Found[]) => {
    if (!name().trim()) setName(source)
    if (isBlank()) setProcesses(commands.map((found) => ({ ...blankProcess(), ...found })))
    else for (const found of commands) addProcess({ ...blankProcess(), ...found })
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (!ready()) return
    saveCommands(
      name(),
      processes.map(({ id, name, command }) => ({ id, name, command })),
      props.draft.original,
    )
    props.onDone()
  }

  // The header, body and footer must be the dialog's own children, so the form sits in the body and Save submits it by id.
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup title={editing ? (grouped() ? "Edit group" : "Edit command") : "Add command"} description="Runs in the background at the space's root." />
      </DialogHeader>
      <DialogBody>
        {/* The body hides overflow, so the bottom padding keeps the last input's border in view. */}
        <form id={COMMAND_FORM_ID} class="grid gap-3 px-4 pb-1" onSubmit={submit}>
          <Field>
            <Field.Label>{grouped() ? "Group name" : "Name"}</Field.Label>
            <TextInput class="w-full" autofocus placeholder="Dev server" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
          </Field>
          <div class="grid gap-1.5">
            <span class="text-[12px] font-medium text-fg-2">Processes</span>
            {/* A scrolling box clips at its edges, so the padding keeps the inputs' borders inside it. The margin cancels it. */}
            <div class="-m-0.5 grid max-h-[40vh] gap-1.5 overflow-y-auto p-0.5">
              <For each={processes}>
                {(process, index) => (
                  <div class="flex items-center gap-1.5">
                    {/* A lone process is the command itself and goes by the name above. */}
                    <Show when={grouped()}>
                      <TextInput class="w-[140px] shrink-0" placeholder="Name" aria-label="Process name" value={process.name} onInput={(event) => setProcesses(index(), "name", event.currentTarget.value)} />
                    </Show>
                    <TextInput class="w-full min-w-0 flex-1 font-mono" placeholder="bun run dev" aria-label="Command" value={process.command} onInput={(event) => setProcesses(index(), "command", event.currentTarget.value)} />
                    <Show when={grouped()}>
                      <IconButton
                        variant="ghost-muted"
                        size="large"
                        aria-label={`Remove ${process.name || "process"}`}
                        icon={<Icon name="close-small" />}
                        onClick={() => setProcesses((list) => list.filter((found) => found.key !== process.key))}
                      />
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Button variant="ghost" icon="plus" class="w-fit" onClick={() => addProcess(blankProcess())}>
              Add process
            </Button>
          </div>
        </form>
      </DialogBody>
      <DialogFooter>
        <Show when={editing} fallback={<ImportMenu onPick={importOne} onPickAll={importAll} />}>
          <Button
            variant="ghost-danger"
            class="me-auto"
            onClick={() => {
              removeCommands(props.draft.original)
              props.onDone()
            }}
          >
            {grouped() ? "Delete group" : "Delete"}
          </Button>
        </Show>
        <Button variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
        <Button type="submit" form={COMMAND_FORM_ID} variant="submit" disabled={!ready()}>
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
