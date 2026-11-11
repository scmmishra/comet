import { expect, test } from "bun:test"
import { fileEdits } from "./diff"

test("makes each hunk of an update one edit, from its removed and added lines", () => {
  const diff = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,3 +1,3 @@", " import x", "-const a = 1", "+const a = 2", " export a", "@@ -10,2 +10,3 @@", " end", "+added", "\\ No newline at end of file"].join("\n")
  expect(fileEdits({ path: "/p/src/a.ts", kind: { type: "update", move_path: null }, diff })).toEqual([
    { before: "const a = 1", after: "const a = 2" },
    { before: "", after: "added" },
  ])
})

test("reads an added or deleted file's whole text, as Codex gives it", () => {
  expect(fileEdits({ path: "/p/new.txt", kind: { type: "add" }, diff: "codex app-server approval fixture.\n" })).toEqual([{ before: "", after: "codex app-server approval fixture.\n" }])
  expect(fileEdits({ path: "/p/old.txt", kind: { type: "delete" }, diff: "gone\n" })).toEqual([{ before: "gone\n", after: "" }])
})
