import { expect, test } from "bun:test"
import { complete, matchCommands, triggerAt } from "./triggers"

test("finds the file mention the caret is in, at the start or after a space", () => {
  expect(triggerAt("@", 1)).toEqual({ kind: "file", start: 0, query: "" })
  expect(triggerAt("look at @src/ma", 15)).toEqual({ kind: "file", start: 8, query: "src/ma" })
  expect(triggerAt("look at @src/ma and", 15)).toEqual({ kind: "file", start: 8, query: "src/ma" })
})

test("leaves an email address, and a mention the caret has left, alone", () => {
  expect(triggerAt("mail me@example.com", 19)).toBeUndefined()
  expect(triggerAt("@src/main.ts done", 17)).toBeUndefined()
})

test("finds a command only at the start of the message, until its name ends", () => {
  expect(triggerAt("/", 1)).toEqual({ kind: "command", start: 0, query: "" })
  expect(triggerAt("/comp", 5)).toEqual({ kind: "command", start: 0, query: "comp" })
  expect(triggerAt("/compact now", 12)).toBeUndefined()
  expect(triggerAt("see /usr", 8)).toBeUndefined()
})

test("puts the completion in place of what was typed, with one space after it", () => {
  expect(complete("see @ma please", 4, 7, "@core/src/main.ts")).toEqual({ text: "see @core/src/main.ts please", caret: 22 })
  expect(complete("/co", 0, 3, "/compact")).toEqual({ text: "/compact ", caret: 9 })
})

test("matches commands by name first, then by description, and keeps the first of a name", () => {
  const commands = [
    { name: "model", description: "Desk's model picker" },
    { name: "compact", description: "Compact the conversation" },
    { name: "context", description: "Show context usage" },
    { name: "model", description: "Claude Code's model command" },
    { name: "pdf", description: "Read and compact PDF files" },
  ]
  expect(matchCommands(commands, "co").map((command) => command.name)).toEqual(["compact", "context", "pdf"])
  expect(matchCommands(commands, "compact").map((command) => command.name)).toEqual(["compact", "pdf"])
  expect(matchCommands(commands, "").map((command) => command.description)).toEqual(["Desk's model picker", "Compact the conversation", "Show context usage", "Read and compact PDF files"])
})
