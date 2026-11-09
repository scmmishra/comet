import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverCommands, parseMiseTasks, parseProcfile } from "./command-sources"

const space = mkdtempSync(join(tmpdir(), "desk-sources-"))
afterAll(() => rmSync(space, { recursive: true, force: true }))

test("reads a Procfile's processes and skips comments", () => {
  expect(parseProcfile("web: bundle exec rails s -p 3000\n# a note\n\nworker: bundle exec sidekiq\n")).toEqual([
    { name: "web", command: "bundle exec rails s -p 3000" },
    { name: "worker", command: "bundle exec sidekiq" },
  ])
})

test("reads mise's tasks, without hidden ones or option-like names", () => {
  const json = JSON.stringify([{ name: "dev" }, { name: "secret", hide: true }, { name: "--all" }, { name: "lint fix" }])
  expect(parseMiseTasks(json)).toEqual([
    { name: "dev", command: "mise run dev" },
    { name: "lint fix", command: "mise run 'lint fix'" },
  ])
  expect(parseMiseTasks("not json")).toEqual([])
})

test("finds Procfiles and package.json scripts, run with the lockfile's package manager", async () => {
  writeFileSync(join(space, "Procfile.dev"), "web: bin/rails s\n")
  writeFileSync(join(space, "package.json"), JSON.stringify({ scripts: { dev: "vite", build: "vite build" } }))
  writeFileSync(join(space, "pnpm-lock.yaml"), "")
  const sources = await discoverCommands(space)
  expect(sources.find((source) => source.name === "Procfile.dev")?.commands).toEqual([{ name: "web", command: "bin/rails s" }])
  expect(sources.find((source) => source.name === "package.json")?.commands).toEqual([
    { name: "dev", command: "pnpm run dev" },
    { name: "build", command: "pnpm run build" },
  ])
})
