import type { ThemeChoice } from "@desk/protocol"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody } from "@opencode/ui/dialog"
import { Keybind } from "@opencode/ui/keybind"
import { SearchHighlight, SearchList } from "@opencode/ui/search-list"
import { createMemo, createResource, createSignal, Show, type JSX } from "solid-js"
import { formatAgo } from "./format"
import { Icon, type IconName } from "./icons"
import { ProjectMark, projectLabel } from "./project-mark"
import { activeData, activeProject, newTab, newTerminal, openSettings, openThread, refreshThreads, selectTab, SETTINGS_PAGES, state, togglePanel, updateSettings, type SettingsPage } from "./store"

const DIALOG_ID = "palette"

/** The palette's sections, in the order it lists them. */
const SECTIONS = ["Actions", "Theme", "Settings", "Tabs", "Projects", "Threads"] as const
type Section = (typeof SECTIONS)[number]

/** One thing the palette can do. A search looks through its title, detail and section. */
interface Entry {
  readonly id: string
  readonly section: Section
  readonly title: string
  readonly detail?: string
  readonly icon?: IconName
  readonly lead?: JSX.Element
  readonly keys?: readonly string[]
  readonly run: () => void
}

const SETTINGS_TITLES: Record<SettingsPage, string> = { providers: "Providers", appearance: "Appearance", projects: "Projects", mcps: "MCP servers", skills: "Skills" }
const THEME_TITLES: Record<ThemeChoice, string> = { dark: "Dark theme", light: "Light theme", auto: "System theme" }

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
 * Everything Desk can do from the keyboard, after OpenCode's command palette: actions, the theme,
 * settings pages, open tabs, recent projects and the active project's threads, in one search.
 */
function Palette(props: { only?: "threads"; onDone: () => void }) {
  const [query, setQuery] = createSignal("")
  const [projects] = createResource(() => window.desk.projects())

  const entries = createMemo((): Entry[] => {
    const threads: Entry[] = activeData().threads.map((thread) => ({
      id: `thread:${thread.id}`,
      section: "Threads",
      title: thread.title,
      detail: [thread.branch && thread.branch !== activeData().space?.branch ? thread.branch : "", thread.tabId ? "Open" : "", formatAgo(thread.updatedAt)].filter(Boolean).join(" · "),
      icon: "comment",
      run: () => openThread(thread),
    }))
    if (props.only === "threads") return threads
    const theme = state.settings.appearance.theme
    return [
      { id: "new-session", section: "Actions", title: "New session", icon: "plus", keys: ["⌘", "T"], run: () => newTab() },
      { id: "new-terminal", section: "Actions", title: "New terminal", icon: "terminal", keys: ["⌃", "`"], run: newTerminal },
      { id: "toggle-panel", section: "Actions", title: state.panelOpen ? "Hide panel" : "Show panel", icon: "layout-right", keys: ["⌘", "\\"], run: togglePanel },
      {
        id: "open-folder",
        section: "Actions",
        title: "Open folder…",
        icon: "folder",
        keys: ["⌘", "O"],
        run: () => void window.desk.chooseProject().then((dir) => dir && newTab("end", dir)),
      },
      ...(["dark", "light", "auto"] as const)
        .filter((choice) => choice !== theme)
        .map((choice): Entry => ({ id: `theme:${choice}`, section: "Theme", title: `Switch to ${THEME_TITLES[choice].toLowerCase()}`, icon: "appearance", run: () => updateSettings({ appearance: { theme: choice } }) })),
      ...SETTINGS_PAGES.map((page): Entry => ({ id: `settings:${page}`, section: "Settings", title: `Settings: ${SETTINGS_TITLES[page]}`, icon: "settings-gear", run: () => openSettings(page) })),
      ...state.tabs.map((tab): Entry => ({
        id: `tab:${tab.id}`,
        section: "Tabs",
        title: tab.title,
        detail: projectLabel(tab.project),
        lead: <ProjectMark project={tab.project} />,
        run: () => selectTab(tab.id),
      })),
      ...(projects() ?? []).map((project): Entry => ({
        id: `project:${project.path}`,
        section: "Projects",
        title: `New session in ${projectLabel(project.path)}`,
        detail: project.path.replace(/^\/Users\/[^/]+/, "~"),
        lead: <ProjectMark project={project.path} />,
        run: () => {
          void window.desk.useProject(project.path)
          newTab("end", project.path)
        },
      })),
      ...threads,
    ]
  })

  // Every word must appear in the entry's title, its detail or its section.
  const matches = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return entries().filter((entry) => words.every((word) => `${entry.title} ${entry.detail ?? ""} ${entry.section}`.toLowerCase().includes(word)))
  })

  const run = (entry: Entry) => {
    props.onDone()
    entry.run()
  }

  return (
    <Dialog size="large" fit>
      <DialogBody>
        <SearchList
          query={query()}
          onQuery={setQuery}
          placeholder={props.only === "threads" ? `Search threads in ${projectLabel(activeProject())}` : "Search actions, settings, tabs and threads"}
          items={matches()}
          key={(entry) => entry.id}
          section={(entry) => entry.section}
          header={(entry) => entry.section}
          empty={query() ? "Nothing matches." : "Nothing to show yet."}
          onSelect={run}
          onClose={props.onDone}
        >
          {(entry, row) => (
            <button type="button" {...row}>
              <span class="flex min-w-0 flex-1 items-center gap-2.5">
                <Show when={entry().lead} fallback={<Show when={entry().icon}>{(icon) => <Icon name={icon()} class="text-fg-3" />}</Show>}>
                  {entry().lead}
                </Show>
                <span class="truncate">
                  <SearchHighlight text={entry().title} />
                </span>
              </span>
              <Show when={entry().detail}>
                <span class="shrink-0 truncate text-[12px] text-fg-3">{entry().detail}</span>
              </Show>
              <Show when={entry().keys}>{(keys) => <Keybind keys={[...keys()]} variant="ghost" class="shrink-0" />}</Show>
            </button>
          )}
        </SearchList>
      </DialogBody>
    </Dialog>
  )
}
