import { mkdirSync, watch } from "node:fs"
import { join } from "node:path"
import { cometHome } from "../data-files"
import { packagesFolder } from "./install"
import { pluginSettingsFolder } from "./settings"

/** How long changes settle before the plugins reload, so one install reloads them once. */
const SETTLE_MS = 300

/**
 * Calls `changed` when a plugin is installed, updated, linked, removed, or turned on or off, such as by
 * `comet plugin` while Comet runs: when an entry in `~/.comet/plugins` comes or goes, the packages'
 * lockfile changes, or `plugins.json` does. An edit inside a plugin's folder does not count. Returns a
 * function that stops watching.
 */
export function watchInstalls(changed: () => void): () => void {
  const plugins = join(cometHome(), "plugins")
  for (const folder of [plugins, packagesFolder()]) mkdirSync(folder, { recursive: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const settle = () => {
    clearTimeout(timer)
    timer = setTimeout(changed, SETTLE_MS)
  }
  const watchers = [watch(plugins, settle), watch(packagesFolder(), (_, file) => file === "bun.lock" && settle()), watch(cometHome(), (_, file) => file === "plugins.json" && settle())]
  return () => {
    clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}

/**
 * Calls `changed` with a plugin's name when its settings file changes, such as when Settings or `comet plugin
 * set` saves one. The plugin hears its settings without a reload. Returns a function that stops watching.
 */
export function watchSettings(changed: (plugin: string) => void): () => void {
  mkdirSync(pluginSettingsFolder(), { recursive: true })
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const watcher = watch(pluginSettingsFolder(), (_, file) => {
    const plugin = file?.endsWith(".json") ? file.slice(0, -".json".length) : undefined
    if (!plugin) return
    clearTimeout(pending.get(plugin))
    pending.set(plugin, setTimeout(() => changed(plugin), SETTLE_MS))
  })
  return () => {
    for (const timer of pending.values()) clearTimeout(timer)
    watcher.close()
  }
}
