import type { PermissionMode } from "@desk/protocol"
import type { AgentHost } from "../agent"
import type { AcpFlavor } from "../acp/flavor"
import type { InitializeResult } from "../acp/protocol"
import { threadsFolder } from "./home"
import type { ModelCache } from "./models"
import { antigravityTools } from "./normalize"
import { launch, resolveRuntime } from "./runtime"
import { GOOGLE_SIGN_IN } from "./sign-in"
import { signInLink } from "./sign-in-link"

/** What to do when Antigravity is not installed, as the app shows it after its own "Antigravity is not installed". */
export const INSTALL_PROBLEM = "Install it to use the models of your Google account."
/** What to do when Antigravity is not signed in, as the app shows it after its own "Antigravity is not signed in". */
export const SIGN_IN_PROBLEM = "Sign in with your Google account to use its models."

/**
 * Antigravity before 1.5.1 offers models other than Gemini only to clients it allowlists, such as Zed,
 * as T3 Code found. Desk installs 1.4.5, and cannot read the version of a runtime it did not install
 * before it starts, so it always names itself Zed.
 */
const CLIENT_INFO = { name: "zed", version: "0.0.0" }

/** The ACP server's mode for each of Desk's. It has no reviewer, so Auto asks as Supervised does. */
const MODES: Record<PermissionMode, string> = { default: "default", auto: "default", acceptEdits: "auto_edit", bypassPermissions: "yolo" }

/** Releases that write a run-workflow skill into the project unless its tool is turned off, as T3 Code found. */
const WRITES_WORKFLOW_SKILL = { from: [1, 4, 2], to: [1, 4, 5] } as const

/** How Desk runs Antigravity over ACP. */
export function antigravityFlavor(host: AgentHost, models: ModelCache): AcpFlavor {
  return {
    launch(dir) {
      const runtime = resolveRuntime()
      if (!runtime) throw new Error(`Antigravity is not installed. ${INSTALL_PROBLEM}`)
      return launch(runtime, dir)
    },
    clientInfo: CLIENT_INFO,
    authMethod: GOOGLE_SIGN_IN,
    // The agy CLI refuses the server's yolo and auto_edit, so it always asks.
    modeId: (mode) => (resolveRuntime()?.harness ? MODES[mode] : MODES.default),
    sessionMeta: (agent) => (writesWorkflowSkill(agent) ? { antigravity: { disabledTools: ["run_workflow"] } } : undefined),
    tools: antigravityTools,
    // Antigravity asks its multiple-choice questions as permission requests, marked by the call's id.
    isQuestion: (request) => request.toolCall.toolCallId.startsWith("interaction_"),
    needsSignIn: (line) => signInLink(line) !== undefined,
    signInProblem: "Sign in to Antigravity in Settings, then send again.",
    signedOut: () => host.publish({ state: "signed-out", problem: SIGN_IN_PROBLEM }),
    learn: (options, opened) => host.publish({ models: models.learn(options, opened) }),
    threadsFolder,
  }
}

function writesWorkflowSkill(agent: InitializeResult) {
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(agent.agentInfo?.version ?? "")?.slice(1).map(Number)
  if (!version) return false
  const compare = (other: readonly number[]) => version.reduce((found, part, index) => found || part - other[index]!, 0)
  return compare(WRITES_WORKFLOW_SKILL.from) >= 0 && compare(WRITES_WORKFLOW_SKILL.to) <= 0
}
