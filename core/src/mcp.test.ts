import { expect, test } from "bun:test"
import { mcpServer } from "./mcp"

test("describes a server by its command or URL, and tells a project's own server from a shared one", () => {
  expect(mcpServer({ name: "linear", status: "connected", scope: "user", config: { type: "http", url: "https://mcp.linear.app/mcp" }, tools: [{ name: "a" }, { name: "b" }] })).toMatchObject({
    target: "https://mcp.linear.app/mcp",
    tools: 2,
    ownProject: false,
  })
  expect(mcpServer({ name: "files", status: "failed", scope: "local", config: { command: "npx", args: ["-y", "server-files"] }, error: "spawn failed" })).toMatchObject({
    target: "npx -y server-files",
    tools: 0,
    ownProject: true,
  })
})
