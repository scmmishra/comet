import type { ContextReading, PluginLayout, QueuedMessage, TabInfo } from "@desk/protocol"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { instanceHome, writeJsonFile } from "./data-files"

/** What the core keeps about a tab's thread. The app never sees it. */
export interface TabThread {
  /** The Claude session to resume. Absent until the tab's first message. */
  readonly sessionId?: string
  /**
   * A snapshot of the working tree taken before the thread's first message. Review diffs against it.
   * No ref points at it, so `git gc` may prune it after about two weeks; Review then shows nothing.
   */
  readonly baseline?: string
  /** A snapshot taken before the last turn, for Review's last-turn changes. */
  readonly turnBaseline?: string
  /** The last context reading. A restored session is not live until its next message, so it cannot be asked. */
  readonly context?: ContextReading
  /** The key a plugin opened the thread under, such as a conversation's id. */
  readonly key?: string
  /** Messages waiting for the running turn to end. They are saved, so a restart keeps them. */
  readonly queue?: readonly QueuedMessage[]
  /** Set when a stop or an error paused the queue, until the user resumes it. */
  readonly queueHeld?: boolean
}

/** The window: its tabs in their order across projects, each tab's thread, and the folders tabs have opened. */
export interface WindowState {
  readonly tabs: readonly TabInfo[]
  readonly active?: string
  readonly threads: Readonly<Record<string, TabThread>>
  /** Most recent first. */
  readonly recent: readonly string[]
  /** The Claude session each thread key leads to, by project and key. One key always resumes the same thread. */
  readonly keys: Readonly<Record<string, string>>
  /** Each tab's plugin layout. A tab with none shows no plugin views but cards. */
  readonly layouts: Readonly<Record<string, PluginLayout>>
}

const windowStatePath = () => join(instanceHome(), "window.json")

/** The saved window. A missing or broken file gives an empty window, and a tab that is not whole is dropped. */
export function loadWindowState(): WindowState {
  let saved: Partial<WindowState>
  try {
    saved = JSON.parse(readFileSync(windowStatePath(), "utf8")) as Partial<WindowState>
  } catch {
    return { tabs: [], threads: {}, recent: [], keys: {}, layouts: {} }
  }
  return {
    tabs: Array.isArray(saved.tabs) ? saved.tabs.filter(isTab) : [],
    ...(typeof saved.active === "string" ? { active: saved.active } : {}),
    threads: typeof saved.threads === "object" && saved.threads ? saved.threads : {},
    recent: Array.isArray(saved.recent) ? saved.recent.filter((dir) => typeof dir === "string") : [],
    keys: typeof saved.keys === "object" && saved.keys ? saved.keys : {},
    layouts: typeof saved.layouts === "object" && saved.layouts ? saved.layouts : {},
  }
}

export function saveWindowState(state: WindowState) {
  writeJsonFile(windowStatePath(), state)
}

function isTab(value: unknown): value is TabInfo {
  const tab = value as Partial<TabInfo> | null
  return typeof tab?.id === "string" && typeof tab.title === "string" && typeof tab.project === "string" && Array.isArray(tab.terminals) && typeof tab.model === "string" && typeof tab.permissionMode === "string"
}
