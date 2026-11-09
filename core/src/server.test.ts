import { afterAll, afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CoreMessage } from "@desk/protocol"
import { startCore, type CoreServer } from "./server"

// Saved tabs go to a temporary folder, never the user's ~/.desk.
const home = mkdtempSync(join(tmpdir(), "desk-home-"))
process.env.DESK_HOME = home
afterAll(() => rmSync(home, { recursive: true, force: true }))

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
  expect(await client.next()).toEqual({ type: "tabs", tabs: [] })
  client.ws.send(JSON.stringify({ type: "ping", id: 7 }))
  expect(await client.next()).toEqual({ type: "pong", id: 7 })
  client.ws.close()
})

test("rejects a client without the token", async () => {
  core = startCore({ token: "secret", dir: process.cwd() })
  const response = await fetch(`http://127.0.0.1:${core.port}/?token=wrong`)
  expect(response.status).toBe(403)
})
