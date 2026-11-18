import type { PermissionMode } from "@comet/protocol"

/**
 * The CLI's mode for each of Comet's that it has: it asks, it accepts edits, or it approves edits and
 * safe commands. It has no mode that never asks, and refuses `yolo`.
 */
const MODES: Partial<Record<PermissionMode, string>> = { default: "default", acceptEdits: "accept-edits", auto: "auto" }

/** The modes Comet offers on Antigravity. */
export const ANTIGRAVITY_MODES = Object.keys(MODES) as PermissionMode[]

/** The agent's mode for one of Comet's. */
export const modeId = (mode: PermissionMode) => MODES[mode] ?? MODES.default!
