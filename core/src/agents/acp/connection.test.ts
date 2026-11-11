import { expect, test } from "bun:test"
import { until } from "../../test-support"
import { RpcError } from "../json-rpc"
import { AcpConnection, type AcpClient } from "./connection"
import { fakeAcpAgent } from "./test-agent"

const client: AcpClient = { update: () => {}, permission: async () => ({ outcome: { outcome: "cancelled" } }), closed: () => {} }

test("initializes without offering Desk's files or terminals, then authenticates", async () => {
  const agent = fakeAcpAgent()
  const connection = await AcpConnection.open(agent.process, client, { clientInfo: { name: "zed", version: "0.0.0" }, authMethod: "oauth-personal" })
  expect(agent.written.map((message) => message.method)).toEqual(["initialize", "authenticate"])
  expect(agent.sent("initialize")[0]).toEqual({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "zed", version: "0.0.0" } })
  expect(agent.sent("authenticate")[0]).toEqual({ methodId: "oauth-personal" })
  expect(connection.agent.agentInfo?.version).toBe("1.4.5")
  expect(agent.written.every((message) => message.jsonrpc === "2.0")).toBe(true)
})

test("closes the process when authentication fails", async () => {
  const agent = fakeAcpAgent({ authenticate: () => Promise.reject({ code: -32000, message: "Authentication required" }) })
  let ended = false
  void agent.process.exited.then(() => (ended = true))
  const error = await AcpConnection.open(agent.process, client, { clientInfo: { name: "zed", version: "0.0.0" }, authMethod: "oauth-personal" }).catch((caught) => caught)
  expect(error).toBeInstanceOf(RpcError)
  expect(error.code).toBe(-32000)
  await agent.process.exited
  expect(ended).toBe(true)
})

test("refuses the agent's requests for files Desk does not offer", async () => {
  const agent = fakeAcpAgent()
  await AcpConnection.open(agent.process, client, { clientInfo: { name: "zed", version: "0.0.0" } })
  agent.print(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "fs/read_text_file", params: { path: "/etc/hosts" } }))
  await until(() => agent.written.some((message) => message.id === 9))
  expect(agent.written.find((message) => message.id === 9)?.error).toEqual({ code: -32601, message: "Desk does not handle fs/read_text_file." })
})
