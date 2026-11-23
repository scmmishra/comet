import type { ToolServer } from "../agents/agent"
import type { ToolSet } from "./mcp"
import type { ToolGroup } from "./tool"

/** Comet's tools for one session, and how to take them back once it closes. */
export interface SessionTools {
  readonly server: ToolServer
  close(): void
}

/**
 * Gives each session Comet's tools over MCP, under a token that names it. A session gets the tools of the
 * groups it is opened with, and the model is told about each group.
 */
export class ToolSessions {
  private readonly sessions = new Map<string, ToolSet>()

  /** `endpoint` is where Comet's MCP server listens. */
  constructor(private readonly endpoint: () => string) {}

  open(groups: readonly ToolGroup[]): SessionTools {
    const token = crypto.randomUUID() + crypto.randomUUID()
    this.sessions.set(token, {
      tools: groups.flatMap((group) => group.tools),
      call: async (name, input, signal) => {
        const group = groups.find((found) => found.tools.some((tool) => tool.name === name))
        if (!group) throw new Error(`Comet has no tool called ${name}.`)
        return group.call(name, input, signal)
      },
    })
    return {
      server: { url: this.endpoint(), authorization: `Bearer ${token}`, instructions: groups.map((group) => group.instructions).join("\n") },
      close: () => void this.sessions.delete(token),
    }
  }

  /** The tools of the session an Authorization header names, or nothing for a header Comet did not give out. */
  toolsFor(authorization: string): ToolSet | undefined {
    return this.sessions.get(authorization.replace(/^Bearer /, ""))
  }
}
