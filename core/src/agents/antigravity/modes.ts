import type { PermissionMode } from "@desk/protocol"
import type { Runtime } from "./runtime"

/** The mode in which the agent asks before it acts. */
const ASKS = "default"

/**
 * The server's mode for each of Desk's that it has: it asks, it accepts edits, or it never asks. It has
 * no reviewer for Auto, so Auto asks as Supervised does.
 */
const SERVER_MODES: Partial<Record<PermissionMode, string>> = { default: ASKS, acceptEdits: "auto_edit", bypassPermissions: "yolo" }

/** The modes Desk offers for Antigravity. */
export const ANTIGRAVITY_MODES = Object.keys(SERVER_MODES) as readonly PermissionMode[]

/**
 * The agent's mode for one of Desk's, on the runtime it runs. The agy CLI refuses the server's yolo and
 * auto_edit, so it always asks. Without a runtime it asks too.
 */
export const modeId = (mode: PermissionMode, kind: Runtime["kind"] | undefined) => (kind === "server" ? (SERVER_MODES[mode] ?? ASKS) : ASKS)
