import type { Skill } from "@desk/protocol"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { configDir } from "./config-dir"

/** How `skillsFrom` names a plugin's group. */
const PLUGIN_GROUP = "Plugin: "

/**
 * Each skill with the file that defines it, where Claude Code keeps it: a skill's SKILL.md or a command's
 * Markdown file, in the project's .claude folder, the user's, or the plugin's install folder. Claude Code
 * does not say where a skill lives, so Desk looks. A skill synced from claude.ai, or one Desk does not
 * find, has no file. Claude Code's own commands have none.
 */
export function withFiles(dir: string, skills: readonly Skill[], root = configDir()): Skill[] {
  const plugins = installedPlugins(root)
  return skills.map((skill) => {
    if (skill.builtin) return skill
    const path = candidates(dir, skill, root, plugins).find((file) => existsSync(file))
    return path ? { ...skill, path } : skill
  })
}

function candidates(dir: string, skill: Skill, root: string, plugins: ReadonlyMap<string, string>): string[] {
  if (skill.group.startsWith(PLUGIN_GROUP)) {
    const plugin = skill.group.slice(PLUGIN_GROUP.length)
    const base = plugins.get(plugin)
    const name = skill.name.startsWith(`${plugin}:`) ? skill.name.slice(plugin.length + 1) : skill.name
    return base ? inFolder(base, name) : []
  }
  return [join(dir, ".claude"), root].flatMap((folder) => inFolder(folder, skill.name))
}

/** A skill's SKILL.md, then a command's file. A command in a subfolder is named with a colon, such as "frontend:component". */
function inFolder(folder: string, name: string) {
  return [join(folder, "skills", name, "SKILL.md"), join(folder, "commands", `${name.replaceAll(":", "/")}.md`)]
}

/** Each installed plugin's folder, by the plugin's name, from Claude Code's list of them. */
function installedPlugins(root: string): Map<string, string> {
  try {
    const list = JSON.parse(readFileSync(join(root, "plugins", "installed_plugins.json"), "utf8")) as { plugins?: Record<string, readonly { installPath?: string }[]> }
    // A plugin is listed as its name, then "@" and its marketplace.
    return new Map(Object.entries(list.plugins ?? {}).flatMap(([id, installs]) => (installs[0]?.installPath ? [[id.split("@")[0]!, installs[0].installPath] as const] : [])))
  } catch {
    return new Map()
  }
}
