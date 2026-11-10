import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { openableFile } from "./files"
import { tempFolder } from "./test-support"

const dir = tempFolder("files")
mkdirSync(join(dir, "src"))
writeFileSync(join(dir, "src", "a.ts"), "")
const elsewhere = tempFolder("elsewhere")
writeFileSync(join(elsewhere, "report.md"), "")

test("resolves relative paths in the project, and opens a file outside it", () => {
  expect(openableFile(dir, "src/a.ts")).toBe(join(dir, "src", "a.ts"))
  expect(openableFile(dir, "./src/a.ts")).toBe(join(dir, "src", "a.ts"))
  expect(openableFile(dir, join(elsewhere, "report.md"))).toBe(join(elsewhere, "report.md"))
  expect(openableFile(dir, `${elsewhere}/../${elsewhere.split("/").at(-1)}/report.md`)).toBe(join(elsewhere, "report.md"))
})

test("refuses folders and missing files", () => {
  expect(openableFile(dir, "src")).toBeUndefined()
  expect(openableFile(dir, elsewhere)).toBeUndefined()
  expect(openableFile(dir, "src/missing.ts")).toBeUndefined()
})
