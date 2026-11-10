import { PERMISSION_MODES, type Effort, type ModelOption, type PermissionMode } from "@desk/protocol"
import type { IconName } from "./icons"

export const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }

/**
 * Aliases such as "opus" follow the newest model of a family, so they lead the list. Pinned
 * models, such as "claude-opus-4-8", wait behind "Show older models".
 */
export const isAlias = (option: ModelOption) => !option.value.startsWith("claude-")

/** The effort a model keeps when it becomes the model: the chosen one if it takes it, else its default. */
export const effortFor = (option: ModelOption, effort: Effort | undefined) => (effort && option.efforts.includes(effort) ? effort : undefined)

/** Permission modes, in T3 Code's words and order. */
export const PERMISSION: Record<PermissionMode, { label: string; description: string; icon: IconName }> = {
  default: { label: "Supervised", description: "Asks before commands and file changes.", icon: "lock" },
  acceptEdits: { label: "Auto-accept edits", description: "Makes edits, and asks before anything else.", icon: "edit" },
  auto: { label: "Auto", description: "Approves routine actions, asks about the rest.", icon: "sparkle" },
  bypassPermissions: { label: "Full access", description: "Edits and runs commands without asking.", icon: "shield-off" },
}

/** The permission modes a model takes. Auto needs a model that supports it. */
export const permissionModes = (option: ModelOption | undefined) => PERMISSION_MODES.filter((mode) => mode !== "auto" || !!option?.autoMode)

/** The permission mode a model keeps when it becomes the model: the chosen one if it takes it, else Supervised. */
export const permissionFor = (option: ModelOption | undefined, mode: PermissionMode) => (permissionModes(option).includes(mode) ? mode : "default")

/** "claude-opus-5-5" → "Opus 5.5". Unknown ids pass through unchanged. */
export function modelLabel(id: string) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d))?/.exec(id)
  if (!match) return id
  const [, family, major, minor] = match
  return `${family!.charAt(0).toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ""}`
}
