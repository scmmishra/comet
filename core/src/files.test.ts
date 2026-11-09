import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { projectFile } from "./files"
import { tempFolder } from "./test-support"

const dir = tempFolder("files")
mkdirSync(join(dir, "src"))
writeFileSync(join(dir, "src", "a.ts"), "")

test("resolves relative and absolute paths inside the project", () => {
  expect(projectFile(dir, "src/a.ts")).toBe(join(dir, "src", "a.ts"))
  expect(projectFile(dir, "./src/a.ts")).toBe(join(dir, "src", "a.ts"))
  expect(projectFile(dir, join(dir, "src", "a.ts"))).toBe(join(dir, "src", "a.ts"))
})

test("refuses paths outside the project, folders and missing files", () => {
  expect(projectFile(dir, "../etc/passwd")).toBeUndefined()
  expect(projectFile(dir, "/etc/hosts")).toBeUndefined()
  expect(projectFile(dir, "src")).toBeUndefined()
  expect(projectFile(dir, "src/missing.ts")).toBeUndefined()
})
