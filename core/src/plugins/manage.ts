import type { CoreMessage, PluginListing } from "@comet/protocol"
import { requireProjectFolder } from "../project-path"
import { setPluginOn, whereOn } from "./config"
import type { PluginSettingValue } from "@comet/protocol"
import { addPlugin, listPlugins, removePlugin, updatePlugins } from "./install"
import { missingSettings, pluginSettingValues, savePluginSetting } from "./settings"

/** Every plugin in `~/.comet/plugins`, with where each is on, as Settings lists them. */
export function pluginListings(): PluginListing[] {
  return listPlugins().map(({ name, kind, source, manifest, error }) => {
    const settings = manifest?.settings ?? []
    const values = pluginSettingValues(name, settings)
    return {
    name,
    kind,
    ...(source ? { source } : {}),
    ...(manifest?.title ? { title: manifest.title } : {}),
    ...(manifest?.version ? { version: manifest.version } : {}),
    ...(manifest?.description ? { description: manifest.description } : {}),
    ...(error ? { error } : {}),
    ...whereOn(name),
    settings,
    values,
    missing: missingSettings(settings, values).map((setting) => setting.key),
    }
  })
}

/**
 * The changes Settings makes to plugins. They run one at a time, since each runs Bun in one folder. Each
 * tells every client what it did, or why it failed, then sends the plugins whole. A running Comet reloads
 * its plugins when the files change, so nothing here reloads them.
 */
export function pluginManager(broadcast: (message: CoreMessage) => void) {
  let queue = Promise.resolve()
  /** Runs `change`, then says what it did. A change with nothing to say, such as a saved setting, says nothing. */
  const run = (failure: string, change: () => Promise<string | undefined> | string | undefined) => {
    queue = queue.then(async () => {
      try {
        const done = await change()
        if (done) broadcast({ type: "notice", message: done })
      } catch (error) {
        broadcast({ type: "error", message: failure, detail: error instanceof Error ? error.message : String(error) })
      }
      broadcast({ type: "plugins", plugins: pluginListings() })
    })
    return queue
  }
  return {
    add: (source: string) => run(`Comet could not install ${source}`, async () => `Installed ${(await addPlugin(source)).name}.`),
    remove: (name: string) =>
      run(`Comet could not remove ${name}`, async () => {
        await removePlugin(name)
        return `Removed ${name}.`
      }),
    update: (names?: readonly string[]) =>
      run("Comet could not update the plugins", async () => {
        const updated = await updatePlugins(names)
        const changed = updated.filter(({ from, to }) => from !== to)
        return changed.length ? `Updated ${changed.map(({ name, to }) => `${name} to ${to}`).join(", ")}.` : "The plugins are up to date."
      }),
    // A running plugin hears the saved setting from the settings watcher, as it would from `comet plugin set`.
    setting: (name: string, key: string, value: PluginSettingValue) =>
      run(`Comet could not save ${key} for ${name}`, () => {
        const plugin = listPlugins().find((found) => found.name === name)
        if (!plugin) throw new Error(`No plugin named ${name} is installed.`)
        savePluginSetting(name, plugin.manifest?.settings ?? [], key, value)
        return undefined
      }),
    toggle: (name: string, on: boolean, project?: string) =>
      run(`Comet could not turn ${name} ${on ? "on" : "off"}`, () => {
        // A project that is gone can still be turned off.
        if (on && project !== undefined) requireProjectFolder(project)
        setPluginOn(name, on, project)
        return `${name} is ${on ? "on" : "off"} ${project ? `in ${project}` : "everywhere"}.`
      }),
  }
}
