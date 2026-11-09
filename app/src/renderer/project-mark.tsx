import { ProjectAvatar } from "@opencode/ui/project-avatar"
import { core } from "./core"
import { projectName } from "./format"
import { state } from "./store"

/** A project's name: the one set in Settings, else its folder's. */
export const projectLabel = (dir: string) => state.settings.projects[dir]?.name ?? projectName(dir)

/** A project's avatar, with the name, colour and icon set in Settings. Tabs use the 16px size. */
export function ProjectMark(props: { project: string; class?: string }) {
  const settings = () => state.settings.projects[props.project]
  const icon = () => settings()?.icon
  return (
    <ProjectAvatar
      fallback={projectLabel(props.project)}
      variant={settings()?.color}
      src={icon() ? core.iconUrl(props.project, icon()!) : undefined}
      class={props.class}
    />
  )
}
