import { afterEach, expect, test } from "bun:test"
import type { CoreMessage } from "@desk/protocol"
import { startCore, type CoreServer } from "./server"

let core: CoreServer | undefined
afterEach(() => core?.stop())

function connect(port: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`)
  const messages: CoreMessage[] = []
  const next = () =>
    new Promise<CoreMessage>((resolve) => {
      const take = () => (messages.length ? resolve(messages.shift()!) : setTimeout(take, 5))
      take()
    })
  ws.onmessage = (event) => messages.push(JSON.parse(String(event.data)))
  return { ws, next, opened: new Promise((resolve) => (ws.onopen = resolve)) }
}

test("greets the client and answers a ping", async () => {
  core = startCore({ token: "secret", dir: process.cwd() })
  const client = connect(core.port, "secret")
  await client.opened
  expect(await client.next()).toMatchObject({ type: "hello", protocol: 1, bun: Bun.version })
  client.ws.send(JSON.stringify({ type: "ping", id: 7 }))
  expect(await client.next()).toEqual({ type: "pong", id: 7 })
  client.ws.close()
})

test("rejects a client without the token", async () => {
  core = startCore({ token: "secret", dir: process.cwd() })
  const response = await fetch(`http://127.0.0.1:${core.port}/?token=wrong`)
  expect(response.status).toBe(403)
})
