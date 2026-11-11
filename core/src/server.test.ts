import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ClientMessage, CoreMessage } from "@desk/protocol"
import { startCore, type CoreServer } from "./server"
import { tempFolder } from "./test-support"

// Each test starts on an empty ~/.desk of its own, so no test sees tabs another saved.
beforeEach(() => (process.env.DESK_HOME = mkdtempSync(join(tmpdir(), "desk-home-"))))

let core: CoreServer | undefined
afterEach(() => {
  core?.stop()
  rmSync(process.env.DESK_HOME!, { recursive: true, force: true })
})

/** A client of a fresh core. `next(type)` waits for the next message of that type. */
async function connect() {
  core = startCore({ token: "secret" })
  const ws = new WebSocket(`ws://127.0.0.1:${core.port}/?token=secret`)
  const messages: CoreMessage[] = []
  ws.onmessage = (event) => messages.push(JSON.parse(String(event.data)))
  await new Promise((resolve) => (ws.onopen = resolve))
  const next = <T extends CoreMessage["type"]>(type: T) =>
    new Promise<Extract<CoreMessage, { type: T }>>((resolve) => {
      const take = () => {
        const index = messages.findIndex((message) => message.type === type)
        if (index < 0) return setTimeout(take, 5)
        resolve(messages.splice(index, 1)[0] as Extract<CoreMessage, { type: T }>)
      }
      take()
    })
  return { next, send: (message: ClientMessage) => ws.send(JSON.stringify(message)), close: () => ws.close() }
}

const tab = (project: string) => ({ id: "t1", title: "New session", project, terminals: [], agent: "claude" as const, model: "default", permissionMode: "default" as const })

test("greets a client with the settings, the saved tabs and the recent folders", async () => {
  const client = await connect()
  expect(await client.next("settings")).toMatchObject({ settings: { appearance: { theme: "dark" } } })
  expect(await client.next("tabs")).toMatchObject({ tabs: [] })
  expect(await client.next("recent")).toEqual({ type: "recent", projects: [] })
  client.close()
})

test("rejects a client without the token", async () => {
  core = startCore({ token: "secret" })
  expect((await fetch(`http://127.0.0.1:${core.port}/?token=wrong`)).status).toBe(403)
})

test("refuses a tab whose project is not a folder, and remembers a folder a tab opens", async () => {
  const client = await connect()
  await client.next("recent")
  client.send({ type: "tabs.save", tabs: [tab("/no/such/folder")] })
  expect(await client.next("error")).toMatchObject({ message: expect.stringContaining("not a folder") })
  const project = tempFolder("recent")
  client.send({ type: "tabs.save", tabs: [tab(project)] })
  expect((await client.next("recent")).projects).toContain(project)
  client.close()
})

test("follows a thread's history with its rows", async () => {
  const client = await connect()
  await client.next("recent")
  client.send({ type: "tabs.save", tabs: [tab(tempFolder("rows"))] })
  await client.next("recent")
  client.send({ type: "thread.clear", tabId: "t1" })
  expect(await client.next("session.history")).toMatchObject({ tabId: "t1", items: [] })
  expect(await client.next("session.rows")).toEqual({ type: "session.rows", tabId: "t1", rows: [] })
  client.close()
})

test("clears the effort when the app sends null", async () => {
  const client = await connect()
  await client.next("settings")
  client.send({ type: "settings.update", change: { agent: { id: "codex", defaults: { effort: "high" } } } })
  expect((await client.next("settings")).settings.agents.codex.effort).toBe("high")
  client.send({ type: "settings.update", change: { agent: { id: "codex", defaults: { effort: null } } } })
  expect((await client.next("settings")).settings.agents.codex.effort).toBeUndefined()
  client.close()
})

test("keeps each project's commands apart", async () => {
  const one = tempFolder("one")
  const two = tempFolder("two")
  const client = await connect()
  client.send({ type: "commands.save", project: one, name: "Dev", processes: [{ name: "", command: "true" }], replacing: [] })
  expect(await client.next("project")).toMatchObject({ project: one, part: "commands", value: [{ name: "Dev" }] })
  client.send({ type: "project.get", project: two, part: "commands" })
  expect(await client.next("project")).toEqual({ type: "project", project: two, part: "commands", value: [] })
  client.close()
})

test("serves a project's icon and refuses a path outside it", async () => {
  core = startCore({ token: "secret" })
  const project = tempFolder("icon")
  await Bun.write(`${project}/logo.svg`, "<svg/>")
  const url = (path: string, token = "secret") => `http://127.0.0.1:${core!.port}/project-icon?token=${token}&dir=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`
  const found = await fetch(url("logo.svg"))
  expect(found.status).toBe(200)
  expect(found.headers.get("content-type")).toBe("image/svg+xml")
  expect((await fetch(url("../etc/hosts"))).status).toBe(404)
  expect((await fetch(url("logo.svg", "wrong"))).status).toBe(403)
})
