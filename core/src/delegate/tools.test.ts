import { expect, test } from "bun:test"
import { deskToolLabel, deskToolSummary } from "./tools"

test("sums a handed task by its agent and its title, else the task's first line", () => {
  expect(deskToolSummary("delegate", { agent: "codex", task: "Review the login form.\nReport the bugs." })).toBe("codex: Review the login form.")
  expect(deskToolSummary("delegate", { agent: "codex", task: "Long task", title: "Review login" })).toBe("codex: Review login")
  expect(deskToolSummary("list_agents", {})).toBe("")
  expect(deskToolSummary("search", {})).toBeUndefined()
  expect(deskToolLabel("delegate", "codex: Review login", false)).toBe("Handing a task to codex: Review login")
  expect(deskToolLabel("list_agents", "", true)).toBe("Listed the agents")
})
