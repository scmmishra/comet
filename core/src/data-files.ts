import { createHash } from "node:crypto"
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

/** Comet's own folder, `~/.comet`. COMET_HOME moves it, for tests. */
export const cometHome = () => process.env.COMET_HOME ?? join(homedir(), ".comet")

/**
 * Where one running Comet keeps what only it may write: its window and its plugin builds. Settings,
 * commands and plugins stay in `~/.comet` for every Comet. A dev Comet sets COMET_INSTANCE to `dev` and
 * keeps its own in `~/.comet/dev`, so it runs beside the installed Comet without overwriting its tabs.
 */
export const instanceHome = () => (process.env.COMET_INSTANCE ? join(cometHome(), process.env.COMET_INSTANCE) : cometHome())

/** The running Comet's name: `dev` for a dev Comet, else `main`. */
export const instanceName = () => process.env.COMET_INSTANCE ?? "main"

/**
 * Where Comet keeps one kind of data for a project: `~/.comet/<kind>/<folder>-<hash>.json`, as Rune
 * names its space files. The hash keeps two checkouts with the same folder name apart.
 */
export function projectDataPath(kind: string, dir: string): string {
  const hash = createHash("sha256").update(dir).digest("hex").slice(0, 8)
  return join(cometHome(), kind, `${basename(dir)}-${hash}.json`)
}

/** Writes through a temporary file, so a crash mid-write never leaves a broken file. */
export function writeJsonFile(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2))
  renameSync(temporary, path)
}
