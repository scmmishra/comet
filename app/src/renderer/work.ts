import type { StepKind } from "@desk/protocol"
import type { IconName } from "./icons"

/** Each step kind's icon. The core names a step's kind. */
export const ICON_BY_KIND: Record<StepKind, IconName> = {
  thought: "outline-brain",
  command: "outline-console",
  edit: "edit",
  read: "outline-eye",
  search: "magnifying-glass",
  web: "globe",
  other: "code-slash",
}
