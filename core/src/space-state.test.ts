import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
  saveSpaceState("/work/desk", { tabs: [{ id: "t1", title: "Fix tabs", sessionId: "s1" }], active: "t1" })
  expect(loadSpaceState("/work/desk")).toEqual({ tabs: [{ id: "t1", title: "Fix tabs", sessionId: "s1" }], active: "t1" })
})

test("starts empty when nothing is saved", () => {
  expect(loadSpaceState("/work/never-opened")).toEqual({ tabs: [] })
})
