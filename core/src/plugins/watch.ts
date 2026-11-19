import { mkdirSync, watch } from "node:fs"
import { join } from "node:path"
import { cometHome } from "../data-files"
import { packagesFolder } from "./install"

/** How long changes settle before the plugins reload, so one install reloads them once. */
const SETTLE_MS = 300

/**
 * Calls `changed` when a plugin is installed, updated, linked or removed, such as by `comet plugin` while
 * Comet runs: when an entry in `~/.comet/plugins` comes or goes, or the packages' lockfile changes. An
 * edit inside a plugin's folder does not count. Returns a function that stops watching.
 */
export function watchInstalls(changed: () => void): () => void {
  const plugins = join(cometHome(), "plugins")
  for (const folder of [plugins, packagesFolder()]) mkdirSync(folder, { recursive: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const settle = () => {
    clearTimeout(timer)
    timer = setTimeout(changed, SETTLE_MS)
  }
  const watchers = [watch(plugins, settle), watch(packagesFolder(), (_, file) => file === "bun.lock" && settle())]
  return () => {
    clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}
