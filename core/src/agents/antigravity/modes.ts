import type { PermissionMode } from "@desk/protocol"
import type { Runtime } from "./runtime"

/** The mode in which the agent asks before it acts. */
const ASKS = "default"

/**
 * The server's mode for each of Desk's that it has: it asks, it accepts edits, or it never asks. It has
 * no reviewer for Auto, so Auto asks as Supervised does.
 */
const SERVER_MODES: Partial<Record<PermissionMode, string>> = { default: ASKS, acceptEdits: "auto_edit", bypassPermissions: "yolo" }

/**
 * The modes Desk offers on the runtime Antigravity runs, after T3 Code. The agy CLI refuses the server's
 * yolo and auto_edit, so it offers only the mode in which it asks. Without a runtime it asks too.
 */
export const modesFor = (kind: Runtime["kind"] | undefined): readonly PermissionMode[] => (kind === "server" ? (Object.keys(SERVER_MODES) as PermissionMode[]) : ["default"])

/** The agent's mode for one of Desk's, on the runtime it runs. */
export const modeId = (mode: PermissionMode, kind: Runtime["kind"] | undefined) => (kind === "server" ? (SERVER_MODES[mode] ?? ASKS) : ASKS)
