import { Tabs } from "@opencode/ui/tabs"
import { createMemo, For } from "solid-js"
import { ProjectMark, projectLabel } from "../project-mark"
import { state } from "../store"

/** "global", or a project's folder. */
export type Scope = string
export const GLOBAL: Scope = "global"

/** Pill classes over the panel tabs' surface style, which draws no line under the list. */
const PILL = "h-7! rounded-full! text-[12px]! [&_[data-slot=tabs-trigger]]:px-3!"

/** Small pills above a page's list: Global, then each project open in a tab. */
export function ScopePills(props: { value: Scope; onChange: (scope: Scope) => void }) {
  // Each project once, in the order its first tab sits.
  const projects = createMemo(() => [...new Set(state.tabs.map((tab) => tab.project))])
  return (
    <Tabs variant="surface" value={props.value} onChange={props.onChange}>
      <Tabs.List class="gap-1! p-0!">
        <Tabs.Trigger value={GLOBAL} class={PILL}>
          Global
        </Tabs.Trigger>
        <For each={projects()}>
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
