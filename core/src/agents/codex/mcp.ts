import type { McpServer } from "@desk/protocol"
import type { AgentMcp } from "../agent"
import type { CodexConfigLayer, CodexConfigRead, CodexMcpConfig, CodexMcpStatus } from "./protocol"
import type { AppServer } from "./server"

/** The config layer of a server configured for one project: a `.codex` folder in it. */
const PROJECT_LAYER = "project"
/** The only layer Codex lets a client write: the user's `~/.codex/config.toml`. */
const USER_LAYER = "user"

type Publish = (servers: McpServer[] | null) => void

/**
 * Codex's MCP servers in a project: those its config lists for the folder, and how each connects. Codex
 * starts the servers to report on them, so a read takes several seconds. Its report covers the servers
 * every folder shares. A server one project configures starts only in that project's threads.
 */
export function codexMcp(server: AppServer): AgentMcp {
  const read = async (dir: string, publish: Publish) => {
    try {
      const configured = await readConfig(server, dir)
      publish(configured.map((entry) => described(entry, undefined, false)))
      const statuses = await readStatuses(server)
      publish(merged(configured, statuses))
    } catch {
      publish(null)
    }
  }
  return {
    read,

    /** Writes the choice into the user's config, where Codex keeps it, and reloads the servers. */
    async toggle(dir, name, enabled, publish) {
      const entry = (await readConfig(server, dir)).find((found) => found.name === name)
      if (!entry?.toggleable) throw new Error(`Desk can turn ${name} on or off only when ~/.codex/config.toml configures it.`)
      await server.request("config/value/write", { keyPath: `mcp_servers.${name}.enabled`, value: enabled, mergeStrategy: "replace" })
      await server.request("config/mcpServer/reload")
      await read(dir, publish)
    },
  }
}

/** A server the config lists, and the layer that sets it. */
type Configured = { readonly name: string; readonly config: CodexMcpConfig; readonly layer?: string; readonly toggleable: boolean }

async function readConfig(server: AppServer, dir: string): Promise<Configured[]> {
  const { config, layers } = await server.request<CodexConfigRead>("config/read", { cwd: dir, includeLayers: true })
  return Object.entries(config.mcp_servers ?? {}).map(([name, entry]) => {
    const layer = settingLayer(layers ?? [], name)
    // A key path names the server between dots, so a name with a dot in it cannot be written.
    return { name, config: entry, layer, toggleable: layer === USER_LAYER && !name.includes(".") }
  })
}

/** The strongest layer Codex reads that configures the server. */
function settingLayer(layers: readonly CodexConfigLayer[], name: string) {
  return layers.find((layer) => !layer.disabledReason && layer.config?.mcp_servers?.[name])?.name.type
}

async function readStatuses(server: AppServer): Promise<Map<string, CodexMcpStatus>> {
  const statuses = new Map<string, CodexMcpStatus>()
  let cursor: string | null = null
  do {
    const page: { data: CodexMcpStatus[]; nextCursor: string | null } = await server.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", ...(cursor ? { cursor } : {}) })
    for (const status of page.data) statuses.set(status.name, status)
    cursor = page.nextCursor
  } while (cursor)
  return statuses
}

/** The configured servers with how each connects, then the servers Codex adds itself, such as a plugin's. */
export function merged(configured: readonly Configured[], statuses: ReadonlyMap<string, CodexMcpStatus>): McpServer[] {
  const named = new Set(configured.map((entry) => entry.name))
  const added = [...statuses.values()].filter((status) => !named.has(status.name)).map((status) => described({ name: status.name, config: {}, toggleable: false }, status, true))
  return [...configured.map((entry) => described(entry, statuses.get(entry.name), true)), ...added]
}

/** A server as Desk shows it. Before Codex reports, an enabled server is pending. */
function described(entry: Configured, status: CodexMcpStatus | undefined, reported: boolean): McpServer {
  const { url, command, args } = entry.config
  const target = url ?? (command ? [command, ...(args ?? [])].join(" ") : undefined)
  const tools = status ? Object.keys(status.tools).length : 0
  return {
    name: entry.name,
    status: connection(entry.config, status, reported),
    ...(entry.layer ? { scope: entry.layer } : {}),
    ownProject: entry.layer === PROJECT_LAYER,
    ...(target ? { target } : {}),
    tools: status?.toolsError ? 0 : tools,
    ...(status?.toolsError ? { error: status.toolsError } : {}),
    toggleable: entry.toggleable,
  }
}

function connection(config: CodexMcpConfig, status: CodexMcpStatus | undefined, reported: boolean): McpServer["status"] {
  if (config.enabled === false) return "disabled"
  if (!reported) return "pending"
  if (!status) return "not-started"
  if (status.toolsError) return "failed"
  return status.authStatus === "notLoggedIn" ? "needs-auth" : "connected"
}
