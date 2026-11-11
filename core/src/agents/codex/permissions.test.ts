import { expect, test } from "bun:test"
import { runPolicy, threadPolicy } from "./permissions"

const WORKSPACE_WRITE = { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } as const

test("runs each of Desk's permission modes with Codex's approvals and sandbox, as T3 Code does", () => {
  expect(runPolicy("default")).toEqual({ approvalPolicy: "untrusted", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } })
  expect(runPolicy("acceptEdits")).toEqual({ approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: WORKSPACE_WRITE })
  expect(runPolicy("auto")).toEqual({ approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: WORKSPACE_WRITE })
  expect(runPolicy("bypassPermissions")).toEqual({ approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } })
})

test("starts a thread with the same policy, its sandbox named as a mode", () => {
  expect(threadPolicy("default")).toEqual({ approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "read-only" })
  expect(threadPolicy("auto")).toEqual({ approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandbox: "workspace-write" })
  expect(threadPolicy("bypassPermissions")).toEqual({ approvalPolicy: "never", approvalsReviewer: "user", sandbox: "danger-full-access" })
})
