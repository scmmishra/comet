import type { CoreMessage, PluginListing, PluginSettingValue } from "@comet/protocol"
import { requireProjectFolder } from "../project-path"
import { setPluginOn, whereOn } from "./config"
import { addPlugin, availableUpdate, listPlugins, removePlugin, updatePlugins } from "./install"
import { missingSettings, pluginSettingValues, savePluginSetting } from "./settings"

/** How long a check for a plugin's update holds, so opening Settings again does not ask the registry each time. */
const UPDATE_CHECK_MS = 10 * 60 * 1000

/**
 * Every plugin in `~/.comet/plugins`, with where each is on, as Settings lists them. `updates` holds what each
 * plugin's last check found newer, by name.
 */
export function pluginListings(updates: ReadonlyMap<string, string | undefined> = new Map()): PluginListing[] {
  return listPlugins().map(({ name, kind, source, manifest, error }) => {
    const update = updates.get(name)
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
    ...(update ? { update } : {}),
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
  /** What each plugin's last update check found, and when it ran. A change to the plugin drops it. */
  const checked = new Map<string, { update?: string; at: number }>()
  const updates = () => new Map([...checked].map(([name, found]) => [name, found.update]))
  const listing = (): CoreMessage => ({ type: "plugins", plugins: pluginListings(updates()) })
  let checking: Promise<void> | undefined
  /** Checks installed plugins whose last check is stale, and sends the plugins again if one found something new. */
  const checkUpdates = () => {
    checking ??= (async () => {
      const stale = listPlugins().filter((plugin) => plugin.kind === "installed" && Date.now() - (checked.get(plugin.name)?.at ?? 0) > UPDATE_CHECK_MS)
      const found = await Promise.all(stale.map(async (plugin) => [plugin.name, await availableUpdate(plugin).catch(() => undefined)] as const))
      const changed = found.some(([name, update]) => checked.get(name)?.update !== update)
      for (const [name, update] of found) checked.set(name, { ...(update ? { update } : {}), at: Date.now() })
      if (changed) broadcast(listing())
    })().finally(() => (checking = undefined))
    return checking
  }
  /** Runs `change`, then says what it did. A change with nothing to say, such as a saved setting, says nothing. */
  const run = (failure: string, change: () => Promise<string | undefined> | string | undefined) => {
    queue = queue.then(async () => {
      try {
        const done = await change()
        if (done) broadcast({ type: "notice", message: done })
      } catch (error) {
        broadcast({ type: "error", message: failure, detail: error instanceof Error ? error.message : String(error) })
      }
      broadcast(listing())
    })
    return queue
  }
  return {
    /** Answers with the plugins at once, then checks for updates, which sends them again if one is new. */
    list: (reply: (message: CoreMessage) => void) => {
      reply(listing())
      void checkUpdates()
    },
    add: (source: string) => run(`Comet could not install ${source}`, async () => `Installed ${(await addPlugin(source)).name}.`),
    remove: (name: string) =>
      run(`Comet could not remove ${name}`, async () => {
        await removePlugin(name)
        checked.delete(name)
        return `Removed ${name}.`
      }),
    update: (names?: readonly string[]) =>
      run("Comet could not update the plugins", async () => {
        const updated = await updatePlugins(names)
        // What an update took is no longer newer, so those plugins are checked again on the next list.
        for (const { name } of updated) checked.delete(name)
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
