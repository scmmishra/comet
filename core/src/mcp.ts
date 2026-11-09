import type { McpServerStatus, Query } from "@anthropic-ai/claude-agent-sdk"
import type { McpServer } from "@desk/protocol"
import { probe } from "./probe"

/**
 * How long a read watches the servers. Servers start in parallel, and claude.ai connectors join the
 * list about two seconds after the others, so one look would miss them.
 */
const WATCH_MS = 8_000
const WATCH_POLL_MS = 500
/** Where Claude Code configures a server that belongs to one project: its .mcp.json, or its entry in ~/.claude.json. */
const PROJECT_SCOPES = ["project", "local"]

/** Null means Claude Code could not be asked. */
type Publish = (servers: McpServer[] | null) => void

/**
 * The MCP servers Claude Code loads in a project. `publish` gets the list as soon as there is one, and
 * again each time it changes while servers connect and join.
 */
export async function readMcpServers(dir: string, publish: Publish) {
  if (!(await probe(dir, (running) => watch(running, publish), { loadMcp: true }))) publish(null)
}

/** Turns a server on or off, as Claude Code's /mcp does, then publishes the servers as they change. */
export async function toggleMcpServer(dir: string, name: string, enabled: boolean, publish: Publish) {
  const watched = await probe(
    dir,
    async (running) => {
      // Enabling a server that cannot start throws, yet the choice is kept. Its row then shows the failure.
      await running.toggleMcpServer(name, enabled).catch(() => undefined)
      return watch(running, publish)
    },
    { loadMcp: true },
  )
  if (!watched) publish(null)
}

/** Publishes the servers now, and again whenever they change, until the watch ends. Returns the last list. */
async function watch(running: Query, publish: Publish): Promise<McpServer[]> {
  const end = Date.now() + WATCH_MS
  let last = ""
  while (true) {
    const servers = (await running.mcpServerStatus()).map(mcpServer)
    const key = JSON.stringify(servers)
    if (key !== last) {
      last = key
      publish(servers)
    }
    if (Date.now() >= end) return servers
    await Bun.sleep(WATCH_POLL_MS)
  }
}

export function mcpServer(status: McpServerStatus): McpServer {
  const config = status.config as { command?: string; args?: string[]; url?: string } | undefined
  const target = config?.url ?? (config?.command ? [config.command, ...(config.args ?? [])].join(" ") : undefined)
  return {
    name: status.name,
    status: status.status,
    ...(status.scope ? { scope: status.scope } : {}),
    ownProject: PROJECT_SCOPES.includes(status.scope ?? ""),
    ...(target ? { target } : {}),
    tools: status.tools?.length ?? 0,
    ...(status.error ? { error: status.error } : {}),
  }
}
