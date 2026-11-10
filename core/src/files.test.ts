import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { openableFile, readForView } from "./files"
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

test("reads a file for the panel: text whole, binary as binary, and a long file to its last full line", () => {
  writeFileSync(join(dir, "café.txt"), "héllo\nworld\n")
  expect(readForView(join(dir, "café.txt"))).toEqual({ path: join(dir, "café.txt"), text: "héllo\nworld\n" })
  writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
  expect(readForView(join(dir, "image.png"))).toEqual({ path: join(dir, "image.png"), binary: true })
  // Lines of 100 bytes, past the megabyte the panel shows.
  writeFileSync(join(dir, "long.log"), `${"x".repeat(99)}\n`.repeat(10_050))
  const long = readForView(join(dir, "long.log"))
  expect(long).toMatchObject({ truncated: true })
  expect(long.text!.length).toBe(1_000_000)
  expect(long.text!.endsWith("x\n")).toBe(true)
})
