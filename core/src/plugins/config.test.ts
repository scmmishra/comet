import { expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { useTempHome } from "../test-support"
import { pluginsOn } from "./config"
import { turnOn } from "./test-plugins"

useTempHome()

test("turns plugins on everywhere and for a project named by its folder, with ~ and a trailing slash", () => {
  turnOn({ everywhere: ["newrelic"], projects: { "~/work/chatwoot/": ["support"], "/work/other": ["other"] } })
  expect(pluginsOn(join(homedir(), "work/chatwoot"))).toEqual(["newrelic", "support"])
  expect(pluginsOn("/work/elsewhere")).toEqual(["newrelic"])
})

test("turns every plugin off without a file, and reports a broken one", () => {
  rmSync(join(process.env.DESK_HOME!, "plugins.json"), { force: true })
  expect(pluginsOn("/work/chatwoot")).toEqual([])
  writeFileSync(join(process.env.DESK_HOME!, "plugins.json"), "{ not json")
  expect(() => pluginsOn("/work/chatwoot")).toThrow("not valid JSON")
})
