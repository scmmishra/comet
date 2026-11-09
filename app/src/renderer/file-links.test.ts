import { expect, test } from "bun:test"
import { fileLabel, fileReference } from "./file-links"

test("recognises repo-relative paths with and without a position", () => {
  expect(fileReference("core/src/space.ts")).toEqual({ path: "core/src/space.ts" })
  expect(fileReference("core/src/space.ts:37")).toEqual({ path: "core/src/space.ts", line: 37 })
  expect(fileReference("app/main.tsx:12:5")).toEqual({ path: "app/main.tsx", line: 12 })
  expect(fileReference("./README.md")).toEqual({ path: "./README.md" })
  expect(fileReference("README.md:4")).toEqual({ path: "README.md", line: 4 })
})

test("leaves code that is not a path alone", () => {
  for (const text of ["parseChanges", "git status --short", "a/b", "src/", "https://example.com/a.ts", "github.com/owner/repo", "v1.2.3/x", "src/…/x.ts", "README.md"]) {
    expect(fileReference(text)).toBeUndefined()
  }
})

test("labels a file by name and line", () => {
  expect(fileLabel({ path: "core/src/space.ts", line: 37 })).toBe("space.ts · L37")
  expect(fileLabel({ path: "core/src/space.ts" })).toBe("space.ts")
})
