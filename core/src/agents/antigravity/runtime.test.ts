import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "../../test-support"
import { writeJsonFile } from "../../data-files"
import { geminiHome, INSTALLED_MARKER, runtimeFolder } from "./home"
import { RELEASE } from "./release"
import { environment, resolveRuntime } from "./runtime"
import { BROWSER_COMMAND } from "./sign-in-link"

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
  expect(resolveRuntime()).toEqual({ command: [join(paired, RELEASE.executable.name)], harness: join(paired, RELEASE.harness.name) })
})

test("prefers the runtime Desk installed to the PATH, and only once its install finished", () => {
  process.env.PATH = programs(RELEASE.executable.name, RELEASE.harness.name)
  const folder = runtimeFolder(RELEASE.version)
  mkdirSync(folder, { recursive: true })
  expect(resolveRuntime()?.version).toBeUndefined()
  writeJsonFile(join(folder, INSTALLED_MARKER), { version: RELEASE.version })
  expect(resolveRuntime()).toEqual({ command: [join(folder, RELEASE.executable.name)], harness: join(folder, RELEASE.harness.name), version: RELEASE.version })
})

test("runs DESK_ANTIGRAVITY first: the agy CLI as `agy acp`, by name or path", () => {
  const cli = programs("agy")
  process.env.PATH = cli
  process.env.DESK_ANTIGRAVITY = "agy"
  expect(resolveRuntime()).toEqual({ command: [join(cli, "agy"), "acp"] })
  process.env.DESK_ANTIGRAVITY = join(programs(RELEASE.executable.name), RELEASE.executable.name)
  expect(resolveRuntime()).toBeUndefined()
})

test("starts the server signed in through Desk's own home, without the user's Google credentials", () => {
  const env = environment({ command: ["server"], harness: "/rt/localharness_external" }, "/tmp/run-1")
  expect(env).toMatchObject({ GEMINI_HOME: geminiHome(), AGY_ACP_FORCE_FILE_STORAGE: "1", PYTHONUNBUFFERED: "1", BROWSER: BROWSER_COMMAND, TMPDIR: "/tmp/run-1", ANTIGRAVITY_HARNESS_PATH: "/rt/localharness_external" })
  expect("GEMINI_API_KEY" in env && env.GEMINI_API_KEY).toBeUndefined()
  expect("GOOGLE_APPLICATION_CREDENTIALS" in env).toBe(true)
  expect(environment({ command: ["agy", "acp"] }, "/tmp/run-2").ANTIGRAVITY_HARNESS_PATH).toBeUndefined()
})
