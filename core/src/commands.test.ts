import { afterAll, beforeAll, expect, test } from "bun:test"
import type { CommandInfo } from "@desk/protocol"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Commands } from "./commands"

const home = mkdtempSync(join(tmpdir(), "desk-home-"))
const space = mkdtempSync(join(tmpdir(), "desk-space-"))
beforeAll(() => (process.env.DESK_HOME = home))
afterAll(() => {
  delete process.env.DESK_HOME
  rmSync(home, { recursive: true, force: true })
  rmSync(space, { recursive: true, force: true })
})

const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await Bun.sleep(20)
}

const watch = () => {
  let latest: readonly CommandInfo[] = []
  const commands = new Commands(space, (list) => (latest = list))
  const clear = () => commands.remove(commands.list().map((command) => command.id))
  return { commands, clear, run: (name: string) => latest.find((command) => command.name === name)?.run }
}

const shape = (list: readonly CommandInfo[]) => list.map(({ name, command, group }) => ({ name, command, group }))

test("saves one process as a plain command, and loads it in a new core", () => {
  const { commands, clear } = watch()
  commands.save(" Dev ", [{ name: "", command: " bun run dev " }], [])
  const [dev] = commands.list()
  commands.save("Dev server", [{ id: dev!.id, name: "", command: "bun run dev" }], [dev!.id])
  expect(new Commands(space, () => {}).list()).toEqual([{ id: dev!.id, name: "Dev server", command: "bun run dev", run: { state: "idle" } }])
  clear()
})

test("saves several processes as a group, in the place of what they replace", () => {
  const { commands, clear } = watch()
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
  // The replaced command keeps its id.
  expect(commands.list()[1]!.id).toBe(web.id)
  clear()
})

test("refuses a draft with no name, an empty command or two processes with one name", () => {
  const { commands } = watch()
  expect(() => commands.save(" ", [{ name: "", command: "ls" }], [])).toThrow()
  expect(() => commands.save("List", [{ name: "", command: "" }], [])).toThrow()
  expect(() => commands.save("Dev", [{ name: "", command: "a" }, { name: "Web", command: "b" }], [])).toThrow()
  expect(() => commands.save("Dev", [{ name: "Web", command: "a" }, { name: "Web", command: "b" }], [])).toThrow()
  expect(commands.list()).toEqual([])
})

test("reports a run that exits, and one that fails with its code", async () => {
  const { commands, clear, run } = watch()
  commands.save("Ok", [{ name: "", command: "true" }], [])
  commands.save("Bad", [{ name: "", command: "exit 3" }], [])
  for (const command of commands.list()) commands.run(command.id)
  expect(run("Ok")).toEqual({ state: "running" })
  await until(() => run("Ok")?.state === "exited" && run("Bad")?.state === "failed")
  expect(run("Ok")).toEqual({ state: "exited" })
  expect(run("Bad")).toEqual({ state: "failed", code: 3 })
  clear()
})

test("runs at the space's root and stops the processes a command starts", async () => {
  const { commands, clear, run } = watch()
  const marker = join(space, "child-alive")
  // The command starts a child that writes a file after a pause. Stop must end the child too.
  commands.save("Server", [{ name: "", command: `pwd > "$DESK_SPACE_ROOT/where"; (sleep 0.5; touch "${marker}") & wait` }], [])
  const [server] = commands.list()
  commands.run(server!.id)
  await until(() => existsSync(join(space, "where")))
  expect(await Bun.file(join(space, "where")).text()).toContain(space.split("/").pop()!)
  commands.stop(server!.id)
  expect(run("Server")).toEqual({ state: "idle" })
  await Bun.sleep(800)
  expect(existsSync(marker)).toBe(false)
  clear()
})

test("runs and stops a group together, and removing a group stops it", () => {
  const { commands, clear, run } = watch()
  commands.save(
    "Dev",
    [
      { name: "Web", command: "sleep 30" },
      { name: "Worker", command: "sleep 30" },
    ],
    [],
  )
  commands.save("Solo", [{ name: "", command: "sleep 30" }], [])
  commands.runGroup("Dev")
  expect([run("Web"), run("Worker"), run("Solo")]).toEqual([{ state: "running" }, { state: "running" }, { state: "idle" }])
  commands.stopGroup("Dev")
  expect([run("Web"), run("Worker")]).toEqual([{ state: "idle" }, { state: "idle" }])
  commands.runGroup("Dev")
  commands.remove(commands.list().filter((command) => command.group === "Dev").map((command) => command.id))
  expect(commands.list().map((command) => command.name)).toEqual(["Solo"])
  expect(run("Web")).toBeUndefined()
  clear()
})
