import { expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { DEFAULT_SETTINGS } from "@desk/protocol"
import { loadSettings, saveSettings, updateSettings } from "./settings"
import { tempFolder, useTempHome } from "./test-support"

useTempHome()
const settingsPath = () => join(process.env.DESK_HOME!, "settings.json")

test("starts from the defaults and keeps a change across a reload", () => {
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  const changed = updateSettings(DEFAULT_SETTINGS, { appearance: { theme: "light", colorTheme: "verdigris", fontSize: 15 }, threads: { agent: "codex" }, agent: { id: "codex", defaults: { model: "gpt-6-astra", effort: "ultra" } } })
  saveSettings(changed)
  expect(loadSettings()).toEqual({
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, theme: "light", colorTheme: "verdigris", fontSize: 15 },
    threads: { ...DEFAULT_SETTINGS.threads, agent: "codex" },
    agents: { ...DEFAULT_SETTINGS.agents, codex: { model: "gpt-6-astra", effort: "ultra", permissionMode: "auto" } },
  })
  rmSync(settingsPath())
})

test("null clears an optional field and cannot clear a required one", () => {
  const high = updateSettings(DEFAULT_SETTINGS, { agent: { id: "claude", defaults: { effort: "high" } } })
  expect(high.agents.claude.effort).toBe("high")
  expect(updateSettings(high, { agent: { id: "claude", defaults: { effort: null } } }).agents.claude).toEqual({ model: "default", permissionMode: "auto" })
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { theme: null as never } })).toThrow()
})

test("refuses values Desk cannot use", () => {
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { theme: "blue" as never } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { colorTheme: "solarized" as never } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { fontSize: 40 } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { agent: { id: "claude", defaults: { effort: " " } } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { agent: { id: "claude", defaults: { permissionMode: "plan" as never } } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { agent: { id: "cursor" as never, defaults: {} } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { threads: { agent: "cursor" as never } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { project: { dir: "/work/desk", settings: { color: "teal" as never } } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { project: { dir: "/work/desk", settings: { icon: "../secret.png" } } })).toThrow()
})

test("keeps a project's settings without blank fields", () => {
  const dir = tempFolder("project")
  const next = updateSettings(DEFAULT_SETTINGS, { project: { dir, settings: { name: " Desk ", color: "blue", icon: "./assets/logo.svg" } } })
  expect(next.projects[dir]).toEqual({ name: "Desk", color: "blue", icon: "assets/logo.svg" })
  expect(updateSettings(next, { project: { dir, settings: { name: "" } } }).projects[dir]).toEqual({})
})

test("falls back to the default for a broken saved value, of any type", () => {
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify({ appearance: { theme: "neon", fontSize: 13, uiFont: 3 }, agents: { codex: "gpt" }, threads: { agent: "cursor" }, projects: { "/work/desk": null } }))
  expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, fontSize: 13 }, projects: { "/work/desk": {} } })
  rmSync(settingsPath())
})

test("reads settings saved when Desk ran only Claude Code", () => {
  writeFileSync(settingsPath(), JSON.stringify({ claude: { model: "opus", effort: "high", permissionMode: "default", followUp: "queue", compactIdle: true } }))
  expect(loadSettings()).toEqual({
    ...DEFAULT_SETTINGS,
    threads: { agent: "claude", followUp: "queue", compactIdle: true },
    agents: { ...DEFAULT_SETTINGS.agents, claude: { model: "opus", effort: "high", permissionMode: "default" } },
  })
  rmSync(settingsPath())
})
