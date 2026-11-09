import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { loadSpaceState, saveSpaceState, spaceStatePath } from "./space-state"

const home = mkdtempSync(join(tmpdir(), "desk-home-"))
beforeAll(() => (process.env.DESK_HOME = home))
afterAll(() => {
  delete process.env.DESK_HOME
  rmSync(home, { recursive: true, force: true })
})

test("names the file after the folder and a hash of its path", () => {
  expect(spaceStatePath("/work/chatwoot")).toMatch(/spaces\/chatwoot-[0-9a-f]{8}\.json$/)
  expect(spaceStatePath("/work/chatwoot")).not.toBe(spaceStatePath("/other/chatwoot"))
})

test("saves and loads a space's tabs", () => {
  const tab = { id: "t1", title: "Fix tabs", sessionId: "s1", terminals: [{ id: "x1", title: "Terminal" }], panelActive: "x1" }
  saveSpaceState("/work/desk", { tabs: [tab], active: "t1" })
  expect(loadSpaceState("/work/desk")).toEqual({ tabs: [tab], active: "t1" })
})

test("gives tabs saved before panel terminals an empty terminal list", () => {
  mkdirSync(dirname(spaceStatePath("/work/old")), { recursive: true })
  writeFileSync(spaceStatePath("/work/old"), JSON.stringify({ tabs: [{ id: "t1", title: "Old" }] }))
  expect(loadSpaceState("/work/old")).toEqual({ tabs: [{ id: "t1", title: "Old", terminals: [] }], active: undefined })
})

test("starts empty when nothing is saved", () => {
  expect(loadSpaceState("/work/never-opened")).toEqual({ tabs: [] })
})
