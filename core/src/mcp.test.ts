import { expect, test } from "bun:test"
import { mcpServer } from "./mcp"

test("describes a server by its command or URL, its tools and its error", () => {
  expect(mcpServer({ name: "linear", status: "connected", scope: "user", config: { type: "http", url: "https://mcp.linear.app/mcp" }, tools: [{ name: "a" }, { name: "b" }] })).toEqual({
    name: "linear",
    status: "connected",
    scope: "user",
    target: "https://mcp.linear.app/mcp",
    tools: 2,
  })
  expect(mcpServer({ name: "files", status: "failed", config: { command: "npx", args: ["-y", "server-files"] }, error: "spawn failed" })).toEqual({
    name: "files",
    status: "failed",
    target: "npx -y server-files",
    tools: 0,
    error: "spawn failed",
  })
})
