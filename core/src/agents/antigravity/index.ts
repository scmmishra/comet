import type { AgentVersion } from "@comet/protocol"
import { mkdirSync } from "node:fs"
import { spawn } from "../../environment"
import type { Agent, AgentHost } from "../agent"
import { AcpSession } from "../acp/session"
import { AcpThreadStore } from "../acp/thread-record"
import type { Process } from "../process"
import { antigravityFlavor, INSTALL_PROBLEM, launchAntigravity, SERVER_PROBLEM, SIGN_IN_PROBLEM } from "./flavor"
import { modelsPath, signInFolder, threadsFolder } from "./home"
import { installRuntime } from "./install"
import { hasSignIn } from "./keychain"
import { ModelCache } from "./models"
import { checkForUpdate } from "./release"
import { onlyServerInstalled, resolveRuntime } from "./runtime"
import { signInWithGoogle } from "./sign-in"

interface AntigravityOptions {
  /** A test's, in place of Google's release channel. */
  readonly checkForUpdate?: (installed: string) => Promise<AgentVersion>
  /** A test's, in place of the keychain. */
  readonly hasSignIn?: () => Promise<boolean>
}

/**
 * Google Antigravity, run as the ACP server of Google's `agy` CLI, not the Antigravity app. Comet installs
 * the CLI itself and updates it, and the user signs in with their Google account, so their Google AI plan is used.
 */
export function antigravityAgent(host: AgentHost, options: AntigravityOptions = {}): Agent {
  const models = new ModelCache(modelsPath)
  const flavor = antigravityFlavor(host, models)
  const threads = new AcpThreadStore(threadsFolder)
  const check = options.checkForUpdate ?? ((installed: string) => checkForUpdate(installed))
  const signedIn = options.hasSignIn ?? hasSignIn
  /** The process of a sign-in that runs, which closing Comet ends. */
  let signingIn: Process | undefined
  return {
    id: "antigravity",
    name: "Antigravity",
    features: ["delete", "install", "sign-in"],
    threads,

    /** Reads the install and whether the keychain holds the agent's sign-in, then asks Google for a newer release of Comet's install. */
    async inspect() {
      const runtime = resolveRuntime()
      if (!runtime) return host.publish({ state: "missing", problem: onlyServerInstalled() ? SERVER_PROBLEM : INSTALL_PROBLEM })
      // Only Comet's install has a version Comet knows and can update.
      const installed = runtime.version
      const version = { ...(installed ? { installed } : {}), updateAvailable: false, updatable: !!installed }
      if (!(await signedIn())) host.publish({ state: "signed-out", problem: SIGN_IN_PROBLEM, version })
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
