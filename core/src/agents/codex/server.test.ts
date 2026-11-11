import { expect, test } from "bun:test"
import { until } from "../../test-support"
import { fakeAppServer } from "./test-app-server"
import { AppServer } from "./server"

test("starts one app-server on the first request, greets it, and shares it", async () => {
  const codex = fakeAppServer()
  codex.answer("account/read", { account: null, requiresOpenaiAuth: true })
  const server = new AppServer(codex.launch)
  expect(codex.launches).toBe(0)
  await Promise.all([server.request("account/read", { refreshToken: false }), server.version()])
  expect(codex.launches).toBe(1)
  expect(codex.sent("initialize")).toEqual([{ clientInfo: { name: "desk", title: "Desk", version: expect.any(String) }, capabilities: { experimentalApi: true } }])
  expect(codex.sent("initialized")).toEqual([undefined])
  expect(await server.version()).toBe("0.167.0")
})

test("sends a thread's messages to its owner, and the rest to listeners", async () => {
  const codex = fakeAppServer()
  const server = new AppServer(codex.launch)
  await server.version()
  const heard: string[] = []
  const release = server.own("t1", { notify: (method) => void heard.push(`t1 ${method}`), request: () => Promise.resolve({ decision: "accept" }), lost: () => {} })
  server.on("account/rateLimits/updated", () => void heard.push("limits"))
  codex.notify("turn/started", { threadId: "t1", turn: { id: "u1" } })
  codex.notify("turn/started", { threadId: "t2", turn: { id: "u2" } })
  codex.notify("account/rateLimits/updated", { rateLimits: {} })
  codex.ask(0, "item/commandExecution/requestApproval", { threadId: "t1", itemId: "i1" })
  codex.ask(1, "item/commandExecution/requestApproval", { threadId: "t2", itemId: "i2" })
  await until(() => codex.reply(0) !== undefined && codex.reply(1) !== undefined)
  expect(heard).toEqual(["t1 turn/started", "limits"])
  expect(codex.reply(0)).toEqual({ id: 0, result: { decision: "accept" } })
  expect(codex.reply(1)).toEqual({ id: 1, error: { code: -32601, message: "Desk does not handle that request." } })
  release()
  codex.notify("turn/started", { threadId: "t1", turn: { id: "u3" } })
  await Bun.sleep(20)
  expect(heard).toHaveLength(2)
})

test("tells each owner once the app-server ends, and starts a new one on the next request", async () => {
  const codex = fakeAppServer()
  const server = new AppServer(codex.launch)
  await server.version()
  const lost: string[] = []
  const owner = { notify: () => {}, request: () => undefined, lost: (error: Error) => void lost.push(error.message) }
  server.own("t1", owner)
  server.own("child", owner)
  codex.hangUp()
  await until(() => lost.length > 0)
  expect(lost).toEqual(["The agent's process ended."])
  await server.version()
  expect(codex.launches).toBe(2)
})
