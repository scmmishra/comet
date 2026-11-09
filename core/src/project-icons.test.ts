import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { findIconFiles, iconFile } from "./project-icons"
import { gitRepo, tempFolder } from "./test-support"

test("lists logo-like images, favicons and shallow logos first, without ignored or oversized files", async () => {
  const repo = gitRepo({ ".gitignore": "node_modules\n" })
  for (const path of ["public/favicon.ico", "app/assets/images/logo.svg", "logo.png", "docs/screenshot.png", "node_modules/pkg/logo.svg", "src/icons/check.txt"]) repo.write(path, "<svg/>")
  repo.write("design/logo-print.png", "x".repeat(2 * 1024 * 1024))
  expect(await findIconFiles(repo.dir)).toEqual(["public/favicon.ico", "logo.png", "app/assets/images/logo.svg"])
})

test("serves only images inside the project", () => {
  const dir = tempFolder("icons")
  writeFileSync(join(dir, "logo.png"), "png")
  writeFileSync(join(dir, ".gitignore"), "")
  expect(iconFile(dir, "logo.png")).toEqual({ path: join(dir, "logo.png"), type: "image/png" })
  expect(iconFile(dir, "../etc/logo.png")).toBeUndefined()
  expect(iconFile(dir, "/etc/hosts")).toBeUndefined()
  expect(iconFile(dir, ".gitignore")).toBeUndefined()
  expect(iconFile(dir, "missing.svg")).toBeUndefined()
})

test("finds nothing in a folder that is not a Git repo", async () => {
  const plain = tempFolder("plain")
  writeFileSync(join(plain, "logo.svg"), "<svg/>")
  expect(await findIconFiles(plain)).toEqual([])
})
