import { THEMES } from "@desk/protocol"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody } from "@opencode/ui/dialog"
import { Keybind } from "@opencode/ui/keybind"
import { SearchHighlight, SearchList } from "@opencode/ui/search-list"
import { createMemo, createSignal, For, Show } from "solid-js"
import { COMMANDS, keyLabels, type CommandId, type DeskCommand } from "../shared/commands"
import { account, updateSettings } from "./account"
import { THEME_LABELS } from "./appearance"
import { formatAgo, otherBranch, shortPath } from "./format"
import { Icon, type IconName } from "./icons"
import { ProjectMark } from "./project-mark"
import { projectData, projectLabel, readProject } from "./projects"
import { openPanel, runPluginCommand } from "./plugins"
import { SETTINGS_PAGES } from "./settings/pages"
import { openThread } from "./threads"
import { activeProject, activeTab, newTab, openSettings, openSetup, showTab, workspace } from "./workspace"

const DIALOG_ID = "palette"
/** Threads the palette lists before a search. A search looks through all of them. */
const RECENT_THREADS = 20
const THEME_ICONS: Record<(typeof THEMES)[number], IconName> = { dark: "appearance", light: "appearance", auto: "monitor" }

/** One thing the palette can do. A search looks through its title, detail and section. */
interface Entry {
  readonly id: string
  readonly section: string
  readonly title: string
  readonly detail?: string
  readonly icon?: IconName
  /** A project whose mark leads the row, in place of an icon. Entries stay plain data, so the list can rebuild them freely. */
  readonly project?: string
  /** The menu command the entry runs. Its shortcut shows beside it. */
  readonly command?: CommandId
  /** Marks the current choice in a list of choices, such as the theme. */
  readonly checked?: boolean
  /** Runs the entry. An entry without it runs `command`, or opens `page`. */
  readonly run?: () => void
  readonly page?: Page
}

/** A nested list, such as the themes. Its entries are read each time the list shows. */
interface Page {
  readonly title: string
  /** Asks the core for what the list shows, each time it opens. */
  readonly load?: () => void
  readonly entries: () => Entry[]
}

/**
 * Opens the command palette, or closes it when it is open. With `threads`, it opens on the active
 * project's threads, for ⌘⇧O. `run` runs a menu command. Call it inside the DialogProvider.
 */
export function usePalette(run: (command: DeskCommand) => void) {
  const dialog = useDialog()
  return (start?: "threads") => {
    if (dialog.active?.id === DIALOG_ID) return dialog.close(DIALOG_ID)
    readProject(activeProject(), "threads")
    readProject(activeProject(), "plugins")
    dialog.show(() => <Palette start={start} run={run} onDone={() => dialog.close(DIALOG_ID)} />, undefined, DIALOG_ID)
  }
}

/**
 * Everything Desk can do from the keyboard, after T3 Code's command palette. The root lists actions,
 * open tabs and recent threads. Themes, settings pages and projects sit in nested lists, and a search
 * from the root looks through those too.
 */
function Palette(props: { start?: "threads"; run: (command: DeskCommand) => void; onDone: () => void }) {
  const [query, setQuery] = createSignal("")

  /** A project's threads, newest first, as the core lists them. */
  const threadEntries = (project: string): Entry[] =>
    (projectData(project).threads ?? []).map((thread) => ({
      id: `thread:${thread.id}`,
      section: "Threads",
      title: thread.title,
      detail: [otherBranch(thread, projectData(project).space?.branch) ?? "", thread.tabId ? "Open" : "", formatAgo(thread.updatedAt)].filter(Boolean).join(" · "),
      icon: "comment",
      run: () => openThread(thread, project),
    }))
  const threads = () => threadEntries(activeProject())
  const threadsPage = (project: string): Page => ({ title: `Threads in ${projectLabel(project)}`, load: () => readProject(project, "threads"), entries: () => threadEntries(project) })

  const themePage: Page = {
    title: "Change theme",
    entries: () =>
      THEMES.map((theme) => ({
        id: `theme:${theme}`,
        section: "Theme",
        title: THEME_LABELS[theme],
        icon: THEME_ICONS[theme],
        checked: account.settings.appearance.theme === theme,
        run: () => updateSettings({ appearance: { theme } }),
      })),
  }
  const settingsPage: Page = {
    title: "Open settings",
    entries: () => SETTINGS_PAGES.map((page) => ({ id: `settings:${page.id}`, section: "Settings", title: page.title, icon: page.icon, run: () => openSettings(page.id) })),
  }
  /** Recent projects as a nested list. `entry` turns a project into what its row does. */
  const projectPage = (title: string, entry: (project: string) => Pick<Entry, "run" | "page">): Page => ({
    title,
    entries: () =>
      workspace.recent.map((project) => ({
        id: `project:${project}`,
        section: "Projects",
        title: projectLabel(project),
        detail: shortPath(project),
        project,
        ...entry(project),
      })),
  })
  const newSessionPage = projectPage("New session in", (project) => ({ run: () => newTab("end", project) }))
  const searchThreadsPage = projectPage("Search threads in", (project) => ({ page: threadsPage(project) }))
  const offered = () => projectData(activeProject()).plugins
  const setupsPage: Page = {
    title: "Open setup",
    entries: () => (offered()?.setups ?? []).map((setup) => ({ id: `setup:${setup.id}`, section: "Setups", title: setup.title, icon: "workspace", run: () => openSetup(activeProject(), setup) })),
  }
  const panelsPage: Page = {
    title: "Open panel",
    entries: () => (offered()?.panels ?? []).map((panel) => ({ id: `panel:${panel.id}`, section: "Panels", title: panel.title, icon: "layout-right", run: () => withTab((tabId) => openPanel(tabId, panel.id)) })),
  }
  /** A command that asks for text runs on what the field holds. */
  const inputPage = (command: { id: string; title: string; input?: string }): Page => ({
    title: command.input ?? command.title,
    entries: () => (query().trim() ? [{ id: `input:${command.id}`, section: command.title, title: query().trim(), run: () => withTab((tabId) => runPluginCommand(tabId, command.id, query().trim())) }] : []),
  })
  const pluginCommands = (): Entry[] =>
    (offered()?.commands ?? []).map((command) => ({
      id: `command:${command.id}`,
      section: "Plugins",
      title: command.title,
      icon: "code",
      ...(command.input ? { page: inputPage(command) } : { run: () => withTab((tabId) => runPluginCommand(tabId, command.id)) }),
    }))

  const root = (): Entry[] => [
    { id: "new-session", section: "Actions", title: "New session", icon: "plus", command: "tab.new" },
    { id: "new-session-in", section: "Actions", title: "New session in…", icon: "folder-add-left", page: newSessionPage },
    { id: "search-threads", section: "Actions", title: "Search threads", icon: "magnifying-glass", command: "threads.search", page: threadsPage(activeProject()) },
    { id: "search-threads-in", section: "Actions", title: "Search threads in…", icon: "magnifying-glass", page: searchThreadsPage },
    { id: "new-terminal", section: "Actions", title: "New terminal", icon: "terminal", command: "terminal.new" },
    { id: "toggle-panel", section: "Actions", title: activeTab()?.panelOpen ? "Hide panel" : "Show panel", icon: "layout-right", command: "panel.toggle" },
    { id: "open-folder", section: "Actions", title: "Open folder…", icon: "folder", command: "folder.open" },
    { id: "open-setup", section: "Actions", title: "Open setup…", icon: "workspace", page: setupsPage },
    { id: "open-panel", section: "Actions", title: "Open panel…", icon: "layout-right", page: panelsPage },
    ...pluginCommands(),
    { id: "change-theme", section: "Actions", title: "Change theme…", icon: "appearance", page: themePage },
    { id: "open-settings", section: "Actions", title: "Open settings…", icon: "settings-gear", page: settingsPage },
    ...workspace.tabs.map((tab): Entry => ({ id: `tab:${tab.id}`, section: "Tabs", title: tab.title, detail: projectLabel(tab.project), project: tab.project, run: () => showTab(tab.id) })),
  ]

  // The palette opened on a list leaves it by closing, so ⌘⇧O and Escape make a pair.
  const startPages = props.start === "threads" ? [threadsPage(activeProject())] : []
  const [pages, setPages] = createSignal<readonly Page[]>(startPages)
  const page = () => pages().at(-1)
  const nested = () => pages().length > startPages.length

  const entries = createMemo((): Entry[] => {
    const current = page()
    if (current) return current.entries()
    // A search from the root also finds what the nested lists hold.
    if (!query().trim()) return [...root(), ...threads().slice(0, RECENT_THREADS)]
    return [...root(), ...themePage.entries(), ...settingsPage.entries(), ...newSessionPage.entries(), ...setupsPage.entries(), ...panelsPage.entries(), ...threads()]
  })

  // Every word must appear in the entry's title, its detail or its section.
  const matches = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return entries().filter((entry) => words.every((word) => `${entry.title} ${entry.detail ?? ""} ${entry.section}`.toLowerCase().includes(word)))
  })

  const open = (next: Page) => {
    next.load?.()
    setPages((stack) => [...stack, next])
    setQuery("")
  }
  const back = () => {
    setPages((stack) => stack.slice(0, -1))
    setQuery("")
  }

  const select = (entry: Entry) => {
    if (entry.page) return open(entry.page)
    props.onDone()
    if (entry.run) entry.run()
    else if (entry.command) props.run({ id: entry.command })
  }

  // Escape, or Backspace in an empty field, leaves a nested list before it closes the palette.
  const onKeyDown = (event: KeyboardEvent) => {
    if (nested() && (event.key === "Escape" || (event.key === "Backspace" && !query()))) {
      event.preventDefault()
      back()
    }
  }

  const placeholder = () => {
    const current = page()
    return current ? `${current.title}…` : "Search actions, tabs and threads"
  }

  return (
    <Dialog size="large" fit containerClass="desk-palette">
      <DialogBody>
        {/* The dialog closes on Escape unless the key comes from inside [data-owns-escape]. A nested list takes Escape to go back. */}
        <div class="contents" data-owns-escape={nested() ? "" : undefined}>
        <SearchList
          query={query()}
          onQuery={setQuery}
          placeholder={placeholder()}
          items={matches()}
          key={(entry) => entry.id}
          section={(entry) => entry.section}
          header={(entry) => (page() ? page()!.title : entry.section)}
          empty={query() ? "Nothing matches." : "Nothing to show yet."}
          onSelect={select}
          onKeyDown={onKeyDown}
          onClose={props.onDone}
          footer={<Hints back={nested()} />}
        >
          {(entry, row) => (
            <button type="button" {...row}>
              <span class="flex min-w-0 flex-1 items-center gap-2.5">
                <Show when={entry().project} fallback={<Show when={entry().icon}>{(icon) => <Icon name={icon()} class="shrink-0 text-fg-3" />}</Show>}>
                  {(project) => <ProjectMark project={project()} />}
                </Show>
                <span class="truncate">
                  <SearchHighlight text={entry().title} />
                </span>
                <Show when={entry().detail}>
                  <span class="min-w-0 shrink truncate text-[12px] text-fg-3">{entry().detail}</span>
                </Show>
              </span>
              <Show when={entry().command}>{(command) => <Keybind keys={keyLabels(COMMANDS[command()].accelerator)} variant="ghost" class="shrink-0 text-fg-3" />}</Show>
              <Show when={entry().checked}>
                <Icon name="check" class="shrink-0 text-fg-2" />
              </Show>
              <Show when={entry().page}>
                <Icon name="outline-chevron-right" class="shrink-0 text-fg-3" />
              </Show>
            </button>
          )}
        </SearchList>
        </div>
      </DialogBody>
    </Dialog>
  )
}

function withTab(action: (tabId: string) => void) {
  const tab = activeTab()
  if (tab) action(tab.id)
}

/** The keys the palette answers, as T3 Code lists them under its results. */
function Hints(props: { back: boolean }) {
  const hints = () => [
    { keys: ["↑", "↓"], label: "Navigate" },
    { keys: ["↵"], label: "Select" },
    props.back ? { keys: ["Esc"], label: "Back" } : { keys: ["Esc"], label: "Close" },
  ]
  return (
    <span class="flex items-center gap-4">
      <For each={hints()}>
        {(hint) => (
          <span class="flex items-center gap-1.5">
            <Keybind keys={hint.keys} />
            {hint.label}
          </span>
        )}
      </For>
    </span>
  )
}
