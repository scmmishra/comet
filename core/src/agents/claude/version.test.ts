import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { isNewer, updateChannel } from "./version"
import { tempFolder } from "../../test-support"

test("compares versions number by number", () => {
  expect(isNewer("2.1.330", "2.1.322")).toBe(true)
  expect(isNewer("2.2.0", "2.1.322")).toBe(true)
  expect(isNewer("2.1.322", "2.1.322")).toBe(false)
  expect(isNewer("2.1.9", "2.1.10")).toBe(false)
})

test("reads the update channel from Claude Code's settings, and falls back to latest", () => {
  const dir = tempFolder("claude-settings")
  const file = join(dir, "settings.json")
  writeFileSync(file, JSON.stringify({ autoUpdatesChannel: "stable" }))
  expect(updateChannel(file)).toBe("stable")
  writeFileSync(file, JSON.stringify({ autoUpdatesChannel: "nightly" }))
  expect(updateChannel(file)).toBe("latest")
  expect(updateChannel(join(dir, "missing.json"))).toBe("latest")
})
