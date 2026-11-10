import { expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useTempHome } from "./test-support"
import { loadWindowState, saveWindowState } from "./window-state"

useTempHome()

test("an empty window when nothing is saved", () => {
  expect(loadWindowState()).toEqual({ tabs: [], threads: {}, recent: [], keys: {}, layouts: {}, closed: [] })
})

test("saves and loads the window's tabs across projects, with each tab's thread", () => {
  const desk = { id: "t1", title: "Fix tabs", project: "/work/desk", terminals: [{ id: "x1", title: "Terminal" }], panelActive: "x1", model: "opus", effort: "high" as const, fast: true, permissionMode: "acceptEdits" as const }
  const chatwoot = { id: "t2", title: "Inbox", project: "/work/chatwoot", terminals: [], model: "default", permissionMode: "default" as const }
  const state = { tabs: [desk, chatwoot], active: "t2", threads: { t1: { sessionId: "s1", threadStart: "abc", turnFrom: "def", turnTo: "123" } }, recent: ["/work/chatwoot", "/work/desk"], keys: { "/work/desk\nconv-1": "s1" }, layouts: { t2: { sidebar: "support.inbox", panels: [{ panel: "support.conversation", params: { id: 1 } }], hiddenCards: [] } }, closed: [] }
  saveWindowState(state)
  expect(loadWindowState()).toEqual(state)
})

test("drops the bare snapshots a thread saved before checkpoints were commits, and keeps the rest of it", () => {
  const old = { t1: { sessionId: "s1", baseline: "abc", turnBaseline: "def", turnHead: "123" }, t2: { sessionId: "s2", threadStart: { tree: "abc", at: 1 }, turnStart: { tree: "def", at: 1 } } }
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify({ tabs: [], threads: old, recent: [], keys: {} }))
  expect(loadWindowState().threads).toEqual({ t1: { sessionId: "s1" }, t2: { sessionId: "s2" } })
})

test("drops a saved tab that is not whole", () => {
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify({ tabs: [{ id: "t1", title: "No project" }], threads: {}, recent: [], keys: {} }))
  expect(loadWindowState().tabs).toEqual([])
})

test("a dev Desk keeps its window apart from the installed Desk's", () => {
  const home = process.env.DESK_HOME!
  saveWindowState({ tabs: [], threads: {}, recent: ["/work/installed"], keys: {}, layouts: {}, closed: [] })
  process.env.DESK_INSTANCE = "dev"
  try {
    saveWindowState({ tabs: [], threads: {}, recent: ["/work/dev"], keys: {}, layouts: {}, closed: [] })
    expect(existsSync(join(home, "dev", "window.json"))).toBe(true)
    expect(loadWindowState().recent).toEqual(["/work/dev"])
  } finally {
    delete process.env.DESK_INSTANCE
  }
  expect(loadWindowState().recent).toEqual(["/work/installed"])
})
