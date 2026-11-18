import { AGENTS, COLOR_THEMES, DEFAULT_SETTINGS, FOLLOW_UPS, FONT_SIZES, PERMISSION_MODES, PROJECT_COLORS, THEMES, type AgentDefaults, type AgentId, type AppearanceSettings, type CometSettings, type ProjectSettings, type SettingsChange, type ThreadSettings } from "@comet/protocol"
import { readFileSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"
import { cometHome, writeJsonFile } from "./data-files"
import { insideProject } from "./project-path"

/** How to read one field: whether a value is valid, how to store it, and what to tell the user when it is not. */
interface Rule {
  readonly valid: (value: unknown) => boolean
  /** Turns a valid value into what is saved. Undefined drops the field. */
  readonly clean?: (value: never) => unknown
  /** Whether null may clear the field. */
  readonly optional?: true
  readonly message: string
}

const trimmed = (value: string) => value.trim() || undefined

// Each table has a rule for every field, so a new field cannot be dropped for want of one.
const APPEARANCE: Record<keyof AppearanceSettings, Rule> = {
  theme: { valid: (value) => THEMES.includes(value as never), message: `The theme is one of ${THEMES.join(", ")}.` },
  colorTheme: { valid: (value) => COLOR_THEMES.includes(value as never), message: `The colour theme is one of ${COLOR_THEMES.join(", ")}.` },
  fontSize: {
    valid: (value) => Number.isInteger(value) && (value as number) >= FONT_SIZES.min && (value as number) <= FONT_SIZES.max,
    message: `The font size is a whole number from ${FONT_SIZES.min} to ${FONT_SIZES.max}.`,
  },
  uiFont: { valid: (value) => typeof value === "string", clean: (value: string) => value.trim(), message: "A font is a name." },
  codeFont: { valid: (value) => typeof value === "string", clean: (value: string) => value.trim(), message: "A font is a name." },
}

const THREADS: Record<keyof ThreadSettings, Rule> = {
  agent: { valid: (value) => AGENTS.includes(value as never), message: `An agent is one of ${AGENTS.join(", ")}.` },
  followUp: { valid: (value) => FOLLOW_UPS.includes(value as never), message: `A follow-up is one of ${FOLLOW_UPS.join(", ")}.` },
  compactIdle: { valid: (value) => typeof value === "boolean", message: "Compacting idle threads is on or off." },
}

const named = (value: unknown) => typeof value === "string" && !!value.trim()

// Each agent names its own models and effort levels, so Comet only checks that one is named.
const AGENT_DEFAULTS: Record<keyof AgentDefaults, Rule> = {
  model: { valid: named, clean: (value: string) => value.trim(), message: "A model is named by its value, such as opus." },
  effort: { valid: named, clean: (value: string) => value.trim(), optional: true, message: "An effort is named by its level, such as high." },
  permissionMode: { valid: (value) => PERMISSION_MODES.includes(value as never), message: `The permission mode is one of ${PERMISSION_MODES.join(", ")}.` },
}

/** A project's icon is checked against its folder, so its rules depend on the project. */
const projectRules = (dir: string): Record<keyof ProjectSettings, Rule> => ({
  name: { valid: (value) => typeof value === "string", clean: trimmed, optional: true, message: "A project name is text." },
  color: { valid: (value) => PROJECT_COLORS.includes(value as never), optional: true, message: `A project color is one of ${PROJECT_COLORS.join(", ")}.` },
  icon: {
    valid: (value) => typeof value === "string" && !isAbsolute(value) && !!insideProject(dir, value),
    clean: (value: string) => relative(dir, insideProject(dir, value)!),
    optional: true,
    message: "A project icon is a path inside the project.",
  },
})

const settingsPath = () => join(cometHome(), "settings.json")

/** Comet's settings. A missing or broken file, or a broken value in it, falls back to the default. */
export function loadSettings(): CometSettings {
  let saved: Record<string, unknown>
  try {
    saved = upgrade(section(JSON.parse(readFileSync(settingsPath(), "utf8"))))
  } catch {
    return DEFAULT_SETTINGS
  }
  const agents = section(saved.agents)
  return {
    appearance: apply(DEFAULT_SETTINGS.appearance, section(saved.appearance), APPEARANCE, false),
    threads: apply(DEFAULT_SETTINGS.threads, section(saved.threads), THREADS, false),
    agents: eachAgent((id) => apply(DEFAULT_SETTINGS.agents[id], section(agents[id]), AGENT_DEFAULTS, false)),
    projects: Object.fromEntries(Object.entries(section(saved.projects)).map(([dir, settings]) => [dir, apply({}, section(settings), projectRules(dir), false)])),
  }
}

export function saveSettings(settings: CometSettings) {
  writeJsonFile(settingsPath(), settings)
}

/** Applies a change from the app. It refuses a value Comet cannot use, so a bad one never reaches the file. */
export function updateSettings(current: CometSettings, change: SettingsChange): CometSettings {
  const projects = { ...current.projects }
  if (change.project) {
    const { dir, settings } = change.project
    if (!isAbsolute(dir)) throw new Error("A project is named by its absolute folder.")
    projects[dir] = apply<ProjectSettings>({}, section(settings), projectRules(dir), true)
  }
  return {
    appearance: change.appearance ? apply(current.appearance, section(change.appearance), APPEARANCE, true) : current.appearance,
    threads: change.threads ? apply(current.threads, section(change.threads), THREADS, true) : current.threads,
    agents: change.agent ? { ...current.agents, [agentId(change.agent.id)]: apply(current.agents[agentId(change.agent.id)], section(change.agent.defaults), AGENT_DEFAULTS, true) } : current.agents,
    projects,
  }
}

const eachAgent = <T>(make: (id: AgentId) => T) => Object.fromEntries(AGENTS.map((id) => [id, make(id)])) as Record<AgentId, T>

function agentId(id: unknown): AgentId {
  if (!AGENTS.includes(id as never)) throw new Error(THREADS.agent.message)
  return id as AgentId
}

/**
 * Settings saved when Comet ran only Claude Code kept everything about a new tab in one `claude` section.
 * Its model, effort and permission mode become Claude's defaults, and the rest become thread settings.
 */
function upgrade(saved: Record<string, unknown>): Record<string, unknown> {
  if (!("claude" in saved)) return saved
  const { claude: old, ...rest } = saved
  const { followUp, compactIdle, ...defaults } = section(old)
  return { ...rest, threads: { followUp, compactIdle, ...section(saved.threads) }, agents: { claude: defaults, ...section(saved.agents) } }
}

/**
 * Applies each field `change` names to `base`. Null clears a field. A field that is not valid throws
 * when `strict`, and keeps `base`'s value otherwise.
 */
function apply<T extends object>(base: T, change: Record<string, unknown>, rules: Record<string, Rule>, strict: boolean): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [field, rule] of Object.entries(rules)) {
    const value = change[field]
    if (value === undefined) continue
    if (value === null && rule.optional) delete out[field]
    else if (value !== null && rule.valid(value)) {
      const clean = rule.clean ? rule.clean(value as never) : value
      if (clean === undefined) delete out[field]
      else out[field] = clean
    } else if (strict) throw new Error(rule.message)
  }
  return out as T
}

/** An object's fields, or none when the value is not an object. */
function section(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
