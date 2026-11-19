import { expect, test } from "bun:test"
import type { PluginSetting } from "@comet/protocol"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { until, useTempHome } from "../test-support"
import { missingSettings, pluginSettingValues, savePluginSetting } from "./settings"
import { harness, installPlugin, turnOn } from "./test-plugins"

useTempHome()

const SETTINGS: PluginSetting[] = [
  { key: "repo", title: "Repository", type: "string", required: true },
  { key: "base", title: "Base branch", type: "string", default: "develop" },
  { key: "drafts", title: "Show drafts", type: "boolean", default: false },
  { key: "sort", title: "Sort", type: "select", options: ["updated", "created"], default: "updated" },
]

test("saves settings checked against the manifest, and falls back to defaults", () => {
  expect(pluginSettingValues("prs", SETTINGS)).toEqual({ base: "develop", drafts: false, sort: "updated" })
  expect(missingSettings(SETTINGS, pluginSettingValues("prs", SETTINGS)).map((setting) => setting.key)).toEqual(["repo"])

  savePluginSetting("prs", SETTINGS, "repo", "chatwoot/chatwoot")
  savePluginSetting("prs", SETTINGS, "drafts", true)
  expect(pluginSettingValues("prs", SETTINGS)).toEqual({ repo: "chatwoot/chatwoot", base: "develop", drafts: true, sort: "updated" })
  expect(missingSettings(SETTINGS, pluginSettingValues("prs", SETTINGS))).toEqual([])

  expect(() => savePluginSetting("prs", SETTINGS, "sort", "oldest")).toThrow("Sort must be a value that is one of updated, created.")
  expect(() => savePluginSetting("prs", SETTINGS, "drafts", "yes")).toThrow("is true or false")
  expect(() => savePluginSetting("prs", SETTINGS, "repo", "a\nb")).toThrow("is one line")
  expect(() => savePluginSetting("prs", SETTINGS, "nope", "x")).toThrow("prs has no setting named nope")

  // Empty text clears a setting, so its default applies again.
  savePluginSetting("prs", SETTINGS, "base", "main")
  savePluginSetting("prs", SETTINGS, "base", "")
  expect(pluginSettingValues("prs", SETTINGS).base).toBe("develop")
})

test("a plugin reads its settings while setup runs, and its views redraw when one changes", async () => {
  installPlugin(
    "greeter",
    `import { definePlugin, Text } from "@comet/plugin"
export default definePlugin((comet) => {
  const first = comet.settings.get("greeting")
  comet.panel("main", { title: "Main", view: () => <Text>{first} then {comet.settings.get("greeting")}</Text> })
})
`,
  )
  const settings: PluginSetting[] = [{ key: "greeting", title: "Greeting", type: "string", default: "hello" }]
  writeFileSync(join(process.env.COMET_HOME!, "plugins", "greeter", "package.json"), JSON.stringify({ comet: { name: "greeter", api: "^0.2.0", settings } }))
  turnOn({ everywhere: ["greeter"] })
  const { plugins, layouts, layout, textOf } = harness()
  await layouts.openPanel("tab-1", "greeter.main")
  const shown = () => textOf("greeter", layout("tab-1")!.panels[0]!.root)
  await until(() => shown() === "hello then hello")
  savePluginSetting("greeter", settings, "greeting", "hi")
  await plugins.settingsChanged("greeter")
  await until(() => shown() === "hello then hi")
  plugins.stop()
}, 20_000)
