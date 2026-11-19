import { beforeEach, expect, test } from "bun:test"
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "./test-support"

// Each test gets a home of its own, so one that fails leaves nothing installed for the next.
beforeEach(() => useTempHome())

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

  expect(comet(project, "plugin", "add", source)).toEqual({ out: "Installed demo 1.0.0.\nTurn it on with `comet plugin on demo`.", code: 0 })
  expect(comet(project, "plugin", "on", "demo").out).toBe(`demo is on in ${project}.`)
  expect(JSON.parse(readFileSync(join(process.env.COMET_HOME!, "plugins.json"), "utf8")).projects).toEqual({ [project]: ["demo"] })
  expect(comet(project, "plugin", "list").out).toBe(`demo (Demo) 1.0.0\n  installed from ${realpathSync(source)}, on in ${project}`)
  expect(comet(project, "plugin", "remove", "demo")).toEqual({ out: "Removed demo.", code: 0 })
  expect(comet(project, "plugin", "remove", "demo").code).toBe(1)
  expect(comet(project, "plugin", "on").out).toStartWith("Name the plugin to turn on.")
}, 60_000)

test("asks for nothing without a terminal, and lists and sets a plugin's settings", () => {
  const source = join(tempFolder("source"), "prs")
  mkdirSync(source)
  const settings = [
    { key: "repo", title: "Repository", type: "string", required: true, description: "owner/name on GitHub." },
    { key: "drafts", title: "Show drafts", type: "boolean", default: false },
  ]
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "comet-plugin-prs", version: "1.0.0", comet: { name: "prs", api: "^0.2.0", settings } }))
  writeFileSync(join(source, "index.tsx"), "export default 1\n")
  const project = tempFolder("project")

  expect(comet(project, "plugin", "add", source).out).toBe("Installed prs 1.0.0.\nSet its settings with `comet plugin set prs`.\nTurn it on with `comet plugin on prs`.")
  expect(comet(project, "plugin", "list").out).toContain("needs setup: Repository. Run `comet plugin set prs`.")
  expect(comet(project, "plugin", "set", "prs").out).toBe('repo  Repository (required): not set\n  owner/name on GitHub.\ndrafts  Show drafts: no')
  expect(comet(project, "plugin", "set", "prs", "repo", "chatwoot/chatwoot").out).toBe("Saved Repository for prs.")
  expect(comet(project, "plugin", "set", "prs", "drafts", "yes").out).toBe("Saved Show drafts for prs.")
  expect(comet(project, "plugin", "set", "prs", "drafts", "maybe")).toEqual({ out: "Show drafts is a switch: answer yes or no.", code: 1 })
  expect(comet(project, "plugin", "set", "prs").out).toBe('repo  Repository (required): "chatwoot/chatwoot"\n  owner/name on GitHub.\ndrafts  Show drafts: yes')
  expect(comet(project, "plugin", "list").out).not.toContain("needs setup")
  comet(project, "plugin", "set", "prs", "drafts")
  expect(comet(project, "plugin", "set", "prs").out).toEndWith("Show drafts: no")
}, 60_000)
