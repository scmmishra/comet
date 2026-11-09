import { DEFAULT_SETTINGS, PROJECT_COLORS, type AppearanceSettings, type ClaudeSettings, type DeskSettings, type Effort, type ProjectSettings } from "@desk/protocol"
import { readFileSync } from "node:fs"
import { isAbsolute, join, normalize } from "node:path"
import { deskHome, writeJsonFile } from "./data-files"

const THEMES = ["dark", "light", "auto"] as const
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"]
/** Thread text sizes Desk allows, in px. Outside this, text either crowds or no longer fits a line. */
const MIN_FONT_SIZE = 11
const MAX_FONT_SIZE = 20

export const settingsPath = () => join(deskHome(), "settings.json")

/** Desk's settings. A missing or broken file, or a broken value in it, falls back to the default. */
export function loadSettings(): DeskSettings {
  let saved: Partial<DeskSettings> = {}
  try {
    saved = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<DeskSettings>
  } catch {
    return DEFAULT_SETTINGS
  }
  return {
    appearance: appearance(DEFAULT_SETTINGS.appearance, saved.appearance ?? {}),
    claude: claude(DEFAULT_SETTINGS.claude, saved.claude ?? {}),
    projects: Object.fromEntries(Object.entries(saved.projects ?? {}).map(([dir, settings]) => [dir, project(settings)])),
  }
}

export function saveSettings(settings: DeskSettings) {
  writeJsonFile(settingsPath(), settings)
}

/** Applies a change from the app. It refuses a value Desk cannot use, so a bad one never reaches the file. */
export function updateSettings(
  current: DeskSettings,
  change: { appearance?: Partial<AppearanceSettings>; claude?: Partial<ClaudeSettings>; project?: { dir: string; settings: ProjectSettings } },
): DeskSettings {
  const projects = { ...current.projects }
  if (change.project) {
    if (!isAbsolute(change.project.dir)) throw new Error("A project is named by its absolute folder.")
    projects[change.project.dir] = project(change.project.settings, true)
  }
  return {
    appearance: change.appearance ? appearance(current.appearance, change.appearance, true) : current.appearance,
    claude: change.claude ? claude(current.claude, change.claude, true) : current.claude,
    projects,
  }
}

/** Reads each field it is given. A field that is not valid throws when `strict`, and keeps `base`'s value otherwise. */
function appearance(base: AppearanceSettings, change: Partial<AppearanceSettings>, strict = false): AppearanceSettings {
  const check = <T>(ok: boolean, value: T, fallback: T, message: string) => {
    if (ok) return value
    if (strict) throw new Error(message)
    return fallback
  }
  return {
    theme: change.theme === undefined ? base.theme : check(THEMES.includes(change.theme), change.theme, base.theme, "The theme is dark, light or auto."),
    fontSize:
      change.fontSize === undefined
        ? base.fontSize
        : check(Number.isInteger(change.fontSize) && change.fontSize >= MIN_FONT_SIZE && change.fontSize <= MAX_FONT_SIZE, change.fontSize, base.fontSize, `The font size is a whole number from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}.`),
    uiFont: change.uiFont === undefined ? base.uiFont : check(typeof change.uiFont === "string", change.uiFont.trim(), base.uiFont, "A font is a name."),
    codeFont: change.codeFont === undefined ? base.codeFont : check(typeof change.codeFont === "string", change.codeFont.trim(), base.codeFont, "A font is a name."),
  }
}

function claude(base: ClaudeSettings, change: Partial<ClaudeSettings>, strict = false): ClaudeSettings {
  const fail = (message: string) => {
    if (strict) throw new Error(message)
  }
  let { model, effort, compactIdle } = base
  if (change.model !== undefined) {
    if (typeof change.model === "string" && change.model.trim()) model = change.model.trim()
    else fail("A model is named by its value, such as opus.")
  }
  if ("effort" in change) {
    if (change.effort === undefined || EFFORTS.includes(change.effort)) effort = change.effort
    else fail("The effort is low, medium, high, xhigh or max.")
  }
  if (change.compactIdle !== undefined) {
    if (typeof change.compactIdle === "boolean") compactIdle = change.compactIdle
    else fail("Compacting idle threads is on or off.")
  }
  return effort ? { model, effort, compactIdle } : { model, compactIdle }
}

/** A project's settings, with blank fields dropped. An icon must stay inside the project's folder. */
function project(settings: ProjectSettings, strict = false): ProjectSettings {
  const fail = (message: string) => {
    if (strict) throw new Error(message)
  }
  const out: { name?: string; color?: ProjectSettings["color"]; icon?: string } = {}
  if (typeof settings.name === "string" && settings.name.trim()) out.name = settings.name.trim()
  if (settings.color !== undefined) {
    if (PROJECT_COLORS.includes(settings.color)) out.color = settings.color
    else fail(`A project color is one of ${PROJECT_COLORS.join(", ")}.`)
  }
  if (typeof settings.icon === "string" && settings.icon) {
    const icon = normalize(settings.icon)
    if (!isAbsolute(icon) && !icon.startsWith("..")) out.icon = icon
    else fail("A project icon is a path inside the project.")
  }
  return out
}
