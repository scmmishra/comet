import type { ContextReading, TabInfo } from "@desk/protocol"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { deskHome, writeJsonFile } from "./data-files"

/** What the core keeps about a tab's thread. The app never sees it. */
export interface TabThread {
  /** The Claude session to resume. Absent until the tab's first message. */
  readonly sessionId?: string
  /**
   * A snapshot of the working tree taken before the thread's first message. Review diffs against it.
   * No ref points at it, so `git gc` may prune it after about two weeks; Review then shows nothing.
   */
  readonly baseline?: string
  /** The last context reading. A restored session is not live until its next message, so it cannot be asked. */
  readonly context?: ContextReading
}

/** The window: its tabs in their order across projects, each tab's thread, and the folders tabs have opened. */
export interface WindowState {
  readonly tabs: readonly TabInfo[]
  readonly active?: string
  readonly threads: Readonly<Record<string, TabThread>>
  /** Most recent first. */
  readonly recent: readonly string[]
}

const windowStatePath = () => join(deskHome(), "window.json")

/** The saved window. A missing or broken file gives an empty window, and a tab that is not whole is dropped. */
export function loadWindowState(): WindowState {
  let saved: Partial<WindowState>
  try {
    saved = JSON.parse(readFileSync(windowStatePath(), "utf8")) as Partial<WindowState>
  } catch {
    return { tabs: [], threads: {}, recent: [] }
  }
  return {
    tabs: Array.isArray(saved.tabs) ? saved.tabs.filter(isTab) : [],
    ...(typeof saved.active === "string" ? { active: saved.active } : {}),
    threads: typeof saved.threads === "object" && saved.threads ? saved.threads : {},
    recent: Array.isArray(saved.recent) ? saved.recent.filter((dir) => typeof dir === "string") : [],
  }
}

export function saveWindowState(state: WindowState) {
  writeJsonFile(windowStatePath(), state)
}

function isTab(value: unknown): value is TabInfo {
  const tab = value as Partial<TabInfo> | null
  return typeof tab?.id === "string" && typeof tab.title === "string" && typeof tab.project === "string" && Array.isArray(tab.terminals) && typeof tab.model === "string" && typeof tab.permissionMode === "string"
}
