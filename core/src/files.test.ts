import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { findNamedFile, openableFile, readForView } from "./files"
import { gitRepo, tempFolder, useTempHome } from "./test-support"

useTempHome()

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

test("reads a file for the panel: text whole, an image as an image, binary as binary, and a long file to its last full line", () => {
  writeFileSync(join(dir, "café.txt"), "héllo\nworld\n")
  expect(readForView(dir, "café.txt")).toEqual({ path: join(dir, "café.txt"), text: "héllo\nworld\n" })
  writeFileSync(join(dir, "shot.PNG"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
  expect(readForView(dir, "shot.PNG")).toEqual({ path: join(dir, "shot.PNG"), image: true })
  writeFileSync(join(dir, "data.bin"), Buffer.from([0x01, 0x00, 0x02]))
  expect(readForView(dir, "data.bin")).toEqual({ path: join(dir, "data.bin"), binary: true })
  // Lines of 100 bytes, past the megabyte the panel shows.
  writeFileSync(join(dir, "long.log"), `${"x".repeat(99)}\n`.repeat(10_050))
  const long = readForView(dir, "long.log")
  expect(long).toMatchObject({ truncated: true })
  expect(long.text!.length).toBe(1_000_000)
  expect(long.text!.endsWith("x\n")).toBe(true)
})

test("reads a missing path or a folder for the panel as missing", () => {
  expect(readForView(dir, "src/gone.ts")).toEqual({ path: join(dir, "src", "gone.ts"), missing: true })
  expect(readForView(dir, "src")).toEqual({ path: join(dir, "src"), missing: true })
})

test("finds the one file a shortened path or a bare name names, and keeps the path as written otherwise", async () => {
  const { dir: repo, write } = gitRepo({
    "app/views/api/models/_contact.json.jbuilder": "",
    "app/models/contact.rb": "",
    "enterprise/app/models/contact.rb": "",
    "README.md": "",
  })
  write("notes/draft.md", "")
  const at = (path: string) => join(repo, path)

  expect(await findNamedFile(repo, "README.md")).toBe(at("README.md"))
  expect(await findNamedFile(repo, "api/models/_contact.json.jbuilder")).toBe(at("app/views/api/models/_contact.json.jbuilder"))
  expect(await findNamedFile(repo, "_contact.json.jbuilder")).toBe(at("app/views/api/models/_contact.json.jbuilder"))
  // A file Git does not track yet is found too.
  expect(await findNamedFile(repo, "draft.md")).toBe(at("notes/draft.md"))
  // Two files end with it, so neither is picked.
  expect(await findNamedFile(repo, "models/contact.rb")).toBe(at("models/contact.rb"))
  // A suffix must start at a folder: `ontact.rb` is no file's tail.
  expect(await findNamedFile(repo, "ontact.rb")).toBe(at("ontact.rb"))
  // `./`, `../`, `~/` and `/` say where the path starts, so it is not looked up.
  expect(await findNamedFile(repo, "./_contact.json.jbuilder")).toBe(at("_contact.json.jbuilder"))
  expect(await findNamedFile(repo, "/elsewhere/README.md")).toBe("/elsewhere/README.md")
})

test("drops the project's own folders from a path that repeats them", async () => {
  const { dir: repo } = gitRepo({ "packages/web/src/a.ts": "" })
  const web = join(repo, "packages", "web")
  expect(await findNamedFile(web, "packages/web/src/a.ts")).toBe(join(web, "src", "a.ts"))
  expect(await findNamedFile(web, "web/src/a.ts")).toBe(join(web, "src", "a.ts"))
})
