import type { PluginSetting, PluginSettingValue } from "@comet/protocol"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { cometHome, writeJsonFile } from "../data-files"
import { settingFault } from "./manifest"

/**
 * What the user set for each plugin, in `~/.comet/plugin-settings/<plugin>.json`. They live apart from the
 * plugin, so an update or a reinstall keeps them. Only settings the plugin's manifest lists are kept,
 * and each is checked against it as it is saved.
 */

export const pluginSettingsFolder = () => join(cometHome(), "plugin-settings")
/** The file that holds what the user saved for `plugin`. */
export const pluginSettingsFile = (plugin: string) => join(pluginSettingsFolder(), `${plugin}.json`)

/** What the user saved for `plugin`, as the file holds it. A broken file holds nothing. */
function saved(plugin: string): Record<string, unknown> {
  try {
    const found = JSON.parse(readFileSync(pluginSettingsFile(plugin), "utf8"))
    return typeof found === "object" && found !== null && !Array.isArray(found) ? found : {}
  } catch {
    return {}
  }
}

/**
 * Each of the plugin's settings, as the user set it or else its default. A value the manifest no longer
 * allows, such as an option a new version dropped, falls back to the default. One without either is absent.
 */
export function pluginSettingValues(plugin: string, settings: readonly PluginSetting[]): Record<string, PluginSettingValue> {
  const found = existsSync(pluginSettingsFile(plugin)) ? saved(plugin) : {}
  const values: Record<string, PluginSettingValue> = {}
  for (const setting of settings) {
    const value = found[setting.key]
    if (value !== undefined && !settingFault(setting, value)) values[setting.key] = value as PluginSettingValue
    else if (setting.default !== undefined) values[setting.key] = setting.default
  }
  return values
}

/** The required settings that have no value, or only empty text. */
export function missingSettings(settings: readonly PluginSetting[], values: Readonly<Record<string, PluginSettingValue>>): PluginSetting[] {
  return settings.filter((setting) => setting.required && (values[setting.key] === undefined || values[setting.key] === ""))
}

/** Saves one setting, checked against the manifest. An empty value clears it, so its default applies again. */
export function savePluginSetting(plugin: string, settings: readonly PluginSetting[], key: string, value: PluginSettingValue) {
  const setting = settings.find((found) => found.key === key)
  if (!setting) throw new Error(`${plugin} has no setting named ${key}. It has ${settings.map((found) => found.key).join(", ") || "none"}.`)
  const fault = value === "" ? undefined : settingFault(setting, value)
  if (fault) throw new Error(`${setting.title} must be a value that ${fault}.`)
  const next = saved(plugin)
  if (value === "") delete next[key]
  else next[key] = value
  writeJsonFile(pluginSettingsFile(plugin), next)
}

/** Whether the user saved anything for `plugin`, which outlives the plugin until it is removed with `--purge`. */
export const hasPluginSettings = (plugin: string) => existsSync(pluginSettingsFile(plugin))

/** Drops what the user saved for `plugin`, as `comet plugin remove --purge` does. */
export function forgetPluginSettings(plugin: string) {
  rmSync(pluginSettingsFile(plugin), { force: true })
}

