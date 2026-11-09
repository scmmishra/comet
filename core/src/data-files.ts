import { createHash } from "node:crypto"
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

/** Desk's own folder, `~/.desk`. DESK_HOME moves it, for tests. */
export const deskHome = () => process.env.DESK_HOME ?? join(homedir(), ".desk")

/**
 * Where Desk keeps one kind of data for a project: `~/.desk/<kind>/<folder>-<hash>.json`, as Rune
 * names its space files. The hash keeps two checkouts with the same folder name apart.
 */
export function spaceDataPath(kind: string, dir: string): string {
  const hash = createHash("sha256").update(dir).digest("hex").slice(0, 8)
  return join(deskHome(), kind, `${basename(dir)}-${hash}.json`)
}

/** Writes through a temporary file, so a crash mid-write never leaves a broken file. */
export function writeJsonFile(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2))
  renameSync(temporary, path)
}
