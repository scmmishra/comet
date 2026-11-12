import { expect, test } from "bun:test"
import { toolStep } from "./steps"

const label = (name: string, summary: string, extra: { file?: string; result?: { output: string; isError: boolean } } = { result: { output: "", isError: false } }) =>
  toolStep({ type: "tool", id: `${name}:${summary}`, name, summary, ...extra }).label

test("labels each of Claude Code's tools by what it did", () => {
  expect(label("Read", "core/src/main.ts")).toBe("Read core/src/main.ts")
  expect(label("Edit", "x", { file: "app/a.ts" })).toBe("Edited app/a.ts")
  expect(label("Grep", "a\n  b")).toBe("Searched a b")
  expect(label("Bash", "npm test")).toBe("Ran npm")
  expect(label("Bash", "npm test", {})).toBe("Running npm")
})

test("sorts Claude Code's tools into the kinds a group counts", () => {
  const kind = (name: string) => toolStep({ type: "tool", id: name, name, summary: "x" }).kind
  expect(["Read", "Bash", "Edit", "Grep", "WebFetch", "mcp__github__search"].map(kind)).toEqual(["read", "command", "edit", "search", "web", "other"])
})
