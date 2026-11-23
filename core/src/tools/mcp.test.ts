import { expect, test } from "bun:test"
import { serveMcp, type ToolSet } from "./mcp"

const tools: ToolSet = {
  tools: [{ name: "echo", description: "Says it back.", inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
  call: async (name, input) => {
    if (name !== "echo") throw new Error(`No tool called ${name}.`)
    return { text: String(input.text) }
  },
}
const known = (authorization: string) => (authorization === "Bearer good" ? tools : undefined)

const post = (body: unknown, authorization = "Bearer good") => serveMcp(new Request("http://127.0.0.1/mcp", { method: "POST", headers: { authorization }, body: typeof body === "string" ? body : JSON.stringify(body) }), known)
const result = async (body: unknown) => (await (await post(body)).json()) as { result?: Record<string, unknown>; error?: { message: string } }

test("refuses a caller it does not know", async () => {
  expect((await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "Bearer bad")).status).toBe(401)
})

test("starts a session on the version the client speaks, and lists the caller's tools", async () => {
  expect((await result({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "comet" } })
  expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202)
  expect((await result({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result).toEqual({ tools: tools.tools })
})

test("runs a tool and answers with its text", async () => {
  expect((await result({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hello" } } })).result).toEqual({ content: [{ type: "text", text: "hello" }], isError: false })
})

test("a tool that fails tells the model why, and an unknown method is a protocol error", async () => {
  expect((await result({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "missing" } })).result).toEqual({ content: [{ type: "text", text: "No tool called missing." }], isError: true })
  expect((await result({ jsonrpc: "2.0", id: 5, method: "resources/list" })).error?.message).toBe("Comet's MCP server has no method resources/list.")
  expect(((await (await post("not json")).json()) as { error: { message: string } }).error.message).toBe("The request is not JSON.")
})

test("keeps no event stream and lets a client end its session", async () => {
  const ask = (method: string) => serveMcp(new Request("http://127.0.0.1/mcp", { method, headers: { authorization: "Bearer good" } }), known)
  expect((await ask("GET")).status).toBe(405)
  expect((await ask("DELETE")).status).toBe(200)
})
