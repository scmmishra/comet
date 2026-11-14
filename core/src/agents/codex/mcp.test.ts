import type { McpServer } from "@desk/protocol"
import { expect, test } from "bun:test"
import { codexMcp } from "./mcp"
import { AppServer } from "./server"
import { fakeAppServer } from "./test-app-server"

const USER = { name: { type: "user" }, disabledReason: null }
const PROJECT = { name: { type: "project" }, disabledReason: null }

/** A user config with two servers, one off, and a project that adds its own. */
function config() {
  const servers = { github: { command: "npx", args: ["github-mcp"], enabled: true }, sentry: { url: "https://mcp.sentry.dev", enabled: false }, db: { command: "pg-mcp", enabled: true } }
  return {
    config: { mcp_servers: servers },
    layers: [
      { ...PROJECT, config: { mcp_servers: { db: servers.db } } },
      { ...USER, config: { mcp_servers: { github: servers.github, sentry: servers.sentry } } },
    ],
  }
}

function mcp() {
  const codex = fakeAppServer()
  codex.answer("config/read", config())
  codex.answer("mcpServerStatus/list", ({ cursor }: { cursor?: string }) =>
    cursor
      ? { data: [{ name: "codex_apps", tools: { a: {} }, toolsError: null, authStatus: "bearerToken" }], nextCursor: null }
      : {
          data: [
            { name: "github", tools: { a: {}, b: {} }, toolsError: null, authStatus: "unsupported" },
            { name: "sentry", tools: {}, toolsError: null, authStatus: "unsupported" },
          ],
          nextCursor: "2",
        },
  )
  return { codex, mcp: codexMcp(new AppServer(codex.launch)) }
}

test("lists the configured servers as pending, then as Codex reports them, with the servers Codex adds", async () => {
  const { codex, mcp: servers } = mcp()
  const published: (McpServer[] | null)[] = []
  await servers.read("/code/web", (list) => void published.push(list))
  expect(codex.sent("config/read")).toEqual([{ cwd: "/code/web", includeLayers: true }])
  expect(published[0]!.map((server) => [server.name, server.status])).toEqual([["github", "pending"], ["sentry", "disabled"], ["db", "pending"]])
  expect(published[1]).toEqual([
    { name: "github", status: "connected", scope: "user", ownProject: false, target: "npx github-mcp", tools: 2, toggleable: true },
    { name: "sentry", status: "disabled", scope: "user", ownProject: false, target: "https://mcp.sentry.dev", tools: 0, toggleable: true },
    // Codex reports only on the servers every folder shares, so the project's own does not show connecting.
    { name: "db", status: "not-started", scope: "project", ownProject: true, target: "pg-mcp", tools: 0, toggleable: false },
    { name: "codex_apps", status: "connected", ownProject: false, tools: 1, toggleable: false },
  ])
})

test("shows a failed server's error, and one that needs a sign-in", async () => {
  const { codex, mcp: servers } = mcp()
  codex.answer("mcpServerStatus/list", {
    data: [
      { name: "github", tools: {}, toolsError: "MCP startup failed", authStatus: "unsupported" },
      { name: "db", tools: {}, toolsError: null, authStatus: "notLoggedIn" },
    ],
    nextCursor: null,
  })
  let last: McpServer[] | null = null
  await servers.read("/code/web", (list) => void (last = list))
  expect(last!.find((server) => server.name === "github")).toMatchObject({ status: "failed", error: "MCP startup failed" })
  expect(last!.find((server) => server.name === "db")).toMatchObject({ status: "needs-auth" })
})

test("publishes null when Codex cannot be asked", async () => {
  const codex = fakeAppServer()
  codex.answer("config/read", () => {
    throw new Error("no config")
  })
  const published: (McpServer[] | null)[] = []
  await codexMcp(new AppServer(codex.launch)).read("/code/web", (list) => void published.push(list))
  expect(published).toEqual([null])
})

test("turns a server of the user's config off, reloads the servers and reads them again", async () => {
  const { codex, mcp: servers } = mcp()
  codex.answer("config/value/write", { status: "ok" })
  codex.answer("config/mcpServer/reload", {})
  await servers.toggle("/code/web", "github", false, () => undefined)
  expect(codex.sent("config/value/write")).toEqual([{ keyPath: "mcp_servers.github.enabled", value: false, mergeStrategy: "replace" }])
  expect(codex.sent("config/mcpServer/reload")).toHaveLength(1)
  expect(codex.sent("mcpServerStatus/list").length).toBeGreaterThan(0)
})

test("refuses to turn off a server the user's config does not set, since Codex writes only that file", async () => {
  const { codex, mcp: servers } = mcp()
  await expect(servers.toggle("/code/web", "db", false, () => undefined)).rejects.toThrow("~/.codex/config.toml")
  await expect(servers.toggle("/code/web", "codex_apps", false, () => undefined)).rejects.toThrow()
  expect(codex.sent("config/value/write")).toEqual([])
})
