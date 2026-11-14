import type { Skill } from "@desk/protocol"
import type { CodexSkill } from "./protocol"
import type { AppServer } from "./server"

/** How Desk groups Codex's skills by where they come from. A plugin's skills group under the plugin. */
const SCOPE_GROUPS: Record<CodexSkill["scope"], string> = { repo: "Project", user: "User", system: "Codex", admin: "Admin" }
/** Groups that lead the list, in this order. Plugins follow, by name, then the rest. */
const LEADING = ["Project", "User"]

/** The skills Codex offers in a folder. Codex leaves a skill the user turned off out of a turn, so Desk leaves it out too. */
export async function readSkills(server: AppServer, dir: string): Promise<Skill[] | null> {
  try {
    const { data } = await server.request<{ data: readonly { readonly skills: readonly CodexSkill[] }[] }>("skills/list", { cwds: [dir] })
    return skillsFrom(data.flatMap((entry) => entry.skills))
  } catch {
    return null
  }
}

export function skillsFrom(found: readonly CodexSkill[]): Skill[] {
  const skills = found.filter((skill) => skill.enabled).map(skill)
  const groups = [...new Set(skills.map((one) => one.group))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return skills.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.name.localeCompare(b.name))
}

function skill(found: CodexSkill): Skill {
  // A plugin's id is its name, then "@" and its marketplace.
  const group = found.pluginId ? `Plugin: ${found.pluginId.split("@")[0]}` : SCOPE_GROUPS[found.scope]
  return { name: found.name, description: found.description, ownProject: found.scope === "repo", group, path: found.path }
}

function rank(group: string) {
  const leading = LEADING.indexOf(group)
  if (leading >= 0) return leading
  return group.startsWith("Plugin: ") ? LEADING.length : LEADING.length + 1
}
