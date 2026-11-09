import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DEFAULT_SETTINGS } from "@desk/protocol"
import { loadSettings, saveSettings, settingsPath, updateSettings } from "./settings"

const home = mkdtempSync(join(tmpdir(), "desk-home-"))
beforeAll(() => (process.env.DESK_HOME = home))
afterAll(() => {
  delete process.env.DESK_HOME
  rmSync(home, { recursive: true, force: true })
})

test("starts from the defaults and keeps a change across a reload", () => {
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  const changed = updateSettings(DEFAULT_SETTINGS, { appearance: { theme: "light", fontSize: 15 }, claude: { model: "opus", effort: "high" } })
  saveSettings(changed)
  expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: "light", fontSize: 15 }, claude: { model: "opus", effort: "high", compactIdle: false } })
  rmSync(settingsPath())
})

test("clears the effort when a change sets it to undefined", () => {
  const high = updateSettings(DEFAULT_SETTINGS, { claude: { effort: "high" } })
  expect(updateSettings(high, { claude: { effort: undefined } }).claude).toEqual({ model: "default", compactIdle: false })
})

test("refuses values Desk cannot use", () => {
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { theme: "blue" as never } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { appearance: { fontSize: 40 } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { claude: { effort: "huge" as never } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { project: { dir: "/work/desk", settings: { color: "teal" as never } } })).toThrow()
  expect(() => updateSettings(DEFAULT_SETTINGS, { project: { dir: "/work/desk", settings: { icon: "../secret.png" } } })).toThrow()
})

test("keeps a project's settings without blank fields", () => {
  const next = updateSettings(DEFAULT_SETTINGS, { project: { dir: "/work/desk", settings: { name: " Desk ", color: "blue", icon: "./assets/logo.svg" } } })
  expect(next.projects["/work/desk"]).toEqual({ name: "Desk", color: "blue", icon: "assets/logo.svg" })
  expect(updateSettings(next, { project: { dir: "/work/desk", settings: { name: "" } } }).projects["/work/desk"]).toEqual({})
})

test("falls back to the default for a broken saved value", () => {
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify({ appearance: { theme: "neon", fontSize: 13 } }))
  expect(loadSettings().appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, fontSize: 13 })
  rmSync(settingsPath())
})
