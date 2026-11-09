import { Tabs } from "@opencode/ui/tabs"
import { createMemo, For } from "solid-js"
import { ProjectMark, projectLabel } from "../project-mark"
import { state } from "../store"

/** "global", or a project's folder. */
export type Scope = string
export const GLOBAL: Scope = "global"

/** Small pills above a page's list: Global, then each project open in a tab, after OpenCode's pill tabs. */
export function ScopePills(props: { value: Scope; onChange: (scope: Scope) => void }) {
  // Each project once, in the order its first tab sits.
  const projects = createMemo(() => [...new Set(state.tabs.map((tab) => tab.project))])
  return (
    <Tabs variant="pill" value={props.value} onChange={props.onChange}>
      <Tabs.List>
        <Tabs.Trigger value={GLOBAL}>Global</Tabs.Trigger>
        <For each={projects()}>
          {(project) => (
            <Tabs.Trigger value={project}>
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
