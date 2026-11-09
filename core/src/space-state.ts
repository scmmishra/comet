import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

/** A tab as it is saved: enough to put it back and resume its conversation. */
export interface SavedTab {
  readonly id: string
  readonly title: string
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

export interface SpaceState {
  readonly tabs: readonly SavedTab[]
  readonly active?: string
}

const EMPTY: SpaceState = { tabs: [] }

/**
 * Where a space's tabs are saved: `~/.desk/spaces/<folder>-<hash>.json`, as Rune names its space
 * files. The hash keeps two checkouts with the same folder name apart. DESK_HOME moves the folder,
 * for tests.
 */
export function spaceStatePath(dir: string): string {
  const home = process.env.DESK_HOME ?? join(homedir(), ".desk")
  const hash = createHash("sha256").update(dir).digest("hex").slice(0, 8)
  return join(home, "spaces", `${basename(dir)}-${hash}.json`)
}

export function loadSpaceState(dir: string): SpaceState {
  try {
    const parsed = JSON.parse(readFileSync(spaceStatePath(dir), "utf8")) as Partial<SpaceState>
    return { tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [], active: parsed.active }
  } catch {
    return EMPTY
  }
}

/** Writes through a temporary file, so a crash mid-write never leaves a broken file. */
export function saveSpaceState(dir: string, state: SpaceState) {
  const path = spaceStatePath(dir)
  mkdirSync(join(path, ".."), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(state, null, 2))
  renameSync(temporary, path)
}
