import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "./test-support"

useTempHome()

/** Runs `comet plugin …` in `cwd`, as `bin/comet` does, and answers its output and exit code. */
function comet(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "cli.ts"), ...args], { cwd, env: { ...process.env, PWD: cwd }, stdout: "pipe", stderr: "pipe" })
  return { out: `${run.stdout}${run.stderr}`.trim(), code: run.exitCode }
}

test("installs a plugin, turns it on in the project it runs in, lists it and removes it", () => {
  const source = join(tempFolder("source"), "demo")
  mkdirSync(source)
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "comet-plugin-demo", version: "1.0.0", comet: { name: "demo", title: "Demo", api: "^0.2.0" } }))
  writeFileSync(join(source, "index.tsx"), "export default 1\n")
  const project = tempFolder("project")

  expect(comet(project, "plugin", "add", source)).toEqual({ out: "Installed demo 1.0.0. Turn it on with `comet plugin on demo`.", code: 0 })
  expect(comet(project, "plugin", "on", "demo").out).toBe(`demo is on in ${project}.`)
  expect(JSON.parse(readFileSync(join(process.env.COMET_HOME!, "plugins.json"), "utf8")).projects).toEqual({ [project]: ["demo"] })
  expect(comet(project, "plugin", "list").out).toBe(`demo (Demo) 1.0.0\n  installed from ${source}, on in ${project}`)
  expect(comet(project, "plugin", "remove", "demo")).toEqual({ out: "Removed demo.", code: 0 })
  expect(comet(project, "plugin", "remove", "demo").code).toBe(1)
  expect(comet(project, "plugin", "on").out).toStartWith("Name the plugin to turn on.")
}, 60_000)
