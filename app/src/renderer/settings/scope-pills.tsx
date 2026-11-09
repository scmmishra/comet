import type { ProjectParts } from "@desk/protocol"
import { Tabs } from "@opencode/ui/tabs"
import { createEffect, createSignal, For, on } from "solid-js"
import { ProjectMark } from "../project-mark"
import { projectData, projectLabel, reloadProject } from "../projects"
import { activeProject, openProjects } from "../workspace"

/** "global", or a project's folder. */
type Scope = string
export const GLOBAL: Scope = "global"

/** Pill classes over the panel tabs' surface style, which draws no line under the list. */
const PILL = "h-7! rounded-full! text-[12px]! [&_[data-slot=tabs-trigger]]:px-3!"

/**
 * A page's scope and what Claude Code reports there, for a page with pills. The page opens on the
 * active tab's project. Global reads the same in any project, so it is read there. Opening the page
 * reads afresh. After that, a project read once stays until the page reads it again, so moving
 * between pills does not restart its servers.
 */
export function useScope<K extends "mcp" | "skills">(part: K) {
  const opened = activeProject()
  const [scope, setScope] = createSignal<Scope>(opened)
  const project = () => (scope() === GLOBAL ? opened : scope())
  createEffect(on(project, (dir, previous) => (previous === undefined || projectData(dir)[part] === undefined) && reloadProject(dir, part)))
  return { scope, setScope, project, value: (): ProjectParts[K] | undefined => projectData(project())[part] }
}

/**
 * Small pills above a page's list: Global, then each project open in a tab. A page with pills keeps
 * one subtitle for every pill, so its header keeps its height and the list below does not jump.
 */
export function ScopePills(props: { value: Scope; onChange: (scope: Scope) => void }) {
  return (
    <Tabs variant="surface" value={props.value} onChange={props.onChange}>
      <Tabs.List class="gap-1! p-0!">
        <Tabs.Trigger value={GLOBAL} class={PILL}>
          Global
        </Tabs.Trigger>
        <For each={openProjects()}>
          {(project) => (
            <Tabs.Trigger value={project} class={PILL}>
              <span class="flex items-center gap-1.5">
                <ProjectMark project={project} class="size-3.5" />
                {projectLabel(project)}
              </span>
            </Tabs.Trigger>
          )}
        </For>
      </Tabs.List>
    </Tabs>
  )
}
