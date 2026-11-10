import { expect, test } from "bun:test"
import { groupSummary, stepLabel, thoughtLine, type Step } from "./work"

const tool = (name: string, summary: string, extra: Partial<Extract<Step, { type: "tool" }>> = {}): Step => ({
  type: "tool",
  id: `${name}:${summary}`,
  name,
  summary,
  result: { output: "", isError: false },
  ...extra,
})
const thought = (text?: string): Step => ({ type: "thinking", id: `t:${text}`, ...(text ? { text } : {}) })

test("labels a step by what it did, and a command by whether it is running or failed", () => {
  expect(stepLabel(tool("Read", "core/src/main.ts"))).toBe("Read core/src/main.ts")
  expect(stepLabel(tool("Bash", "npm test"))).toBe("Ran npm test")
  expect(stepLabel(tool("Bash", "npm test", { result: undefined }))).toBe("Running npm test")
  expect(stepLabel(tool("Bash", "npm test", { result: { output: "1 failed", isError: true } }))).toBe("Failed npm test")
  expect(stepLabel(tool("Edit", "x", { file: "app/a.ts" }))).toBe("Edited app/a.ts")
  expect(stepLabel(thought())).toBe("Thought")
})

test("shortens a thought to its heading or first sentence", () => {
  expect(thoughtLine("**Checking the tests**\n\nThe suite runs in Bun.")).toBe("Checking the tests")
  expect(thoughtLine("The user wants a fold. It should match T3.")).toBe("The user wants a fold.")
  expect(thoughtLine("No sentence end here")).toBe("No sentence end here")
})

test("sums a group by its two most important kinds, counting files once and thoughts not at all", () => {
  expect(groupSummary([tool("Read", "a.ts"), tool("Read", "b.ts"), tool("Read", "a.ts"), thought("Hm.")])).toBe("Read 2 files")
  expect(groupSummary([tool("Read", "a.ts"), tool("Bash", "ls"), tool("Bash", "pwd")])).toBe("Read a file and ran 2 commands")
  expect(groupSummary([tool("Grep", "x"), tool("Read", "a.ts"), tool("Bash", "ls"), tool("WebFetch", "u")])).toBe("Read a file, ran a command, and performed 2 other actions")
  expect(groupSummary([thought("A."), thought("B.")])).toBe("Thought (×2)")
})
