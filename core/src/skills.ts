import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk"
import type { Skill } from "@desk/protocol"
import { probe } from "./probe"

/** Claude Code ends a description with where the skill comes from, such as " (user)". */
const SOURCE_SUFFIX = /\s*\(([^()]+)\)\s*$/
/** A plugin's skill starts with the plugin's name instead, such as "(figma) ". */
const PLUGIN_PREFIX = /^\(([^()]+)\)\s*/

/** The skills and custom commands Claude Code offers in a project. Its own built-in commands are left out. */
export async function readSkills(dir: string): Promise<Skill[] | undefined> {
  const commands = await probe(dir, (running) => running.supportedCommands())
  return commands?.filter((command) => !command.builtin).map(skill)
}

/** A command as Desk lists it, with the source Claude Code marks in its description moved out of it. */
export function skill(command: SlashCommand): Skill {
  const plugin = PLUGIN_PREFIX.exec(command.description)
  if (plugin) return { name: command.name, description: command.description.slice(plugin[0].length), source: plugin[1]!, plugin: true }
  const source = SOURCE_SUFFIX.exec(command.description)
  if (source) return { name: command.name, description: command.description.slice(0, source.index), source: source[1]! }
  return { name: command.name, description: command.description, source: "other" }
}
