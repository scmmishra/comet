import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "../../test-support"
import { markInstalled, runtimeFolder } from "./home"
import { RELEASE } from "./release"
import { environment, resolveRuntime } from "./runtime"

useTempHome()

const saved = { PATH: process.env.PATH, DESK_ANTIGRAVITY: process.env.DESK_ANTIGRAVITY }
beforeEach(() => {
  process.env.PATH = ""
  delete process.env.DESK_ANTIGRAVITY
})
afterEach(() => {
  process.env.PATH = saved.PATH
  if (saved.DESK_ANTIGRAVITY === undefined) delete process.env.DESK_ANTIGRAVITY
  else process.env.DESK_ANTIGRAVITY = saved.DESK_ANTIGRAVITY
})

/** Executable files in a new folder, by name. The folder is resolved, as the runtime resolves a server's path. */
function programs(...names: string[]) {
  const folder = realpathSync(tempFolder("antigravity-bin"))
  for (const name of names) {
    writeFileSync(join(folder, name), "#!/bin/sh\n")
    chmodSync(join(folder, name), 0o755)
  }
  return folder
}

test("finds the server on the PATH only with its harness beside its real path", () => {
  expect(resolveRuntime()).toBeUndefined()
  const lonely = programs(RELEASE.executable.name)
  const paired = programs(RELEASE.executable.name, RELEASE.harness.name)
  const linked = programs()
  symlinkSync(join(paired, RELEASE.executable.name), join(linked, RELEASE.executable.name))
  process.env.PATH = [lonely, linked].join(":")
  expect(resolveRuntime()).toEqual({ kind: "server", command: [join(paired, RELEASE.executable.name)], harness: join(paired, RELEASE.harness.name) })
})

test("prefers the runtime Desk installed to the PATH, and only once its install finished", () => {
  const onPath = programs(RELEASE.executable.name, RELEASE.harness.name)
  process.env.PATH = onPath
  const folder = runtimeFolder(RELEASE.version)
  mkdirSync(folder, { recursive: true })
  expect(resolveRuntime()?.command).toEqual([join(onPath, RELEASE.executable.name)])
  markInstalled(RELEASE.version)
  expect(resolveRuntime()).toEqual({ kind: "server", command: [join(folder, RELEASE.executable.name)], harness: join(folder, RELEASE.harness.name), version: RELEASE.version })
})

test("runs DESK_ANTIGRAVITY first: the agy CLI as `agy acp`, by name or path", () => {
  const cli = programs("agy")
  process.env.PATH = cli
  process.env.DESK_ANTIGRAVITY = "agy"
  expect(resolveRuntime()).toEqual({ kind: "cli", command: [join(cli, "agy"), "acp"] })
  process.env.DESK_ANTIGRAVITY = join(programs(RELEASE.executable.name), RELEASE.executable.name)
  expect(resolveRuntime()).toBeUndefined()
})

test("starts without the user's Google credentials, and gives the harness only to the server", () => {
  const server = environment({ kind: "server", command: ["server"], harness: "/rt/localharness_external" }, "/tmp/run-1")
  // A variable set to undefined is removed from what the runtime inherits.
  for (const name of ["GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]) expect(name in server && server[name] === undefined).toBe(true)
  expect(server.ANTIGRAVITY_HARNESS_PATH).toBe("/rt/localharness_external")
  expect("ANTIGRAVITY_HARNESS_PATH" in environment({ kind: "cli", command: ["agy", "acp"] }, "/tmp/run-2")).toBe(false)
})
