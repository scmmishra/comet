import { expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { git, gitBinary, TRUNCATED } from "./git"
import { gitRepo } from "./test-support"

test("cuts output at its cap when asked, and fails past it otherwise", async () => {
  const { dir } = gitRepo({ "a.ts": "one\n".repeat(1000) })
  const whole = await git(dir, ["show", "HEAD:a.ts"])
  expect(whole.length).toBe(4000)
  expect(await git(dir, ["show", "HEAD:a.ts"], { maxBytes: 10, overflow: "truncate" })).toBe(`one\none\non${TRUNCATED}`)
  await expect(git(dir, ["show", "HEAD:a.ts"], { maxBytes: 10 })).rejects.toThrow("more than 10 bytes")
  expect(await git(dir, ["show", "HEAD:a.ts"], { maxBytes: 4000 })).toBe(whole)
})

test("never runs in a bare repository found inside a project, whose config could run commands", async () => {
  const { dir, git: run } = gitRepo({ "a.ts": "one\n" })
  const bare = join(dir, "vendor", "trap.git")
  mkdirSync(bare, { recursive: true })
  Bun.spawnSync(["git", "init", "-q", "--bare", bare])
  run("config", "core.fsmonitor", "true")
  await expect(git(bare, ["rev-parse", "--git-dir"])).rejects.toThrow("cannot use bare repository")
  expect((await git(dir, ["rev-parse", "--show-toplevel"])).trim()).toEndWith(dir.split("/").pop()!)
})

test("reads its input from what Comet writes", async () => {
  const { dir } = gitRepo({ "a.ts": "one\n" })
  expect((await git(dir, ["hash-object", "--stdin"], { input: "one\n" })).trim()).toBe((await git(dir, ["rev-parse", "HEAD:a.ts"])).trim())
})

test("runs the binary that git on the PATH names, and looks it up again when the PATH changes", async () => {
  const binary = await gitBinary()
  expect(binary).toEndWith("/git")
  expect(Bun.spawnSync([binary, "--version"]).stdout.toString()).toStartWith("git version")
  const path = process.env.PATH
  try {
    process.env.PATH = "/nowhere"
    expect(await gitBinary()).toBe("git")
  } finally {
    process.env.PATH = path
  }
  expect(await gitBinary()).toBe(binary)
})
