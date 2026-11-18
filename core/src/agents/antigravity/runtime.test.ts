import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "../../test-support"
import { EXECUTABLE, geminiHome, markInstalled, runtimeFolder } from "./home"
import { environment, launch, onlyServerInstalled, resolveRuntime } from "./runtime"
import { BROWSER_COMMAND } from "./sign-in-link"

useTempHome()

const saved = { PATH: process.env.PATH, COMET_ANTIGRAVITY: process.env.COMET_ANTIGRAVITY }
beforeEach(() => {
  process.env.PATH = ""
  delete process.env.COMET_ANTIGRAVITY
})
afterEach(() => {
  process.env.PATH = saved.PATH
  if (saved.COMET_ANTIGRAVITY === undefined) delete process.env.COMET_ANTIGRAVITY
  else process.env.COMET_ANTIGRAVITY = saved.COMET_ANTIGRAVITY
})

/** A program in a new folder, by name, that runs `script`. */
function program(name: string, script = "") {
  const path = join(tempFolder("antigravity-bin"), name)
  writeFileSync(path, `#!/bin/sh\n${script}\n`)
  chmodSync(path, 0o755)
  return path
}

/** Installs a version as Comet would, finished or not. */
function install(version: string, finished = true) {
  mkdirSync(runtimeFolder(version), { recursive: true })
  writeFileSync(join(runtimeFolder(version), EXECUTABLE), "")
  if (finished) markInstalled(version)
}

test("runs the newest finished install of the CLI, never the ACP server an earlier Comet installed", () => {
  install("1.4.5")
  expect(resolveRuntime()).toBeUndefined()
  expect(onlyServerInstalled()).toBe(true)
  install("1.5.7")
  install("1.5.10")
  install("1.6.0", false)
  expect(resolveRuntime()).toEqual({ command: join(runtimeFolder("1.5.10"), EXECUTABLE), version: "1.5.10" })
  expect(onlyServerInstalled()).toBe(false)
})

test("runs COMET_ANTIGRAVITY first, by name on the PATH or by path, with no version Comet knows", () => {
  install("1.5.9")
  const agy = program("agy")
  process.env.PATH = join(agy, "..")
  process.env.COMET_ANTIGRAVITY = "agy"
  expect(resolveRuntime()).toEqual({ command: agy })
  process.env.COMET_ANTIGRAVITY = join(agy, "..", "missing")
  expect(resolveRuntime()).toBeUndefined()
})

test("starts the CLI's ACP server in Comet's own Gemini folder, without the user's Google credentials", async () => {
  const args = join(tempFolder("antigravity-args"), "args")
  const agy = program("agy", `printf '%s\\n' "$@" > '${args}'`)
  const started = launch({ command: agy }, tempFolder("antigravity-project"))
  await started.exited
  expect(readFileSync(args, "utf8").trim().split("\n")).toEqual(["acp", "--gemini-dir", geminiHome(), "--app-data-dir", "antigravity-acp"])
  const env = environment()
  // A variable set to undefined is removed from what the CLI inherits.
  for (const name of ["GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]) expect(name in env && env[name] === undefined).toBe(true)
  expect(env.BROWSER).toBe(BROWSER_COMMAND)
})
