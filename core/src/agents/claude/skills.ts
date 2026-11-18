import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk"
import type { Skill } from "@comet/protocol"
import { probe } from "./probe"
import { withFiles } from "./skill-files"

/** Claude Code ends a description with where the skill comes from, such as " (user)". */
const SOURCE_SUFFIX = /\s*\(([^()]+)\)\s*$/
/** A plugin's skill starts with the plugin's name instead, such as "(figma) ". */
const PLUGIN_PREFIX = /^\(([^()]+)\)\s*/
/** Claude Code marks a skill in the project's .claude folder with this source. */
const PROJECT_SOURCE = "project"
/** Groups of skills available to every project, in the order they list. Plugins follow, by name, then other sources, then Other. */
const SOURCE_GROUPS: Record<string, string> = { user: "User", "claude.ai sync": "claude.ai" }
const OTHER = "Other"
/** The group of Claude Code's own commands, which lead the list. */
const BUILT_IN = "Claude Code"

/** The commands Claude Code offers in a project, grouped: its own, then skills and custom commands. */
export async function readSkills(dir: string): Promise<Skill[] | null> {
  const commands = await probe(dir, (running) => running.supportedCommands())
  return commands ? withFiles(dir, skillsFrom(commands)) : null
}

/** Claude Code's commands as Comet lists them, in their groups' order. */
export function skillsFrom(commands: readonly SlashCommand[]): Skill[] {
  const skills = commands.map(skill)
  const groups = [...new Set(skills.map((found) => found.group))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return skills.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group))
}

/** A command as Comet lists it, with the source Claude Code marks in its description moved out of it. */
function skill(command: SlashCommand): Skill {
  const hint = command.argumentHint ? { argumentHint: command.argumentHint } : {}
  if (command.builtin) return { name: command.name, description: command.description, ...hint, builtin: true, ownProject: false, group: BUILT_IN }
  const plugin = PLUGIN_PREFIX.exec(command.description)
  if (plugin) return { name: command.name, description: command.description.slice(plugin[0].length), ...hint, ownProject: false, group: `Plugin: ${plugin[1]}` }
  const source = SOURCE_SUFFIX.exec(command.description)
  const description = source ? command.description.slice(0, source.index) : command.description
  const from = source?.[1]
  return { name: command.name, description, ...hint, ownProject: from === PROJECT_SOURCE, group: from ? (SOURCE_GROUPS[from] ?? from) : OTHER }
}

function rank(group: string) {
  if (group === BUILT_IN) return -1
  const known = Object.values(SOURCE_GROUPS).indexOf(group)
  if (known >= 0) return known
  if (group.startsWith("Plugin: ")) return 10
  return group === OTHER ? 30 : 20
}
