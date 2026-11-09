import type { Skill } from "@desk/protocol"
import { createMemo, For, Show } from "solid-js"
import { Icon } from "../icons"
import { SettingsHeader, SettingsList, SettingsRow, SettingsSection } from "./layout"
import { GLOBAL, ScopePills, useScope } from "./scope-pills"

/**
 * The skills and custom commands Claude Code offers, after OpenCode's skills list. Global lists those
 * available to all projects, grouped by where they come from. A project's pill lists the ones in that project.
 */
export function SkillsPage() {
  const { scope, setScope, value: skills } = useScope("skills")
  const own = () => skills()?.filter((skill) => skill.ownProject) ?? []
  // The core lists skills in their groups' order, so the first skill of each group places it.
  const groups = createMemo(() => {
    const byGroup = new Map<string, Skill[]>()
    for (const skill of skills() ?? []) if (!skill.ownProject) byGroup.set(skill.group, [...(byGroup.get(skill.group) ?? []), skill])
    return [...byGroup.entries()]
  })
  return (
    <>
      <SettingsHeader
        title="Skills"
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
                    {([group, list]) => (
                      <SettingsSection title={group}>
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
