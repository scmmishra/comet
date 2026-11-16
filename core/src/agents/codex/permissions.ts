import type { PermissionMode } from "@desk/protocol"

/** When Codex asks before it acts, who answers, and what its sandbox lets commands touch. */
export interface RunPolicy {
  readonly approvalPolicy: "untrusted" | "on-request" | typeof FULL_ACCESS_APPROVAL
  readonly approvalsReviewer: "user" | "auto_review"
  readonly sandboxPolicy:
    | { readonly type: "readOnly"; readonly networkAccess: boolean }
    | { readonly type: "workspaceWrite"; readonly writableRoots: readonly string[]; readonly networkAccess: boolean; readonly excludeTmpdirEnvVar: boolean; readonly excludeSlashTmp: boolean }
    | { readonly type: "dangerFullAccess" }
}

/**
 * Full access does not use `never`. Under it, Codex declines every MCP prompt itself, before Desk sees it.
 * A tool that asks, such as Codex's browser access, then reads a refusal the user never gave. So full
 * access asks Codex for MCP prompts alone, after T3 Code, and Desk accepts each one itself.
 */
const FULL_ACCESS_APPROVAL = { granular: { mcp_elicitations: true, request_permissions: false, rules: false, sandbox_approval: false, skill_approval: false } } as const

const WORKSPACE_WRITE = { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } as const

/**
 * Desk's permission modes in Codex's terms, as T3 Code maps them. Supervised asks before anything leaves
 * a read-only sandbox. Auto-accept edits lets Codex write in the project and asks for the rest. Auto
 * lets Codex's reviewer answer in the user's place. Full access has no sandbox, and never asks the user.
 */
const POLICIES: Record<PermissionMode, RunPolicy> = {
  default: { approvalPolicy: "untrusted", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } },
  acceptEdits: { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: WORKSPACE_WRITE },
  auto: { approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: WORKSPACE_WRITE },
  bypassPermissions: { approvalPolicy: FULL_ACCESS_APPROVAL, approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } },
}

/** Whether Desk accepts MCP prompts itself. In full access, the user has already allowed everything. */
export const acceptsMcpPrompts = (mode: PermissionMode) => POLICIES[mode].approvalPolicy === FULL_ACCESS_APPROVAL

/** `thread/start` names the sandbox by mode, and `turn/start` by policy. */
const SANDBOX_MODES = { readOnly: "read-only", workspaceWrite: "workspace-write", dangerFullAccess: "danger-full-access" } as const

/** The permissions a turn runs with. Every `turn/start` sends them, so a mode change applies from the next turn. */
export const runPolicy = (mode: PermissionMode): RunPolicy => POLICIES[mode]

/** A thread's starting permissions, as `thread/start` and `thread/resume` take them. */
export function threadPolicy(mode: PermissionMode) {
  const { approvalPolicy, approvalsReviewer, sandboxPolicy } = POLICIES[mode]
  return { approvalPolicy, approvalsReviewer, sandbox: SANDBOX_MODES[sandboxPolicy.type] }
}
