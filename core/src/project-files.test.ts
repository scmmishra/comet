import { expect, test } from "bun:test"
import { searchFiles } from "./project-files"
import { gitRepo, useTempHome } from "./test-support"

useTempHome()

test("finds files by name before path, leaves ignored files out, and lists shallow files for an empty query", async () => {
  const { dir, write } = gitRepo({
    ".gitignore": "node_modules\n",
    "README.md": "",
    "core/src/main.ts": "",
    "core/src/main.test.ts": "",
    "app/src/domain/main-menu.ts": "",
    "docs/maintaining.md": "",
  })
  write("node_modules/main/index.js", "")
  write("notes.md", "")

  expect((await searchFiles(dir, "main.ts"))[0]).toBe("core/src/main.ts")
  // All four names start with "main", so the shorter path wins.
  expect(await searchFiles(dir, "main")).toEqual(["core/src/main.ts", "docs/maintaining.md", "core/src/main.test.ts", "app/src/domain/main-menu.ts"])
  expect(await searchFiles(dir, "src/dom")).toEqual(["app/src/domain/main-menu.ts"])
  expect(await searchFiles(dir, "crmn")).toEqual(["core/src/main.ts", "core/src/main.test.ts"])
  expect((await searchFiles(dir, "")).slice(0, 3)).toEqual(["notes.md", "README.md", ".gitignore"])
})
