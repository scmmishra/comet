import type { Effort, ModelOption } from "@desk/protocol"

export const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }

/**
 * Aliases such as "opus" follow the newest model of a family, so they lead the list. Pinned
 * models, such as "claude-opus-4-8", wait behind "Show older models".
 */
export const isAlias = (option: ModelOption) => !option.value.startsWith("claude-")

/** The effort a model keeps when it becomes the model: the chosen one if it takes it, else its default. */
export const effortFor = (option: ModelOption, effort: Effort | undefined) => (effort && option.efforts.includes(effort) ? effort : undefined)

/** "claude-opus-5-5" → "Opus 5.5". Unknown ids pass through unchanged. */
export function modelLabel(id: string) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d))?/.exec(id)
  if (!match) return id
  const [, family, major, minor] = match
  return `${family!.charAt(0).toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ""}`
}
