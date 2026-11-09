import type { Skill } from "@desk/protocol"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { Icon } from "../icons"
import { activeProject, readSkills, state } from "../store"
import { SettingsHeader, SettingsList, SettingsRow, SettingsSection } from "./layout"
import { GLOBAL, ScopePills, type Scope } from "./scope-pills"

/** Global sources in the order the page lists them. Plugins follow, by name, then anything else. */
const SOURCE_ORDER = ["user", "claude.ai sync"]
const SOURCE_TITLE: Record<string, string> = { user: "User", "claude.ai sync": "claude.ai", other: "Other" }
/** Claude Code marks a skill in the project's .claude folder with this source. */
const PROJECT_SOURCE = "project"

/**
 * The skills and custom commands Claude Code offers, after OpenCode's skills list. Global lists those
 * available to all projects, grouped by where they come from. A project's pill lists the ones in that project.
 */
export function SkillsPage() {
  // The page opens on the active tab's project. Global skills read the same in any project, so they are read there.
  const opened = activeProject()
  const [scope, setScope] = createSignal<Scope>(opened)
  const project = () => (scope() === GLOBAL ? opened : scope())
  const skills = () => state.projects[project()]?.skills
  // Opening the page reads afresh. After that, a project read once stays until it opens again.
  createEffect(on(project, (dir, previous) => (previous === undefined || state.projects[dir]?.skills === undefined) && readSkills(dir)))
  const own = () => skills()?.filter((skill) => skill.source === PROJECT_SOURCE) ?? []
  const groups = createMemo(() => {
    const bySource = new Map<string, Skill[]>()
    for (const skill of skills() ?? []) if (skill.source !== PROJECT_SOURCE) bySource.set(skill.source, [...(bySource.get(skill.source) ?? []), skill])
    const rank = (source: string) => {
      const known = SOURCE_ORDER.indexOf(source)
      if (known >= 0) return known
      return source === "other" ? SOURCE_ORDER.length + 1 : SOURCE_ORDER.length
    }
    return [...bySource.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
  })
  return (
    <>
      <SettingsHeader
        title="Skills"
        // One subtitle for every pill, so the header keeps its height and the list below does not jump.
        description="The skills and commands Claude Code offers. Type / in a thread to use one."
      />
      <div class="settings-tab-body">
        <ScopePills value={scope()} onChange={setScope} />
        <Show when={skills() !== undefined} fallback={<p class="text-fg-3">Reading skills…</p>}>
          <Show when={skills() !== null} fallback={<p class="text-fg-3">Desk could not ask Claude Code for its skills.</p>}>
            <Show
              when={scope() !== GLOBAL}
              fallback={
                <Show when={groups().length > 0} fallback={<p class="text-fg-3">No skills are available to all projects.</p>}>
                  <For each={groups()}>
                    {([source, list]) => (
                      <SettingsSection title={list[0]?.plugin ? `Plugin: ${source}` : (SOURCE_TITLE[source] ?? source)}>
                        <SkillList skills={list} />
                      </SettingsSection>
                    )}
                  </For>
                </Show>
              }
            >
              <Show when={own().length > 0} fallback={<p class="text-fg-3">This project has no skills of its own. Add one under its .claude/skills folder.</p>}>
                <SkillList skills={own()} />
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  )
}

function SkillList(props: { skills: readonly Skill[] }) {
  return (
    <SettingsList>
      <For each={props.skills}>
        {(skill) => (
          <SettingsRow
            title={
              <span class="flex items-center gap-2">
                <Icon name="post-skill" class="text-fg-3" />
                <span class="font-mono text-[12px]">/{skill.name}</span>
              </span>
            }
            description={<span class="line-clamp-2">{skill.description}</span>}
          />
        )}
      </For>
    </SettingsList>
  )
}
