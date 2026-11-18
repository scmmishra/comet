import { expect, test } from "bun:test"
import type { CommandInfo } from "@comet/protocol"
import { existsSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { Commands } from "./commands"
import { tempFolder, until, useTempHome } from "./test-support"

useTempHome()
const root = tempFolder("projects")

/** Commands in a project of their own, so each test starts empty. */
const project = () => {
  const dir = mkdtempSync(join(root, "project-"))
  let latest: readonly CommandInfo[] = []
  const commands = new Commands(dir, (list) => (latest = list))
  return { dir, commands, run: (name: string) => latest.find((command) => command.name === name)?.run, ids: () => commands.list().map((command) => command.id) }
}

const shape = (list: readonly CommandInfo[]) => list.map(({ name, command, group }) => ({ name, command, group }))

test("saves one process as a plain command, and loads it in a new core", () => {
  const { dir, commands } = project()
  commands.save(" Dev ", [{ name: "", command: " bun run dev " }], [])
  const [dev] = commands.list()
  commands.save("Dev server", [{ id: dev!.id, name: "", command: "bun run dev" }], [dev!.id])
  expect(new Commands(dir, () => {}).list()).toEqual([{ id: dev!.id, name: "Dev server", command: "bun run dev", run: { state: "idle" } }])
})

test("saves several processes as a group, in the place of what they replace, keeping the replaced id", () => {
  const { commands } = project()
  commands.save("Before", [{ name: "", command: "true" }], [])
  commands.save("Web", [{ name: "", command: "bin/rails s" }], [])
  commands.save("After", [{ name: "", command: "true" }], [])
  const web = commands.list()[1]!
  commands.save(
    "Dev",
    [
      { id: web.id, name: "Web", command: "bin/rails s" },
      { name: "Worker", command: "bundle exec sidekiq" },
    ],
    [web.id],
  )
  expect(shape(commands.list())).toEqual([
    { name: "Before", command: "true", group: undefined },
    { name: "Web", command: "bin/rails s", group: "Dev" },
    { name: "Worker", command: "bundle exec sidekiq", group: "Dev" },
    { name: "After", command: "true", group: undefined },
  ])
  expect(commands.list()[1]!.id).toBe(web.id)
})

test("refuses a draft with no name, an empty command or two processes with one name", () => {
  const { commands } = project()
  expect(() => commands.save(" ", [{ name: "", command: "ls" }], [])).toThrow()
  expect(() => commands.save("List", [{ name: "", command: "" }], [])).toThrow()
  expect(() => commands.save("Dev", [{ name: "", command: "a" }, { name: "Web", command: "b" }], [])).toThrow()
  expect(() => commands.save("Dev", [{ name: "Web", command: "a" }, { name: "Web", command: "b" }], [])).toThrow()
  expect(commands.list()).toEqual([])
})

test("reports a run that exits, and one that fails with its code", async () => {
  const { commands, run, ids } = project()
  commands.save("Ok", [{ name: "", command: "true" }], [])
  commands.save("Bad", [{ name: "", command: "exit 3" }], [])
  commands.run(ids())
  expect(run("Ok")).toEqual({ state: "running" })
  await until(() => run("Ok")?.state === "exited" && run("Bad")?.state === "failed")
  expect(run("Ok")).toEqual({ state: "exited" })
  expect(run("Bad")).toEqual({ state: "failed", code: 3 })
})

test("runs in the project's folder and stops the processes a command starts", async () => {
  const { dir, commands, run, ids } = project()
  const marker = join(dir, "child-alive")
  // The command starts a child that writes a file after a pause. Stop must end the child too.
  commands.save("Server", [{ name: "", command: `pwd > "$COMET_SPACE_ROOT/where"; (sleep 0.3; touch "${marker}") & wait` }], [])
  commands.run(ids())
  await until(() => existsSync(join(dir, "where")))
  expect(await Bun.file(join(dir, "where")).text()).toContain(dir.split("/").pop()!)
  commands.stop(ids())
  expect(run("Server")).toEqual({ state: "idle" })
  await Bun.sleep(1500)
  expect(existsSync(marker)).toBe(false)
})

test("runs and stops a group's commands together, and removing them stops them", () => {
  const { commands, run } = project()
  commands.save(
    "Dev",
    [
      { name: "Web", command: "sleep 30" },
      { name: "Worker", command: "sleep 30" },
    ],
    [],
  )
  commands.save("Solo", [{ name: "", command: "sleep 30" }], [])
  const dev = commands.list().filter((command) => command.group === "Dev").map((command) => command.id)
  commands.run(dev)
  expect([run("Web"), run("Worker"), run("Solo")]).toEqual([{ state: "running" }, { state: "running" }, { state: "idle" }])
  commands.stop(dev)
  expect([run("Web"), run("Worker")]).toEqual([{ state: "idle" }, { state: "idle" }])
  commands.run(dev)
  commands.remove(dev)
  expect(commands.list().map((command) => command.name)).toEqual(["Solo"])
  expect(run("Web")).toBeUndefined()
  commands.stopAll()
})
