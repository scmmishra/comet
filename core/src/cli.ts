import { resolve } from "node:path"
import { setPluginOn, whereOn } from "./plugins/config"
import type { PluginSetting, PluginSettingValue } from "@comet/protocol"
import { addPlugin, linkPlugin, listPlugins, removePlugin, updatePlugins, type PluginInfo } from "./plugins/install"
import { missingSettings, pluginSettingValues, savePluginSetting } from "./plugins/settings"

/**
 * `comet plugin …`: installs and manages plugins from the terminal. `bin/comet` runs it with the Bun in
 * Comet.app. It works on the files in `~/.comet` and never starts Comet. A running Comet sees the change
 * and reloads its plugins.
 */

const USAGE = `Usage: comet plugin <command>

  add <source> [--no-input]          Install a plugin: an npm name, github:owner/repo, a git URL, a tarball or a folder.
                                     In a terminal, it asks for the plugin's settings. --no-input skips that.
  remove <name>                      Remove a plugin Comet installed or linked, and turn it off everywhere.
  update [name…]                     Update installed plugins, all or those named.
  list                               List plugins, with their versions and where each is on.
  on <name> [--everywhere]           Turn a plugin on in this folder's project, or everywhere.
  off <name> [--everywhere]          Turn a plugin off in this folder's project, or everywhere.
  link [folder]                      Run the plugin in a folder you work in, this folder by default.
  set <name> [<key> <value>]         List a plugin's settings, or set one. An empty value clears it.

  on and off take --project <folder> to name another project.`

/** One plugin as a line of `list`: its name, title and version, how it got there, and where it is on. */
function describe(plugin: PluginInfo): string {
  const { manifest } = plugin
  const head = [plugin.name, manifest?.title && manifest.title !== plugin.name ? `(${manifest.title})` : undefined, manifest?.version].filter(Boolean).join(" ")
  const from = plugin.kind === "local" ? "made by hand" : `${plugin.kind} from ${plugin.source}`
  const where = whereOn(plugin.name)
  const on = where.everywhere ? "on everywhere" : where.projects.length ? `on in ${where.projects.join(", ")}` : "off"
  const missing = missingSettings(manifest?.settings ?? [], pluginSettingValues(plugin.name, manifest?.settings ?? []))
  return [
    `${head}`,
    `  ${from}, ${on}`,
    ...(missing.length ? [`  needs setup: ${missing.map((setting) => setting.title).join(", ")}. Run \`comet plugin set ${plugin.name}\`.`] : []),
    ...(plugin.error ? [`  cannot run: ${plugin.error}`] : []),
  ].join("\n")
}

/** A setting as typed in the terminal: true or false for a switch, as written for the rest. */
function typedValue(setting: PluginSetting, typed: string): PluginSettingValue {
  if (setting.type !== "boolean" || typed === "") return typed
  if (/^(true|yes|y|on)$/i.test(typed)) return true
  if (/^(false|no|n|off)$/i.test(typed)) return false
  throw new Error(`${setting.title} is a switch: answer yes or no.`)
}

/** A setting's value as `set` lists it. */
const shownValue = (value: PluginSettingValue | undefined) => (value === undefined ? "not set" : typeof value === "boolean" ? (value ? "yes" : "no") : JSON.stringify(value))

/** Asks for each of a plugin's settings in the terminal. Enter keeps what it has. A wrong answer asks again. */
function askSettings(name: string, settings: readonly PluginSetting[]) {
  if (settings.length === 0) return
  console.log(`${name} has settings. Press Enter to keep what is shown.`)
  for (const setting of settings) {
    const now = pluginSettingValues(name, settings)[setting.key]
    const hint = [setting.description, setting.type === "select" ? `One of ${setting.options.join(", ")}.` : undefined, setting.type === "boolean" ? "Yes or no." : undefined].filter(Boolean).join(" ")
    if (hint) console.log(`  ${hint}`)
    for (;;) {
      const typed = prompt(`${setting.title}${setting.required ? " (required)" : ""} [${shownValue(now)}]:`)?.trim()
      if (!typed) break
      try {
        savePluginSetting(name, settings, setting.key, typedValue(setting, typed))
        break
      } catch (error) {
        console.log(`  ${(error as Error).message}`)
      }
    }
  }
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
      console.log(`Installed ${added.name}${added.manifest?.version ? ` ${added.manifest.version}` : ""}.`)
      const settings = added.manifest?.settings ?? []
      // Questions need someone to answer them, so a script or a pipe gets none.
      if (process.stdin.isTTY && !args.includes("--no-input")) askSettings(added.name, settings)
      else if (settings.length) console.log(`Set its settings with \`comet plugin set ${added.name}\`.`)
      return `Turn it on with \`comet plugin on ${added.name}\`.`
    }
    case "set": {
      const name = one("the plugin whose settings to show or set")
      const found = listPlugins().find((plugin) => plugin.name === name)
      if (!found) throw new Error(`No plugin named ${name} is installed.`)
      const settings = found.manifest?.settings ?? []
      const [, key, ...words] = names
      if (!key) {
        if (!settings.length) return `${name} has no settings.`
        const values = pluginSettingValues(name, settings)
        return settings
          .map((setting) => `${setting.key}  ${setting.title}${setting.required ? " (required)" : ""}: ${shownValue(values[setting.key])}${setting.description ? `\n  ${setting.description}` : ""}`)
          .join("\n")
      }
      const setting = settings.find((found) => found.key === key)
      savePluginSetting(name, settings, key, setting ? typedValue(setting, words.join(" ")) : words.join(" "))
      return `Saved ${setting?.title ?? key} for ${name}.`
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
