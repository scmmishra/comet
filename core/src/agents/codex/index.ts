import type { Agent, AgentHost, Emit, SessionOptions } from "../agent"
import { codexAccount } from "./account"
import { CodexMissing } from "./executable"
import { ModelCatalog, modelOptions } from "./models"
import type { CodexAccount } from "./protocol"
import { AppServer, launchCodex, type Launch } from "./server"
import { codexMcp } from "./mcp"
import { CodexSession } from "./session"
import { readSkills } from "./skills"
import { codexThreads } from "./threads"
import { Usage } from "./usage"

/** Codex keeps its own login, which its CLI runs. Comet uses whatever account Codex has. */
const SIGN_IN = "Run `codex login` in a terminal to sign in."

/**
 * OpenAI's Codex, run through its app-server. Comet runs the `codex` installed on this Mac, so it uses the
 * account and the settings Codex already has in `~/.codex`. One app-server serves every Codex tab, the
 * thread list, Settings and the project's MCP servers and skills. It starts on the first need and ends with Comet. `launch` lets a test play the app-server.
 */
export function codexAgent(host: AgentHost, launch: Launch = launchCodex): Agent {
  const server = new AppServer(launch)
  const catalog = new ModelCatalog(server)
  const usage = new Usage(server, (reading) => host.publish({ usage: reading }))
  return {
    id: "codex",
    name: "Codex",
    features: ["steer", "rewind", "fork", "rename", "delete", "mcp"],
    // Codex resumes a thread in whatever folder it is given.
    movesThreads: true,
    threads: codexThreads(server),
    commands: (dir) => readSkills(server, dir),
    mcp: codexMcp(server),

    async inspect() {
      let installed: string | undefined
      try {
        installed = await server.version()
      } catch (error) {
        if (error instanceof CodexMissing) return host.publish({ state: "missing", problem: error.message })
        throw error
      }
      host.publish({ version: { installed, updateAvailable: false, updatable: false } })
      const { account } = await server.request<{ account: CodexAccount | null }>("account/read", { refreshToken: false })
      const found = codexAccount(account)
      host.publish({ state: found ? "ready" : "signed-out", problem: found ? undefined : SIGN_IN, account: found })
      if (found) host.publish({ models: modelOptions(await catalog.read()) })
    },

    refreshUsage: () => usage.refresh(),

    open: (dir: string, emit: Emit, options: SessionOptions) => new CodexSession(dir, emit, options, server, catalog),

    close: () => server.close(),
  }
}
