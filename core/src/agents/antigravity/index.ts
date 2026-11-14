import type { AgentVersion } from "@desk/protocol"
import { existsSync, mkdirSync } from "node:fs"
import { spawn } from "../../environment"
import type { Agent, AgentHost } from "../agent"
import { AcpSession } from "../acp/session"
import { AcpThreadStore } from "../acp/thread-record"
import type { Process } from "../process"
import { antigravityFlavor, INSTALL_PROBLEM, launchAntigravity, SERVER_PROBLEM, SIGN_IN_PROBLEM } from "./flavor"
import { modelsPath, signInFolder, threadsFolder, tokenPath } from "./home"
import { installRuntime } from "./install"
import { ModelCache } from "./models"
import { checkForUpdate } from "./release"
import { onlyServerInstalled, resolveRuntime } from "./runtime"
import { signInWithGoogle } from "./sign-in"

interface AntigravityOptions {
  /** A test's, in place of Google's release channel. */
  readonly checkForUpdate?: (installed: string) => Promise<AgentVersion>
}

/**
 * Google Antigravity, run as the ACP server of Google's `agy` CLI, not the Antigravity app. Desk installs
 * the CLI itself and updates it, and the user signs in with their Google account, so their Google AI plan is used.
 */
export function antigravityAgent(host: AgentHost, options: AntigravityOptions = {}): Agent {
  const models = new ModelCache(modelsPath)
  const flavor = antigravityFlavor(host, models)
  const threads = new AcpThreadStore(threadsFolder)
  const check = options.checkForUpdate ?? ((installed: string) => checkForUpdate(installed))
  /** The process of a sign-in that runs, which closing Desk ends. */
  let signingIn: Process | undefined
  return {
    id: "antigravity",
    name: "Antigravity",
    features: ["delete", "install", "sign-in"],
    threads,

    /** Reads the install and the token the agent writes once signed in, then asks Google for a newer release of Desk's install. */
    async inspect() {
      const runtime = resolveRuntime()
      if (!runtime) return host.publish({ state: "missing", problem: onlyServerInstalled() ? SERVER_PROBLEM : INSTALL_PROBLEM })
      // Only Desk's install has a version Desk knows and can update.
      const installed = runtime.version
      const version = { ...(installed ? { installed } : {}), updateAvailable: false, updatable: !!installed }
      if (!existsSync(tokenPath())) host.publish({ state: "signed-out", problem: SIGN_IN_PROBLEM, version })
      else host.publish({ state: "ready", problem: undefined, version, models: models.options() })
      if (installed) void check(installed).then((checked) => host.publish({ version: checked }))
    },

    /** Antigravity's ACP server reports no plan usage. */
    refreshUsage: async () => {},

    open: (dir, emit, options) => new AcpSession(dir, emit, options, flavor, threads),

    install: (signal) => installRuntime({ signal }),

    /** Installs the newest release. The install it replaces stays until the new one is in place. */
    update: () => installRuntime(),

    async signIn(signal) {
      mkdirSync(signInFolder(), { recursive: true })
      signingIn = launchAntigravity(signInFolder())
      try {
        const open = (link: string) => {
          void spawn(["open", link])
          host.publish({ signInLink: link })
        }
        await signInWithGoogle(signingIn, { connect: flavor.connect, cwd: signInFolder(), open, learn: flavor.learn, signal })
      } finally {
        signingIn = undefined
      }
    },

    close() {
      signingIn?.close()
    },
  }
}
