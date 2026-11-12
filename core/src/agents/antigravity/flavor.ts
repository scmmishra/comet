import type { AgentHost } from "../agent"
import type { AcpFlavor } from "../acp/flavor"
import type { InitializeResult } from "../acp/protocol"
import type { Process } from "../process"
import type { ModelCache } from "./models"
import { modeId } from "./modes"
import { antigravityTools } from "./normalize"
import { launch, resolveRuntime } from "./runtime"
import { signInLink } from "./sign-in-link"

/** What to do when Antigravity is not installed, as the app shows it after its own "Antigravity is not installed". */
export const INSTALL_PROBLEM = "Install it to use the models of your Google account."
/** What to do when Antigravity is not signed in, as the app shows it after its own "Antigravity is not signed in". */
export const SIGN_IN_PROBLEM = "Sign in with your Google account to use its models."
/** What a turn says when Antigravity needs a sign-in. */
const SIGN_IN_TO_SEND = "Sign in to Antigravity in Settings, then send again."

/**
 * Antigravity before 1.5.1 offers models other than Gemini only to clients it allowlists, such as Zed,
 * as T3 Code found. The release Desk installs is older than that. Desk cannot read the version of a
 * runtime it did not install before it starts, so it always names itself Zed.
 */
const CLIENT_INFO = { name: "zed", version: "0.0.0" }

/** The method that signs in with a personal Google account, so its Google AI plan is used. */
const PERSONAL_GOOGLE_AUTH = "oauth-personal"

/** Antigravity asks its multiple-choice questions as permission requests, marked by the call's id. */
const QUESTION_PREFIX = "interaction_"

/** Releases that write a run-workflow skill into the project unless its tool is turned off, as T3 Code found. */
const WRITES_WORKFLOW_SKILL = { from: [1, 4, 2], to: [1, 4, 5] } as const

/** Starts Antigravity in a folder. It throws a sentence the user reads when Antigravity is not installed. */
export function launchAntigravity(dir: string): Process {
  const runtime = resolveRuntime()
  if (!runtime) throw new Error(`Antigravity is not installed. ${INSTALL_PROBLEM}`)
  return launch(runtime, dir)
}

/** How Desk runs Antigravity over ACP. */
export function antigravityFlavor(host: AgentHost, models: ModelCache): AcpFlavor {
  return {
    launch: launchAntigravity,
    connect: { clientInfo: CLIENT_INFO, authMethod: PERSONAL_GOOGLE_AUTH },
    // The flavor does not know which runtime a session's process runs, so it reads the runtime again.
    modeId: (mode) => modeId(mode, resolveRuntime()?.kind),
    sessionMeta: (agent) => (writesWorkflowSkill(agent) ? { antigravity: { disabledTools: ["run_workflow"] } } : undefined),
    tools: antigravityTools,
    isQuestion: (request) => request.toolCall.toolCallId.startsWith(QUESTION_PREFIX),
    needsSignIn: (line) => signInLink(line) !== undefined,
    signedOut() {
      host.publish({ state: "signed-out", problem: SIGN_IN_PROBLEM })
      return SIGN_IN_TO_SEND
    },
    learn: (options, opened) => host.publish({ models: models.learn(options, opened) }),
  }
}

function writesWorkflowSkill(agent: InitializeResult) {
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(agent.agentInfo?.version ?? "")?.slice(1).map(Number)
  if (!version) return false
  const compare = (other: readonly number[]) => version.reduce((found, part, index) => found || part - other[index]!, 0)
  return compare(WRITES_WORKFLOW_SKILL.from) >= 0 && compare(WRITES_WORKFLOW_SKILL.to) <= 0
}
