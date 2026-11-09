import type { Skill } from "@desk/protocol"
import { createMemo, For, onMount, Show } from "solid-js"
import { Icon } from "../icons"
import { projectLabel } from "../project-mark"
import { activeProject, readSkills, state } from "../store"
import { SettingsHeader, SettingsList, SettingsRow, SettingsSection } from "./layout"

/** Sources in the order the page lists them. Plugins follow, by name, then anything else. */
const SOURCE_ORDER = ["project", "user", "claude.ai sync"]
const SOURCE_TITLE: Record<string, string> = { project: "Project", user: "User", "claude.ai sync": "claude.ai", other: "Other" }

/** The skills and custom commands Claude Code offers in the active tab's project, grouped by where they come from. */
export function SkillsPage() {
  // The page reads the project it opened on, so switching tabs underneath it does not swap the list.
  const project = activeProject()
  const skills = () => state.projects[project]?.skills
  onMount(() => readSkills(project))
  const groups = createMemo(() => {
    const bySource = new Map<string, Skill[]>()
    for (const skill of skills() ?? []) bySource.set(skill.source, [...(bySource.get(skill.source) ?? []), skill])
    const rank = (source: string) => {
      const known = SOURCE_ORDER.indexOf(source)
      if (known >= 0) return known
      return source === "other" ? SOURCE_ORDER.length + 1 : SOURCE_ORDER.length
    }
    return [...bySource.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
  })
  return (
    <>
      <SettingsHeader title="Skills" description={`The skills and commands Claude Code offers in ${projectLabel(project)}. Type / in a thread to use one.`} />
      <div class="settings-tab-body">
        <Show when={skills() !== undefined} fallback={<p class="text-fg-3">Reading skills…</p>}>
          <Show when={skills()} fallback={<p class="text-fg-3">Desk could not ask Claude Code for its skills.</p>}>
            <Show when={groups().length > 0} fallback={<p class="text-fg-3">Claude Code offers no skills in this project.</p>}>
              <For each={groups()}>
                {([source, list]) => (
                  <SettingsSection title={list[0]?.plugin ? `Plugin: ${source}` : (SOURCE_TITLE[source] ?? source)}>
                    <SettingsList>
                      <For each={list}>
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
                  </SettingsSection>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  )
}
