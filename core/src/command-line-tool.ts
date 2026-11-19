import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Comet.app carries the `comet` command in `Contents/Resources/bin`, next to the core's folder. A Comet installed
 * from a release runs no install script, so the core links the command onto the PATH itself when it starts.
 */

/** Where the `comet` command goes: a folder on many PATHs that needs no admin password to write. */
export const commandFolder = () => join(homedir(), ".local", "bin")

/** The command this core's Comet.app carries, or undefined for a core run from the repo, which links nothing. */
export function bundledCommand(coreFolder = import.meta.dir): string | undefined {
  // The core runs from Contents/Resources/core/core/src in the app, as `scripts/package.sh` lays it out.
  const resources = coreFolder.match(/^(.*\.app\/Contents\/Resources)\/core\/core\/src$/)?.[1]
  return resources ? join(resources, "bin", "comet") : undefined
}

/**
 * Links `folder/comet` to `command`, when nothing is there or a link there points to something gone, such as an
 * app since moved. A working `comet` stays, whether the user's own or another copy of Comet's, so a Comet opened
 * once from Downloads does not take the command. Answers whether it linked.
 */
export function linkCommand(command: string, folder = commandFolder()): boolean {
  const link = join(folder, "comet")
  const found = lstatSync(link, { throwIfNoEntry: false })
  // existsSync follows the link, so it is false for one whose target is gone.
  if (found && !(found.isSymbolicLink() && !existsSync(link))) return false
  mkdirSync(folder, { recursive: true })
  if (found) unlinkSync(link)
  symlinkSync(command, link)
  return true
}
