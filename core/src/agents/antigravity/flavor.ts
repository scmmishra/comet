import { version as coreVersion } from "../../../package.json"
import type { AgentHost } from "../agent"
import type { AcpFlavor, BackgroundWork } from "../acp/flavor"
import type { ToolCall } from "../acp/protocol"
import type { Process } from "../process"
import type { ModelCache } from "./models"
import { modeId } from "./modes"
import { antigravityTools, isCometTool } from "./normalize"
import { watchPrompt } from "./prompt-outcome"
import { launch, resolveRuntime } from "./runtime"
import { signInLink } from "./sign-in-link"

/** What to do when Antigravity is not installed, as the app shows it after its own "Antigravity is not installed". */
export const INSTALL_PROBLEM = "Install it to use the models of your Google account."
/** What to do when only the ACP server an earlier Comet installed is there. */
export const SERVER_PROBLEM = "Comet now runs Google's Antigravity CLI, not the server it installed before. Install the CLI to go on."
/** What to do when Antigravity is not signed in, as the app shows it after its own "Antigravity is not signed in". */
export const SIGN_IN_PROBLEM = "Sign in with your Google account to use its models."
/** What a turn says when Antigravity needs a sign-in. */
const SIGN_IN_TO_SEND = "Sign in to Antigravity in Settings, then send again."

/** How Comet names itself to Antigravity. The core does not know Comet's version, so it gives its own. */
const CLIENT_INFO = { name: "comet", version: coreVersion }

/** The method that signs in with a personal Google account, so its Google AI plan is used. */
const PERSONAL_GOOGLE_AUTH = "oauth-personal"

/** Antigravity asks its multiple-choice questions as permission requests, marked by the call's id. */
const QUESTION_PREFIX = "interaction_"

/** The titles of Antigravity's `schedule` call, as T3 Code found them. */
const SCHEDULE_TITLES = new Set(["Run schedule", "Running schedule"])

/** Whether a command call runs a daemon, such as a server, which Antigravity marks in its input. */
const runsDaemon = (call: ToolCall) => !!call.rawInput && typeof call.rawInput === "object" && (call.rawInput as Record<string, unknown>).IsDaemon === true

/**
 * What Antigravity does after its prompt answers. It answers while a command it put in the background
 * still runs, and replies by itself once the command ends. Its `schedule` call runs until its wake fires,
 * and the wake replies the same way. A daemon may never end, so it does not hold the turn. Antigravity
 * sends usage after each model call, and that update ends a reply it started itself.
 */
export const antigravityBackground: BackgroundWork = {
  outlivesPrompt: (call) => SCHEDULE_TITLES.has(call.title ?? "") || (call.kind === "execute" && !runsDaemon(call)),
  endsReply: (update) => update.sessionUpdate === "usage_update",
}

/** Starts Antigravity in a folder. It throws a sentence the user reads when Antigravity is not installed. */
export function launchAntigravity(dir: string): Process {
  const runtime = resolveRuntime()
  if (!runtime) throw new Error(`Antigravity is not installed. ${INSTALL_PROBLEM}`)
  return launch(runtime, dir)
}

/** How Comet runs Antigravity over ACP. */
export function antigravityFlavor(host: AgentHost, models: ModelCache): AcpFlavor {
  return {
    launch: launchAntigravity,
    connect: { clientInfo: CLIENT_INFO, authMethod: PERSONAL_GOOGLE_AUTH },
    modeId,
    tools: antigravityTools,
    isQuestion: (request) => request.toolCall.toolCallId.startsWith(QUESTION_PREFIX),
    isCometTool: (request) => isCometTool(request.toolCall),
    needsSignIn: (line) => signInLink(line) !== undefined,
    watchPrompt,
    background: antigravityBackground,
    signedOut() {
      host.publish({ state: "signed-out", problem: SIGN_IN_PROBLEM })
      return SIGN_IN_TO_SEND
    },
    learn: (options, opened) => host.publish({ models: models.learn(options, opened) }),
  }
}
