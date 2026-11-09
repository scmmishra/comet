import { ProjectAvatar } from "@opencode/ui/project-avatar"
import { account } from "./account"
import { projectImage, projectLabel } from "./projects"

const ICON_ONLY = "[&_[data-slot=project-avatar-surface]]:bg-none! [&_[data-slot=project-avatar-surface]]:bg-transparent! [&_[data-slot=project-avatar-surface]]:shadow-none! [&_[data-slot=project-avatar-image]]:object-contain!"

/** A project's avatar, with the name, colour and icon set in Settings. Tabs use the 16px size. */
export function ProjectMark(props: { project: string; class?: string }) {
  const settings = () => account.settings.projects[props.project]
  const icon = () => settings()?.icon
  return (
    <ProjectAvatar
      fallback={projectLabel(props.project)}
      variant={settings()?.color}
      src={icon() ? projectImage(props.project, icon()!) : undefined}
      // A project's icon is often a transparent logo, which @opencode/ui would set on a coloured, outlined tile.
      // An icon shows on its own instead. The avatar's CSS sits outside the layers, so the overrides need !.
      // ProjectAvatar keys a classList by this string, and Solid throws on an empty class name, so blanks are left out.
      class={[props.class, icon() && ICON_ONLY].filter(Boolean).join(" ") || undefined}
    />
  )
}
