import { expect, test } from "bun:test"
import { commandLabel, thought, tool } from "./steps"

const done = { output: "", isError: false }

test("labels a thought by its heading or first sentence, and a thought with no text as Thought", () => {
  expect(thought("t", "**Checking the tests**\n\nThe suite runs in Bun.").label).toBe("Checking the tests")
  expect(thought("t", "The user wants a fold. It should match T3.").label).toBe("The user wants a fold.")
  expect(thought("t", "No sentence end here").label).toBe("No sentence end here")
  expect(thought("t").label).toBe("Thought")
})

test("labels a command by the program it runs, past setup, variables and wrappers", () => {
  expect(commandLabel(". /tmp/env.sh; cd /work/comet && python3 - <<'EOF'\nprint(1)\nEOF", done)).toBe("Ran python3")
  expect(commandLabel("CI=1 sudo /usr/local/bin/bun test core", done)).toBe("Ran bun")
  expect(commandLabel("git log --oneline | head -3", done)).toBe("Ran git")
  expect(commandLabel("cd app", done)).toBe("Ran cd")
})

test("says whether a command is running, ran or failed", () => {
  expect(commandLabel("npm test", undefined)).toBe("Running npm")
  expect(commandLabel("npm test", done)).toBe("Ran npm")
  expect(commandLabel("npm test", { output: "1 failed", isError: true })).toBe("Failed npm")
})

test("keeps every label to one line", () => {
  expect(tool({ type: "tool", id: "a", name: "Grep", summary: "a\n  b" }, "search", "Searched a\n  b").label).toBe("Searched a b")
})
