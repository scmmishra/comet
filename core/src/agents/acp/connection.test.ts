import { expect, test } from "bun:test"
import { until } from "../../test-support"
import { RpcError } from "../json-rpc"
import { AcpConnection, type AcpClient } from "./connection"
import { fakeAcpAgent } from "./test-agent"

const client: AcpClient = { update: () => {}, permission: async () => ({ outcome: { outcome: "cancelled" } }), closed: () => {} }
const CLIENT_INFO = { name: "fake-client", version: "1.0.0" }

test("initializes without offering Desk's files or terminals, then authenticates", async () => {
  const agent = fakeAcpAgent()
  const connection = await AcpConnection.open(agent.process, client, { clientInfo: CLIENT_INFO, authMethod: "fake-auth" })
  expect(agent.written.map((message) => message.method)).toEqual(["initialize", "authenticate"])
  expect(agent.sent("initialize")[0]).toEqual({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: CLIENT_INFO })
  expect(agent.sent("authenticate")[0]).toEqual({ methodId: "fake-auth" })
  expect(connection.agent.agentInfo?.name).toBe("fake-acp")
  expect(agent.written.every((message) => message.jsonrpc === "2.0")).toBe(true)
})

test("closes the process when authentication fails", async () => {
  const agent = fakeAcpAgent({ authenticate: () => Promise.reject({ code: -32000, message: "Authentication required" }) })
  const error = await AcpConnection.open(agent.process, client, { clientInfo: CLIENT_INFO, authMethod: "fake-auth" }).catch((caught) => caught)
  expect(error).toBeInstanceOf(RpcError)
  expect(error.code).toBe(-32000)
  // The fake's process exits only once the connection closes it, so the test hangs if it does not.
  await agent.process.exited
})

test("refuses the agent's requests for files Desk does not offer", async () => {
  const agent = fakeAcpAgent()
  await AcpConnection.open(agent.process, client, { clientInfo: CLIENT_INFO })
  agent.print(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "fs/read_text_file", params: { path: "/etc/hosts" } }))
  await until(() => agent.written.some((message) => message.id === 9))
  expect(agent.written.find((message) => message.id === 9)?.error).toEqual({ code: -32601, message: "Desk does not handle fs/read_text_file." })
})
