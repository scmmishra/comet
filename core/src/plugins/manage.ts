import type { CoreMessage, PluginListing } from "@comet/protocol"
import { setPluginOn, whereOn } from "./config"
import { addPlugin, listPlugins, removePlugin, updatePlugins } from "./install"

/** Every plugin in `~/.comet/plugins`, with where each is on, as Settings lists them. */
export function pluginListings(): PluginListing[] {
  return listPlugins().map(({ name, kind, source, manifest, error }) => ({
    name,
    kind,
    ...(source ? { source } : {}),
    ...(manifest?.title ? { title: manifest.title } : {}),
    ...(manifest?.version ? { version: manifest.version } : {}),
    ...(manifest?.description ? { description: manifest.description } : {}),
    ...(error ? { error } : {}),
    ...whereOn(name),
  }))
}

/**
 * The changes Settings makes to plugins. They run one at a time, since each runs Bun in one folder. Each
 * tells every client what it did, or why it failed, then sends the plugins whole. A running Comet reloads
 * its plugins when the files change, so nothing here reloads them.
 */
export function pluginManager(broadcast: (message: CoreMessage) => void) {
  let queue = Promise.resolve()
  const run = (failure: string, change: () => Promise<string> | string) => {
    queue = queue.then(async () => {
      try {
        broadcast({ type: "notice", message: await change() })
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
    toggle: (name: string, on: boolean, project?: string) =>
      run(`Comet could not turn ${name} ${on ? "on" : "off"}`, () => {
        setPluginOn(name, on, project)
        return `${name} is ${on ? "on" : "off"} ${project ? `in ${project}` : "everywhere"}.`
      }),
  }
}
