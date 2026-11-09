import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveSpaceFile } from "./files"

const dir = mkdtempSync(join(tmpdir(), "desk-files-"))
mkdirSync(join(dir, "src"))
writeFileSync(join(dir, "src", "a.ts"), "")
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("resolves relative and absolute paths inside the space", () => {
  expect(resolveSpaceFile(dir, "src/a.ts")).toBe(join(dir, "src", "a.ts"))
  expect(resolveSpaceFile(dir, "./src/a.ts")).toBe(join(dir, "src", "a.ts"))
  expect(resolveSpaceFile(dir, join(dir, "src", "a.ts"))).toBe(join(dir, "src", "a.ts"))
})

test("refuses paths outside the space, folders and missing files", () => {
  expect(resolveSpaceFile(dir, "../etc/passwd")).toBeUndefined()
  expect(resolveSpaceFile(dir, "/etc/hosts")).toBeUndefined()
  expect(resolveSpaceFile(dir, "src")).toBeUndefined()
  expect(resolveSpaceFile(dir, "src/missing.ts")).toBeUndefined()
})
