import type { ChangedFile, ContextReading, PluginLayout, QueuedMessage, TabInfo } from "@desk/protocol"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { instanceHome, writeJsonFile } from "./data-files"

/** What the core keeps about a tab's thread. The app never sees it. */
export interface TabThread {
  /** The Claude session to resume. Absent until the tab's first message. */
  readonly sessionId?: string
  /**
   * Checkpoint commits, after T3 Code. Each turn runs from the checkpoint the turn before it ended on,
   * so edits made between turns count toward the next one.
   * - `threadStart`: taken before the thread's first turn, for Review's thread changes.
   * - `turnFrom` and `turnTo`: where the last finished turn started and ended, for Review's last-turn
   *   changes. `turnTo` is where the next turn starts.
   */
  readonly threadStart?: string
  readonly turnFrom?: string
  readonly turnTo?: string
  /**
   * The files each turn changed, by the id of the message that started it. Claude's transcript does not
   * record them, so a restored thread reads its turns' summaries from here.
   */
  readonly turnChanges?: Readonly<Record<string, readonly ChangedFile[]>>
  /** The last context reading. A restored session is not live until its next message, so it cannot be asked. */
  readonly context?: ContextReading
  /** The branch the thread last ran on, so the tab can say when the checkout moved off it. */
  readonly branch?: string
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
  /**
   * Threads a plugin opened under a key, while no tab shows them, by project and key: the thread a tab
   * switched away from, or the one a closed tab showed. Each keeps its session, queue and summaries, so
   * opening the key again brings back the thread as it was.
   */
  readonly keyed: Readonly<Record<string, TabThread>>
  /** Each tab's plugin layout. A tab with none shows no plugin views but cards. */
  readonly layouts: Readonly<Record<string, PluginLayout>>
  /** Tabs closed lately, newest last, with what reopening one needs. */
  readonly closed: readonly ClosedTab[]
}

/** A closed tab: the tab, where it stood in the bar, and its thread and layout as they were. */
export interface ClosedTab {
  readonly tab: TabInfo
  readonly index: number
  readonly thread?: TabThread
  readonly layout?: PluginLayout
}

const windowStatePath = () => join(instanceHome(), "window.json")

/** The saved window. A missing or broken file gives an empty window, and a tab that is not whole is dropped. */
export function loadWindowState(): WindowState {
  let saved: Partial<WindowState>
  try {
    saved = JSON.parse(readFileSync(windowStatePath(), "utf8")) as Partial<WindowState>
  } catch {
    return { tabs: [], threads: {}, recent: [], keyed: {}, layouts: {}, closed: [] }
  }
  return {
    tabs: Array.isArray(saved.tabs) ? saved.tabs.filter(isTab) : [],
    ...(typeof saved.active === "string" ? { active: saved.active } : {}),
    threads: typeof saved.threads === "object" && saved.threads ? Object.fromEntries(Object.entries(saved.threads).map(([id, thread]) => [id, upgradeThread(thread)])) : {},
    recent: Array.isArray(saved.recent) ? saved.recent.filter((dir) => typeof dir === "string") : [],
    keyed: typeof saved.keyed === "object" && saved.keyed ? saved.keyed : keyedFromSessions(saved as { keys?: unknown }),
    layouts: typeof saved.layouts === "object" && saved.layouts ? saved.layouts : {},
    closed: Array.isArray(saved.closed) ? saved.closed.filter((closed) => isTab(closed?.tab) && Number.isInteger(closed.index)) : [],
  }
}

export function saveWindowState(state: WindowState) {
  writeJsonFile(windowStatePath(), state)
}

/**
 * Threads saved before checkpoints were commits held bare snapshots, under these names or under
 * `threadStart` as an object. A snapshot holds no commit to tell a pull from the turn's work, so they
 * are dropped and the thread's next turn takes a checkpoint of its own.
 */
function upgradeThread(thread: TabThread & { baseline?: unknown; turnBaseline?: unknown; turnHead?: unknown; turnStart?: unknown }): TabThread {
  const { baseline: _baseline, turnBaseline: _turnBaseline, turnHead: _turnHead, turnStart: _turnStart, threadStart, ...rest } = thread
  return { ...rest, ...(typeof threadStart === "string" ? { threadStart } : {}) }
}

/**
 * A window saved before keyed threads kept only each key's session, as `keys`. Each becomes a thread
 * with that session, so the key still resumes it.
 */
function keyedFromSessions(saved: { keys?: unknown }): Record<string, TabThread> {
  if (typeof saved.keys !== "object" || !saved.keys) return {}
  return Object.fromEntries(
    Object.entries(saved.keys as Record<string, unknown>).flatMap(([id, sessionId]) => {
      const key = id.slice(id.indexOf("\n") + 1)
      return typeof sessionId === "string" ? [[id, { key, sessionId }]] : []
    }),
  )
}

function isTab(value: unknown): value is TabInfo {
  const tab = value as Partial<TabInfo> | null
  return typeof tab?.id === "string" && typeof tab.title === "string" && typeof tab.project === "string" && Array.isArray(tab.terminals) && typeof tab.model === "string" && typeof tab.permissionMode === "string"
}
