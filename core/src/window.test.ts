import { expect, test } from "bun:test"
import type { CoreMessage, TabInfo } from "@desk/protocol"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "./test-support"
import { Window } from "./window"

useTempHome()

const tab = (id: string, project: string): TabInfo => ({ id, title: "New session", project, terminals: [], model: "default", permissionMode: "default" })
const saved = () => JSON.parse(readFileSync(join(process.env.DESK_HOME!, "window.json"), "utf8"))

/** A window whose saved file holds `state`, and the messages it sends. */
function open(state: object) {
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify(state))
  const sent: CoreMessage[] = []
  const window = new Window({ broadcast: (message) => sent.push(message), compactIdle: () => false, rateLimit: () => {}, tabClosed: () => {} })
  return { window, sent }
}

test("refuses to move a tab whose thread has started, and moves one that has not", () => {
  const [one, two] = [tempFolder("one"), tempFolder("two")]
  const { window } = open({ tabs: [tab("started", one), tab("fresh", one)], threads: { started: { sessionId: "s1" } }, recent: [] })
  expect(() => window.save([tab("started", two), tab("fresh", one)], "started")).toThrow("only before its thread starts")
  window.save([tab("started", one), tab("fresh", two)], "fresh")
  expect(saved().tabs.map((found: TabInfo) => found.project)).toEqual([one, two])
})

test("drops a closed tab's thread and remembers the folders tabs open, most recent first", () => {
  const [one, two] = [tempFolder("one"), tempFolder("two")]
  const { window, sent } = open({ tabs: [tab("a", one)], threads: { a: { sessionId: "s1" } }, recent: [one] })
  window.save([tab("b", two)], "b")
  expect(saved().threads).toEqual({})
  expect(sent.at(-1)).toEqual({ type: "recent", projects: [two, one] })
})

test("leaves a deleted folder out of the recent list, and lets an older tab in one still save", async () => {
  const one = tempFolder("one")
  const gone = join(one, "gone")
  const { window, sent } = open({ tabs: [tab("a", gone)], threads: {}, recent: [gone, one] })
  window.save([tab("a", gone), tab("b", one)], "b")
  await window.greet((message) => sent.push(message))
  expect(sent.filter((message) => message.type === "recent").at(-1)).toEqual({ type: "recent", projects: [one] })
})

test("refuses a tab that opens a folder that is not there", () => {
  const { window } = open({ tabs: [], threads: {}, recent: [] })
  expect(() => window.save([tab("a", "/no/such/folder")], "a")).toThrow("not a folder")
})
