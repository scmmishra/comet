import type { Agent, AgentHost, Emit, SessionOptions } from "../agent"
import { codexAccount } from "./account"
import { codexPath, NO_CODEX } from "./executable"
import { ModelCatalog, modelOptions } from "./models"
import type { CodexAccount } from "./protocol"
import { AppServer, launchCodex, type Launch } from "./server"
import { CodexSession } from "./session"
import { signIn } from "./sign-in"
import { codexThreads } from "./threads"
import { Usage } from "./usage"

const SIGN_IN = "Sign in to use your ChatGPT plan."

/**
 * OpenAI's Codex, run through its app-server. Desk runs the `codex` installed on this Mac, so it uses the
 * account and the settings Codex already has in `~/.codex`. One app-server serves every Codex tab, the
 * thread list and Settings. It starts on the first need and ends with Desk. `launch` lets a test play the app-server.
 */
export function codexAgent(host: AgentHost, launch: Launch = launchCodex): Agent {
  const server = new AppServer(launch)
  const catalog = new ModelCatalog(server)
  const usage = new Usage(server, (reading) => host.publish({ usage: reading }))
  return {
    id: "codex",
    name: "Codex",
    features: ["steer", "rewind", "fork", "rename", "delete", "sign-in"],
    threads: codexThreads(server),

    async inspect() {
      if (!codexPath()) return host.publish({ state: "missing", problem: NO_CODEX })
      host.publish({ version: { installed: await server.version(), updateAvailable: false, updatable: false } })
      const { account } = await server.request<{ account: CodexAccount | null }>("account/read", { refreshToken: false })
      const found = codexAccount(account)
      host.publish({ state: found ? "ready" : "signed-out", problem: found ? undefined : SIGN_IN, account: found })
      if (found) host.publish({ models: modelOptions(await catalog.read()) })
    },

    refreshUsage: () => usage.refresh(),

    open: (dir: string, emit: Emit, options: SessionOptions) => new CodexSession(dir, emit, options, server, catalog),

    signIn: () => signIn(server),

    close: () => server.close(),
  }
}
