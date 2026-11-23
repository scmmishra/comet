import { expect, test } from "bun:test"
import { cometToolLabel, cometToolSummary } from "./rows"

test("sums a handed task by its agent and its title, else the task's first line", () => {
  expect(cometToolSummary("delegate", { agent: "codex", task: "Review the login form.\nReport the bugs." })).toBe("codex: Review the login form.")
  expect(cometToolSummary("delegate", { agent: "codex", task: "Long task", title: "Review login" })).toBe("codex: Review login")
  expect(cometToolSummary("list_agents", {})).toBe("")
  expect(cometToolSummary("search", {})).toBeUndefined()
  expect(cometToolLabel("delegate", "codex: Review login", false)).toBe("Handing a task to codex: Review login")
  expect(cometToolLabel("list_agents", "", true)).toBe("Listed the agents")
  expect(cometToolSummary("move_to_worktree", { path: "/Users/me/.comet/worktrees/web/login" })).toBe("login")
  expect(cometToolLabel("move_to_worktree", "login", false)).toBe("Moving to login")
})

test("names the file an agent opens, and the diff", () => {
  expect(cometToolSummary("open_file", { path: "/work/app/src/login.ts", line: 42 })).toBe("login.ts:42")
  expect(cometToolLabel("open_file", "login.ts:42", true)).toBe("Opened login.ts:42")
  expect(cometToolSummary("open_diff", { path: "src/login.ts" })).toBe("login.ts")
  expect(cometToolLabel("open_diff", "login.ts", false)).toBe("Opening the diff of login.ts")
  expect(cometToolLabel("open_diff", cometToolSummary("open_diff", {})!, true)).toBe("Opened Review")
})
