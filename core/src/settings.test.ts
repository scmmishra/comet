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
  const changed = updateSettings(DEFAULT_SETTINGS, { appearance: { theme: "light", fontSize: 15 }, claude: { model: "opus", effort: "high" } })
  saveSettings(changed)
  expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: "light", fontSize: 15 }, claude: { model: "opus", effort: "high", permissionMode: "auto", compactIdle: false } })
  rmSync(settingsPath())
})

test("null clears an optional field and cannot clear a required one", () => {
  const high = updateSettings(DEFAULT_SETTINGS, { claude: { effort: "high" } })
  expect(updateSettings(high, { claude: { effort: null } }).claude).toEqual({ model: "default", permissionMode: "auto", compactIdle: false })
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { theme: null as never } })).toThrow()
})

test("refuses values Desk cannot use", () => {
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { theme: "blue" as never } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { fontSize: 40 } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { claude: { effort: "huge" as never } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { claude: { permissionMode: "plan" as never } })).toThrow()
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
  writeFileSync(settingsPath(), JSON.stringify({ appearance: { theme: "neon", fontSize: 13, uiFont: 3 }, claude: "opus", projects: { "/work/desk": null } }))
  expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, fontSize: 13 }, projects: { "/work/desk": {} } })
  rmSync(settingsPath())
})
