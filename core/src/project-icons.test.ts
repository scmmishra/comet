import { afterAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findIconFiles, iconFile } from "./project-icons"

const repo = mkdtempSync(join(tmpdir(), "desk-icons-"))
afterAll(() => rmSync(repo, { recursive: true, force: true }))

const write = (path: string, body = "<svg/>") => {
  mkdirSync(join(repo, path, ".."), { recursive: true })
  writeFileSync(join(repo, path), body)
}

test("lists logo-like images, favicons and shallow logos first, without ignored folders", () => {
  spawnSync("git", ["init", "-q"], { cwd: repo })
  write(".gitignore", "node_modules\n")
  write("public/favicon.ico")
  write("app/assets/images/logo.svg")
  write("logo.png")
  write("docs/screenshot.png")
  write("node_modules/pkg/logo.svg")
  write("src/icons/check.txt")
  write("design/logo-print.png", "x".repeat(2 * 1024 * 1024))
  expect(findIconFiles(repo)).toEqual(["public/favicon.ico", "logo.png", "app/assets/images/logo.svg"])
})

test("serves only images inside the project", () => {
  expect(iconFile(repo, "logo.png")).toEqual({ path: join(repo, "logo.png"), type: "image/png" })
  expect(iconFile(repo, "../etc/logo.png")).toBeUndefined()
  expect(iconFile(repo, "/etc/hosts")).toBeUndefined()
  expect(iconFile(repo, ".gitignore")).toBeUndefined()
  expect(iconFile(repo, "missing.svg")).toBeUndefined()
})

test("finds nothing in a folder that is not a Git repo", () => {
  const plain = mkdtempSync(join(tmpdir(), "desk-plain-"))
  writeFileSync(join(plain, "logo.svg"), "<svg/>")
  expect(findIconFiles(plain)).toEqual([])
  rmSync(plain, { recursive: true, force: true })
})
