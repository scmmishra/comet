import { expect, test } from "bun:test"
import type { CoreMessage, TabInfo } from "@desk/protocol"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gitRepo, tempFolder, useTempHome } from "./test-support"
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

test("reopens the tab closed last, in its place, with its thread and layout, and without its terminals", async () => {
  const [one, gone] = [tempFolder("one"), join(tempFolder("two"), "gone")]
  const kept = { ...tab("b", one), terminals: [{ id: "x1", title: "Terminal" }], panelActive: "x1" }
  const { window } = open({
    tabs: [tab("a", one), kept, tab("c", gone)],
    threads: { b: { threadStart: "abc", key: "conv-1" } },
    layouts: { b: { sidebar: "support.inbox", panels: [], hiddenCards: [] } },
    recent: [],
  })
  window.save([tab("a", one), tab("c", gone)], "a")
  window.save([tab("a", one)], "a")
  expect(saved().threads.b).toBeUndefined()

  const replies: CoreMessage[] = []
  // The tab closed last sits in a folder that is gone, so the one before it comes back.
  await window.reopenTab((message) => replies.push(message))
  expect(replies).toEqual([{ type: "tab.reopened", tab: { ...tab("b", one), terminals: [] }, index: 1 }])
  expect(saved().threads.b).toEqual({ threadStart: "abc", key: "conv-1" })
  expect(saved().layouts.b).toEqual({ sidebar: "support.inbox", panels: [], hiddenCards: [] })
  expect(saved().closed).toEqual([])

  const none: CoreMessage[] = []
  await window.reopenTab((message) => none.push(message))
  expect(none).toEqual([])
})

test("switches a tab's project back to the branch its thread last ran on, and says when it cannot", async () => {
  const repo = gitRepo({ "a.ts": "one\n" })
  repo.git("checkout", "-q", "-b", "feature")
  const { window, sent } = open({ tabs: [tab("a", repo.dir)], threads: { a: { branch: "main" } }, recent: [] })
  expect(await window.restoreBranch("a")).toBe(repo.dir)
  expect(repo.git("branch", "--show-current")).toBe("main")

  // A new thread on the tab has no branch, and the tab hears so.
  window.clearThread("a")
  expect(sent).toContainEqual({ type: "thread.branch", tabId: "a" })
  await expect(window.restoreBranch("a")).rejects.toThrow("no branch")
})

test("keeps a plugin thread's queue with the thread when the tab switches to another key, and brings it back", async () => {
  const project = tempFolder("plugin")
  const queued = { id: "m1", text: "Then check the refund" }
  // A paused queue stays put, so coming back shows it without sending.
  const { window, sent } = open({ tabs: [tab("a", project)], threads: { a: { key: "conv-1", queue: [queued], queueHeld: true } }, recent: [] })

  await window.openKey("a", { key: "conv-2" })
  expect(sent).toContainEqual({ type: "queue", tabId: "a", messages: [], held: false })
  expect(saved().keyed[`${project}\nconv-1`]).toEqual({ key: "conv-1", queue: [queued], queueHeld: true })

  sent.length = 0
  await window.openKey("a", { key: "conv-1" })
  expect(sent).toContainEqual({ type: "queue", tabId: "a", messages: [queued], held: true })
  expect(saved().threads.a).toEqual({ key: "conv-1", queue: [queued], queueHeld: true })
  expect(saved().keyed).toEqual({ [`${project}\nconv-2`]: { key: "conv-2" } })
})

test("keeps a closed tab's plugin thread under its key, and gives it back when the tab reopens", async () => {
  const project = tempFolder("plugin-close")
  const { window } = open({ tabs: [tab("a", project), tab("b", project)], threads: { a: { key: "conv-1", sessionId: "s1" } }, recent: [] })
  window.save([tab("b", project)], "b")
  expect(saved().keyed[`${project}\nconv-1`]).toEqual({ key: "conv-1", sessionId: "s1" })
  await window.reopenTab(() => {})
  expect(saved().keyed).toEqual({})
  expect(saved().threads.a).toEqual({ key: "conv-1", sessionId: "s1" })
})
