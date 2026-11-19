import { resolve } from "node:path"
import { setPluginOn, whereOn } from "./plugins/config"
import { addPlugin, linkPlugin, listPlugins, removePlugin, updatePlugins, type PluginInfo } from "./plugins/install"

/**
 * `comet plugin …`: installs and manages plugins from the terminal. `bin/comet` runs it with the Bun in
 * Comet.app. It works on the files in `~/.comet` and never starts Comet. A running Comet sees the change
 * and reloads its plugins.
 */

const USAGE = `Usage: comet plugin <command>

  add <source>                       Install a plugin: an npm name, github:owner/repo, a git URL, a tarball or a folder.
  remove <name>                      Remove a plugin Comet installed or linked, and turn it off everywhere.
  update [name…]                     Update installed plugins, all or those named.
  list                               List plugins, with their versions and where each is on.
  on <name> [--everywhere]           Turn a plugin on in this folder's project, or everywhere.
  off <name> [--everywhere]          Turn a plugin off in this folder's project, or everywhere.
  link [folder]                      Run the plugin in a folder you work in, this folder by default.

  on and off take --project <folder> to name another project.`

/** One plugin as a line of `list`: its name, title and version, how it got there, and where it is on. */
function describe(plugin: PluginInfo): string {
  const { manifest } = plugin
  const head = [plugin.name, manifest?.title && manifest.title !== plugin.name ? `(${manifest.title})` : undefined, manifest?.version].filter(Boolean).join(" ")
  const from = plugin.kind === "local" ? "made by hand" : `${plugin.kind} from ${plugin.source}`
  const where = whereOn(plugin.name)
  const on = where.everywhere ? "on everywhere" : where.projects.length ? `on in ${where.projects.join(", ")}` : "off"
  return [`${head}`, `  ${from}, ${on}`, ...(plugin.error ? [`  cannot run: ${plugin.error}`] : [])].join("\n")
}

/** The project `on` and `off` name: `--project <folder>`, else the folder the command runs in, or none for `--everywhere`. */
function projectOf(args: string[]): string | undefined {
  if (args.includes("--everywhere")) return undefined
  const at = args.indexOf("--project")
  return resolve(at >= 0 && args[at + 1] ? args[at + 1]! : here())
}

/**
 * The folder the command runs in, as the shell names it. `process.cwd()` resolves links, such as /tmp to
 * /private/tmp, and `comet .` opens the folder as the shell names it, so the two would not match.
 */
const here = () => process.env.PWD ?? process.cwd()

async function plugin([command, ...args]: string[]): Promise<string> {
  // The words that are not flags, and not the folder after --project.
  const names = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--project")
  const one = (what: string) => {
    if (!names[0]) throw new Error(`Name ${what}.\n\n${USAGE}`)
    return names[0]
  }
  switch (command) {
    case "add": {
      const added = await addPlugin(one("what to install"))
      return `Installed ${added.name}${added.manifest?.version ? ` ${added.manifest.version}` : ""}. Turn it on with \`comet plugin on ${added.name}\`.`
    }
    case "remove": {
      const name = one("the plugin to remove")
      await removePlugin(name)
      return `Removed ${name}.`
    }
    case "update": {
      const updated = await updatePlugins(names.length ? names : undefined)
      if (updated.length === 0) return "No plugin was installed by Comet, so none was updated."
      return updated.map(({ name, from, to }) => (from === to ? `${name} is up to date${to ? ` at ${to}` : ""}.` : `${name}: ${from ?? "?"} → ${to ?? "?"}`)).join("\n")
    }
    case "list": {
      const plugins = listPlugins()
      return plugins.length ? plugins.map(describe).join("\n") : "No plugins. Install one with `comet plugin add <source>`."
    }
    case "on":
    case "off": {
      const name = one(`the plugin to turn ${command}`)
      if (!listPlugins().some((found) => found.name === name)) throw new Error(`No plugin named ${name} is installed.`)
      const project = projectOf(args)
      setPluginOn(name, command === "on", project)
      return `${name} is ${command} ${project ? `in ${project}` : "everywhere"}.`
    }
    case "link": {
      const linked = linkPlugin(names[0] ?? here())
      return `Linked ${linked.name} to ${linked.source}. Turn it on with \`comet plugin on ${linked.name}\`.`
    }
    default:
      return USAGE
  }
}

const [group, ...rest] = process.argv.slice(2)
try {
  if (group !== "plugin") throw new Error(USAGE)
  console.log(await plugin(rest))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
