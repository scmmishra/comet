import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spaceDataPath } from "./data-files"
import { loadWindowState, saveWindowState, windowStatePath } from "./window-state"

const home = mkdtempSync(join(tmpdir(), "desk-home-"))
beforeAll(() => (process.env.DESK_HOME = home))
afterAll(() => {
  delete process.env.DESK_HOME
  rmSync(home, { recursive: true, force: true })
})

test("names a project's data file after the folder and a hash of its path", () => {
  expect(spaceDataPath("commands", "/work/chatwoot")).toMatch(/commands\/chatwoot-[0-9a-f]{8}\.json$/)
  expect(spaceDataPath("commands", "/work/chatwoot")).not.toBe(spaceDataPath("commands", "/other/chatwoot"))
})

test("moves a project's old tabs into the window when there is no window file yet", () => {
  mkdirSync(dirname(spaceDataPath("spaces", "/work/old")), { recursive: true })
  writeFileSync(spaceDataPath("spaces", "/work/old"), JSON.stringify({ tabs: [{ id: "t1", title: "Old", sessionId: "s1" }], active: "t1" }))
  expect(loadWindowState("/work/old")).toEqual({
    tabs: [{ id: "t1", title: "Old", sessionId: "s1", project: "/work/old", terminals: [], model: "default", permissionMode: "default" }],
    active: "t1",
  })
})

test("saves and loads the window's tabs across projects", () => {
  const desk = { id: "t1", title: "Fix tabs", project: "/work/desk", sessionId: "s1", terminals: [{ id: "x1", title: "Terminal" }], panelActive: "x1", model: "opus", effort: "high" as const, fast: true, permissionMode: "acceptEdits" as const }
  const chatwoot = { id: "t2", title: "Inbox", project: "/work/chatwoot", terminals: [], model: "default", permissionMode: "default" as const }
  saveWindowState({ tabs: [desk, chatwoot], active: "t2" })
  // The window file wins over any project's old tabs.
  expect(loadWindowState("/work/old")).toEqual({ tabs: [desk, chatwoot], active: "t2" })
  rmSync(windowStatePath())
})
