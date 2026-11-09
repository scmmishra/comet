import { DEFAULT_MODEL, type TabInfo } from "@desk/protocol"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { deskHome, spaceDataPath, writeJsonFile } from "./data-files"

/** A tab as it is saved: what the app shows, plus what the core needs to resume its conversation. */
export interface SavedTab extends TabInfo {
  /** The Claude session to resume. Absent until the tab's first message. */
  readonly sessionId?: string
  /**
   * A snapshot of the working tree taken before the thread's first message. Review diffs against it.
   * No ref points at it, so `git gc` may prune it after about two weeks; Review then shows nothing.
   */
  readonly baseline?: string
  /** The last context reading. A restored session is not live until its next message, so it cannot be asked. */
  readonly context?: { readonly percent: number; readonly tokens: number; readonly maxTokens: number }
}

/** The window's tabs, in their order across projects. */
export interface WindowState {
  readonly tabs: readonly SavedTab[]
  readonly active?: string
}

export const windowStatePath = () => join(deskHome(), "window.json")

/**
 * The window's saved tabs. Before tabs held projects, each project saved its own tabs in
 * `~/.desk/spaces`. With no window file yet, the tabs of `project`, the one the window opens on, move
 * into the window, so they are not lost.
 */
export function loadWindowState(project: string): WindowState {
  const window = readState(windowStatePath())
  if (window) return { tabs: window.tabs.map((tab) => withDefaults(tab, project)), active: window.active }
  const old = readState(spaceDataPath("spaces", project))
  return old ? { tabs: old.tabs.map((tab) => withDefaults(tab, project)), active: old.active } : { tabs: [] }
}

export function saveWindowState(state: WindowState) {
  writeJsonFile(windowStatePath(), state)
}

function readState(path: string): { tabs: Partial<SavedTab>[]; active?: string } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { tabs?: unknown; active?: string }
    return { tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [], active: parsed.active }
  } catch {
    return undefined
  }
}

/** Tabs saved before projects, panel terminals, models or permission modes were saved lack them. */
function withDefaults(tab: Partial<SavedTab>, project: string): SavedTab {
  return {
    ...tab,
    id: tab.id ?? crypto.randomUUID(),
    title: tab.title ?? "New session",
    project: tab.project ?? project,
    terminals: tab.terminals ?? [],
    model: tab.model ?? DEFAULT_MODEL,
    permissionMode: tab.permissionMode ?? "default",
  }
}
