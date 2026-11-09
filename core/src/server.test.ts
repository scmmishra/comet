import { afterAll, afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PROTOCOL_VERSION, type CoreMessage } from "@desk/protocol"
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
  expect(await client.next()).toMatchObject({ type: "hello", protocol: PROTOCOL_VERSION, bun: Bun.version, project: process.cwd() })
  expect(await client.next()).toMatchObject({ type: "settings" })
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

test("refuses a tab whose project is not a folder", async () => {
  core = startCore({ token: "secret", dir: process.cwd() })
  const client = connect(core.port, "secret")
  await client.opened
  await client.next()
  await client.next()
  await client.next()
  const tab = { id: "t1", title: "New session", project: "/no/such/folder", terminals: [], model: "default", permissionMode: "default" }
  client.ws.send(JSON.stringify({ type: "tabs.save", tabs: [tab] }))
  expect(await client.next()).toMatchObject({ type: "error" })
  client.ws.close()
})

test("keeps each project's commands apart", async () => {
  core = startCore({ token: "secret", dir: process.cwd() })
  const one = mkdtempSync(join(tmpdir(), "desk-one-"))
  const two = mkdtempSync(join(tmpdir(), "desk-two-"))
  const client = connect(core.port, "secret")
  await client.opened
  await client.next()
  await client.next()
  await client.next()
  client.ws.send(JSON.stringify({ type: "commands.save", project: one, name: "Dev", processes: [{ name: "", command: "true" }], replacing: [] }))
  expect(await client.next()).toMatchObject({ type: "commands", project: one, commands: [{ name: "Dev" }] })
  client.ws.send(JSON.stringify({ type: "commands.get", project: two }))
  expect(await client.next()).toEqual({ type: "commands", project: two, commands: [] })
  client.ws.close()
  rmSync(one, { recursive: true, force: true })
  rmSync(two, { recursive: true, force: true })
})
