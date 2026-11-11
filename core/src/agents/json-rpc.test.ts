import { expect, test } from "bun:test"
import { until } from "../test-support"
import { JsonRpc, lines, RpcError, type Transport } from "./json-rpc"

/** A transport a test plays the peer on: `say` sends the client a message, and `written` is what the client sent. */
function peer() {
  const written: Record<string, unknown>[] = []
  const queue: string[] = []
  let wake: (() => void) | undefined
  let closed = false
  const transport: Transport = {
    lines: (async function* () {
      while (true) {
        while (queue.length) yield queue.shift()!
        if (closed) return
        await new Promise<void>((resolve) => (wake = resolve))
      }
    })(),
    write: (line) => void written.push(JSON.parse(line)),
    close: () => {
      closed = true
      wake?.()
    },
  }
  const say = (message: object | string) => {
    queue.push(typeof message === "string" ? message : JSON.stringify(message))
    wake?.()
  }
  return { transport, written, say, hangUp: transport.close }
}

const noHandlers = { notification: () => {}, request: () => null, closed: () => {} }

test("answers a request with the peer's result, and fails it with the peer's error", async () => {
  const { transport, written, say } = peer()
  const rpc = new JsonRpc(transport, noHandlers, { versioned: false })
  const listed = rpc.request("model/list", { limit: 2 })
  const broken = rpc.request("thread/read")
  expect(written).toEqual([{ id: 1, method: "model/list", params: { limit: 2 } }, { id: 2, method: "thread/read" }])
  say({ id: 2, error: { code: -32600, message: "No such thread" } })
  say({ id: 1, result: { data: [] } })
  expect(await listed).toEqual({ data: [] })
  const error = await broken.catch((caught) => caught)
  expect(error).toBeInstanceOf(RpcError)
  expect(error).toMatchObject({ message: "No such thread", code: -32600 })
})

test("marks each message with the JSON-RPC version only for a peer that needs it", () => {
  const { transport, written } = peer()
  const rpc = new JsonRpc(transport, noHandlers, { versioned: true })
  void rpc.request("initialize", {})
  rpc.notify("session/cancel", { sessionId: "s1" })
  expect(written).toEqual([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "s1" } }])
})

test("passes on the peer's notifications, and answers its requests, even ones that wait", async () => {
  const { transport, written, say } = peer()
  const notes: [string, unknown][] = []
  const asked: (number | string)[] = []
  let approve: (decision: string) => void = () => {}
  new JsonRpc(
    transport,
    {
      notification: (method, params) => void notes.push([method, params]),
      request: (method, _params, id) => {
        asked.push(id)
        if (method === "approve") return new Promise<string>((resolve) => (approve = resolve)).then((decision) => ({ decision }))
        throw new RpcError("Desk does not handle that.", -32601)
      },
      closed: () => {},
    },
    { versioned: false },
  )
  say({ method: "turn/started", params: { turnId: "t1" } })
  say({ id: "a", method: "approve", params: {} })
  say({ id: "b", method: "unknown" })
  await until(() => written.length === 1)
  expect(notes).toEqual([["turn/started", { turnId: "t1" }]])
  expect(asked).toEqual(["a", "b"])
  expect(written).toEqual([{ id: "b", error: { code: -32601, message: "Desk does not handle that." } }])
  approve("accept")
  await until(() => written.length === 2)
  expect(written[1]).toEqual({ id: "a", result: { decision: "accept" } })
})

test("hands a line that is not JSON to the caller and reads on", async () => {
  const { transport, say } = peer()
  const stray: string[] = []
  const rpc = new JsonRpc(transport, noHandlers, { versioned: true, stray: (line) => void stray.push(line) })
  const asked = rpc.request("session/new")
  say("Open the following link to authenticate: https://example.com")
  say({ jsonrpc: "2.0", id: 1, result: { sessionId: "s1" } })
  expect(await asked).toEqual({ sessionId: "s1" })
  expect(stray).toEqual(["Open the following link to authenticate: https://example.com"])
})

test("fails every waiting request once the peer is gone, and says so once", async () => {
  const { transport, hangUp } = peer()
  const closed: string[] = []
  const rpc = new JsonRpc(transport, { ...noHandlers, closed: (error) => void closed.push(error.message) }, { versioned: false })
  const waiting = rpc.request("turn/start").catch((error: Error) => error.message)
  hangUp()
  expect(await waiting).toBe("The agent's process ended.")
  expect(await rpc.request("turn/start").catch((error: Error) => error.message)).toBe("The agent's process ended.")
  expect(closed).toEqual(["The agent's process ended."])
})

test("splits a byte stream into lines across chunks, and keeps a last line with no newline", async () => {
  const encode = (text: string) => new TextEncoder().encode(text)
  const stream = (async function* () {
    yield encode('{"a":')
    yield encode('1}\n{"b":2}\n{"c"')
    yield encode(":3}")
  })()
  const found: string[] = []
  for await (const line of lines(stream)) found.push(line)
  expect(found).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
})
