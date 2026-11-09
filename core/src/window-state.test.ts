import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { useTempHome } from "./test-support"
import { loadWindowState, saveWindowState } from "./window-state"

useTempHome()

test("an empty window when nothing is saved", () => {
  expect(loadWindowState()).toEqual({ tabs: [], threads: {}, recent: [] })
})

test("saves and loads the window's tabs across projects, with each tab's thread", () => {
  const desk = { id: "t1", title: "Fix tabs", project: "/work/desk", terminals: [{ id: "x1", title: "Terminal" }], panelActive: "x1", model: "opus", effort: "high" as const, fast: true, permissionMode: "acceptEdits" as const }
  const chatwoot = { id: "t2", title: "Inbox", project: "/work/chatwoot", terminals: [], model: "default", permissionMode: "default" as const }
  const state = { tabs: [desk, chatwoot], active: "t2", threads: { t1: { sessionId: "s1", baseline: "abc" } }, recent: ["/work/chatwoot", "/work/desk"] }
  saveWindowState(state)
  expect(loadWindowState()).toEqual(state)
})

test("drops a saved tab that is not whole", () => {
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify({ tabs: [{ id: "t1", title: "No project" }], threads: {}, recent: [] }))
  expect(loadWindowState().tabs).toEqual([])
})
