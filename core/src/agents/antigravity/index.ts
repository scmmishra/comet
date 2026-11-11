import { existsSync, mkdirSync } from "node:fs"
import { spawn } from "../../environment"
import type { Agent, AgentHost } from "../agent"
import { AcpSession } from "../acp/session"
import { acpThreads } from "../acp/thread-record"
import type { Process } from "../json-rpc"
import { antigravityFlavor, INSTALL_PROBLEM, SIGN_IN_PROBLEM } from "./flavor"
import { modelsPath, signInFolder, threadsFolder, tokenPath } from "./home"
import { installRuntime } from "./install"
import { ModelCache } from "./models"
import { clearRuntimeTemp, launch, resolveRuntime } from "./runtime"
import { signInWithGoogle } from "./sign-in"

/**
 * Google Antigravity, run as Google's ACP server for other editors, not the Antigravity app. Desk installs
 * the server itself, and the user signs in with their Google account, so their Google AI plan is used.
 * Desk never starts the server to read its state, since each start unpacks about 1 GB.
 */
export function antigravityAgent(host: AgentHost): Agent {
  const models = new ModelCache(modelsPath)
  const flavor = antigravityFlavor(host, models)
  /** The process of a sign-in that runs, which closing Desk ends. */
  let signingIn: Process | undefined
  void clearRuntimeTemp()
  return {
    id: "antigravity",
    name: "Antigravity",
    features: ["delete", "install", "sign-in"],
    threads: acpThreads(threadsFolder),

    /** Reads only files: the runtime, and the token the agent writes once signed in. */
    async inspect() {
      const runtime = resolveRuntime()
      if (!runtime) return host.publish({ state: "missing", problem: INSTALL_PROBLEM })
      const version = { ...(runtime.version ? { installed: runtime.version } : {}), updateAvailable: false, updatable: false }
      if (!existsSync(tokenPath())) return host.publish({ state: "signed-out", problem: SIGN_IN_PROBLEM, version })
      host.publish({ state: "ready", problem: undefined, version, models: models.options() })
    },

    /** Antigravity's ACP server reports no plan usage. */
    refreshUsage: async () => {},

    open: (dir, emit, options) => new AcpSession(dir, emit, options, flavor),

    install: () => installRuntime(),

    async signIn() {
      const runtime = resolveRuntime()
      if (!runtime) throw new Error(`Antigravity is not installed. ${INSTALL_PROBLEM}`)
      mkdirSync(signInFolder(), { recursive: true })
      signingIn = launch(runtime, signInFolder())
      try {
        await signInWithGoogle(signingIn, { clientInfo: flavor.clientInfo, cwd: signInFolder(), open: (link) => void spawn(["open", link]), learn: flavor.learn })
      } finally {
        signingIn = undefined
      }
    },

    close() {
      signingIn?.close()
    },
  }
}
