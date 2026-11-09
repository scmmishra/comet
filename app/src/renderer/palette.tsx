import type { ThemeChoice } from "@desk/protocol"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody } from "@opencode/ui/dialog"
import { Keybind } from "@opencode/ui/keybind"
import { SearchHighlight, SearchList } from "@opencode/ui/search-list"
import { createMemo, createSignal, For, Show } from "solid-js"
import { formatAgo } from "./format"
import { Icon, type IconName } from "./icons"
import { ProjectMark, projectLabel } from "./project-mark"
import { activeProject, newTab, newTerminal, openSettings, openThread, projectThreads, refreshThreads, selectTab, SETTINGS_PAGES, state, togglePanel, updateSettings, type SettingsPage } from "./store"

const DIALOG_ID = "palette"
/** Threads the palette lists before a search. A search looks through all of them. */
const RECENT_THREADS = 20

/** One thing the palette can do. A search looks through its title, detail and section. */
interface Entry {
  readonly id: string
  readonly section: string
  readonly title: string
  readonly detail?: string
  readonly icon?: IconName
  /** A project whose mark leads the row, in place of an icon. Entries stay plain data, so the list can rebuild them freely. */
  readonly project?: string
  readonly keys?: readonly string[]
  /** Marks the current choice in a list of choices, such as the theme. */
  readonly checked?: boolean
  /** Runs the entry. An entry without it opens `page` instead. */
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

const SETTINGS_TITLES: Record<SettingsPage, string> = { providers: "Providers", appearance: "Appearance", projects: "Projects", mcps: "MCP servers", skills: "Skills" }
const THEMES: readonly { choice: ThemeChoice; title: string; icon: IconName }[] = [
  { choice: "auto", title: "System", icon: "monitor" },
  { choice: "light", title: "Light", icon: "appearance" },
  { choice: "dark", title: "Dark", icon: "appearance" },
]

/**
 * Opens the command palette, or closes it when it is open. With `threads`, it lists only the active
 * project's threads, for ⌘⇧O. Call it inside the DialogProvider.
 */
export function usePalette() {
  const dialog = useDialog()
  return (only?: "threads") => {
    if (dialog.active?.id === DIALOG_ID) return dialog.close(DIALOG_ID)
    refreshThreads()
    dialog.show(() => <Palette only={only} onDone={() => dialog.close(DIALOG_ID)} />, undefined, DIALOG_ID)
  }
}

/**
 * Everything Desk can do from the keyboard, after T3 Code's command palette. The root lists actions,
 * open tabs and recent threads. Themes, settings pages and projects sit in nested lists, and a search
 * from the root looks through those too.
 */
function Palette(props: { only?: "threads"; onDone: () => void }) {
  const [query, setQuery] = createSignal("")
  const [pages, setPages] = createSignal<readonly Page[]>([])
  const page = () => pages().at(-1)
  // Recent projects, read once as the palette opens.
  const [projects, setProjects] = createSignal<readonly { readonly path: string; readonly name: string }[]>([])
  void window.desk.projects().then(setProjects)

  /** A project's threads, newest first, as the core lists them. */
  const threadEntries = (project: string): Entry[] =>
    projectThreads(project).map((thread) => ({
      id: `thread:${thread.id}`,
      section: "Threads",
      title: thread.title,
      detail: [thread.branch && thread.branch !== state.projects[project]?.space?.branch ? thread.branch : "", thread.tabId ? "Open" : "", formatAgo(thread.updatedAt)].filter(Boolean).join(" · "),
      icon: "comment",
      run: () => openThread(thread, project),
    }))
  const threads = () => threadEntries(activeProject())
  const threadsPage = (project: string): Page => ({ title: `Threads in ${projectLabel(project)}`, load: () => refreshThreads(project), entries: () => threadEntries(project) })

  const themePage: Page = {
    title: "Change theme",
    entries: () =>
      THEMES.map(({ choice, title, icon }) => ({
        id: `theme:${choice}`,
        section: "Theme",
        title,
        icon,
        checked: state.settings.appearance.theme === choice,
        run: () => updateSettings({ appearance: { theme: choice } }),
      })),
  }
  const settingsPage: Page = {
    title: "Open settings",
    entries: () => SETTINGS_PAGES.map((page) => ({ id: `settings:${page}`, section: "Settings", title: SETTINGS_TITLES[page], icon: "settings-gear", run: () => openSettings(page) })),
  }
  /** Recent projects as a nested list. `entry` turns a project into what its row does. */
  const projectPage = (title: string, entry: (project: string) => Pick<Entry, "run" | "page">): Page => ({
    title,
    entries: () =>
      projects().map((project) => ({
        id: `project:${project.path}`,
        section: "Projects",
        title: projectLabel(project.path),
        detail: project.path.replace(/^\/Users\/[^/]+/, "~"),
        project: project.path,
        ...entry(project.path),
      })),
  })
  const newSessionPage = projectPage("New session in", (project) => ({
    run: () => {
      void window.desk.useProject(project)
      newTab("end", project)
    },
  }))
  const searchThreadsPage = projectPage("Search threads in", (project) => ({ page: threadsPage(project) }))

  const root = (): Entry[] => [
    { id: "new-session", section: "Actions", title: "New session", icon: "plus", keys: ["⌘", "T"], run: () => newTab() },
    { id: "new-session-in", section: "Actions", title: "New session in…", icon: "folder-add-left", page: newSessionPage },
    { id: "search-threads", section: "Actions", title: "Search threads", icon: "magnifying-glass", keys: ["⌘", "⇧", "O"], page: threadsPage(activeProject()) },
    { id: "search-threads-in", section: "Actions", title: "Search threads in…", icon: "magnifying-glass", page: searchThreadsPage },
    { id: "new-terminal", section: "Actions", title: "New terminal", icon: "terminal", keys: ["⌃", "`"], run: newTerminal },
    { id: "toggle-panel", section: "Actions", title: state.panelOpen ? "Hide panel" : "Show panel", icon: "layout-right", keys: ["⌘", "\\"], run: togglePanel },
    { id: "open-folder", section: "Actions", title: "Open folder…", icon: "folder", keys: ["⌘", "O"], run: () => void window.desk.chooseProject().then((dir) => dir && newTab("end", dir)) },
    { id: "change-theme", section: "Actions", title: "Change theme…", icon: "appearance", page: themePage },
    { id: "open-settings", section: "Actions", title: "Open settings…", icon: "settings-gear", page: settingsPage },
    ...state.tabs.map((tab): Entry => ({ id: `tab:${tab.id}`, section: "Tabs", title: tab.title, detail: projectLabel(tab.project), project: tab.project, run: () => selectTab(tab.id) })),
  ]

  const entries = createMemo((): Entry[] => {
    const current = page()
    if (current) return current.entries()
    if (props.only === "threads") return threads()
    // A search from the root also finds what the nested lists hold.
    if (!query().trim()) return [...root(), ...threads().slice(0, RECENT_THREADS)]
    return [...root(), ...themePage.entries(), ...settingsPage.entries(), ...newSessionPage.entries(), ...threads()]
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
    entry.run?.()
  }

  // Escape, or Backspace in an empty field, leaves a nested list before it closes the palette.
  const onKeyDown = (event: KeyboardEvent) => {
    if (page() && (event.key === "Escape" || (event.key === "Backspace" && !query()))) {
      event.preventDefault()
      back()
    }
  }

  const placeholder = () => {
    const current = page()
    if (current) return `${current.title}…`
    return props.only === "threads" ? `Search threads in ${projectLabel(activeProject())}` : "Search actions, tabs and threads"
  }

  return (
    <Dialog size="large" fit containerClass="desk-palette">
      <DialogBody>
        {/* The dialog closes on Escape unless the key comes from inside [data-owns-escape]. A nested list takes Escape to go back. */}
        <div class="contents" data-owns-escape={page() ? "" : undefined}>
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
          footer={<Hints back={!!page()} />}
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
              <Show when={entry().keys}>{(keys) => <Keybind keys={[...keys()]} variant="ghost" class="shrink-0 text-fg-3" />}</Show>
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
