import { expect, test } from "bun:test"
import type { CoreMessage, ThreadItem } from "@desk/protocol"
import { Clients } from "./clients"

/** A client that keeps what it was sent. */
const socket = () => {
  const got: CoreMessage[] = []
  return { got, send: (data: string) => void got.push(JSON.parse(data)), rows: () => got.filter((message) => message.type === "session.rows") }
}

const user = (id: string): ThreadItem => ({ type: "user", id, text: id })
const text = (id: string): ThreadItem => ({ type: "text", id, text: id, done: true })

test("each client gets the rows that follow what it was sent, and a reply to one client never changes another's", () => {
  const clients = new Clients()
  const [a, b] = [socket(), socket()]
  clients.add(a)
  clients.add(b)
  clients.broadcast({ type: "session.history", tabId: "t", items: [user("u1")] })
  expect([a.rows().length, b.rows().length]).toEqual([1, 1])

  // A resumes another thread in the tab. Only A is sent its history.
  clients.replyTo(a)({ type: "session.history", tabId: "t", items: [user("u9"), text("x9")] })
  expect([a.rows().length, b.rows().length]).toEqual([2, 1])

  // The next event is laid out against what each client holds.
  clients.broadcast({ type: "session.event", tabId: "t", event: { kind: "item", item: text("x1") } })
  const ids = (client: ReturnType<typeof socket>) => (client.rows().at(-1) as Extract<CoreMessage, { type: "session.rows" }>).rows.map((row) => row.id)
  expect(ids(b)).toEqual(["u1", "x1"])
  expect(ids(a)).toEqual(["u9", "x9", "x1"])
})

test("a client that left is sent nothing", () => {
  const clients = new Clients()
  const a = socket()
  clients.add(a)
  clients.remove(a)
  clients.broadcast({ type: "recent", projects: [] })
  clients.replyTo(a)({ type: "recent", projects: [] })
  expect(a.got).toEqual([])
})
