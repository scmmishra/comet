import { expect, test } from "bun:test"
import { permissionItem, permissionResult, questionItem, questionResult } from "./requests"

const options = (extra: object = {}) => ({ signal: new AbortController().signal, toolUseID: "req-1", requestId: "control-1", ...extra })

test("asks to approve the command itself, not Claude's description of it", () => {
  const item = permissionItem("Bash", { command: "git checkout -q next", description: "Switch to the next branch" }, options({ title: "Claude wants to run a command" }))
  expect(item).toEqual({ type: "permission", id: "permission:req-1", requestId: "req-1", tool: "Bash", kind: "command", detail: "git checkout -q next", allowSession: true })
})

test("names a file change with Claude Code's sentence, and gives its reason when the reason adds something", () => {
  const item = permissionItem("Write", { file_path: "/x/a.ts", content: "..." }, options({ title: "Claude wants to write a.ts", decisionReason: "\u001b[1mOutside the project\u001b[0m" }))
  expect(item).toMatchObject({ kind: "file-change", detail: "Claude wants to write a.ts", reason: "Outside the project" })
  expect(permissionItem("Write", {}, options({ decisionReason: "Same" }))).not.toHaveProperty("reason")
})

test("falls back to the tool and its path, or its input cut short", () => {
  expect(permissionItem("Read", { file_path: "/x/a.ts" }, options()).detail).toBe("Read: /x/a.ts")
  const long = permissionItem("mcp__x__y", { text: "a".repeat(1000) }, options())
  expect(long).toMatchObject({ kind: "permission" })
  expect(long.detail.length).toBe("mcp__x__y: ".length + 400)
})

test("withholds Always allow when Claude Code says its rule would grant more than this call", () => {
  expect(permissionItem("Bash", { command: "ls" }, options({ suppressAlwaysAllowRule: true })).allowSession).toBe(false)
})

test("allows for the session with Claude Code's suggestions as session rules, else with a rule for the tool", () => {
  const input = { command: "npm test" }
  const suggestion = { type: "addRules" as const, rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow" as const, destination: "localSettings" as const }
  expect(permissionResult("allow-session", "Bash", input, [suggestion])).toEqual({ behavior: "allow", updatedInput: input, updatedPermissions: [{ ...suggestion, destination: "session" }] })
  expect(permissionResult("allow-session", "Bash", input, undefined)).toEqual({ behavior: "allow", updatedInput: input, updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "session" }] })
  expect(permissionResult("allow", "Bash", input, [suggestion])).toEqual({ behavior: "allow", updatedInput: input })
})

test("declining lets the turn go on, and cancelling stops it", () => {
  expect(permissionResult("decline", "Bash", {}, undefined)).not.toHaveProperty("interrupt")
  expect(permissionResult("cancel", "Bash", {}, undefined)).toMatchObject({ behavior: "deny", interrupt: true })
})

test("reads AskUserQuestion's questions, numbering a headerless one and leaving out empty ones", () => {
  const item = questionItem(
    {
      questions: [
        { question: " Which background? ", header: "Comet view", multiSelect: false, options: [{ label: "Top fills the window", description: "The comet's top fills it" }, { label: "Same", description: "Same" }, { label: " " }] },
        { question: "" },
        { question: "Anything else?", multiSelect: true },
      ],
    },
    "req-2",
  )
  expect(item).toEqual({
    type: "question",
    id: "question:req-2",
    requestId: "req-2",
    questions: [
      { header: "Comet view", question: "Which background?", options: [{ label: "Top fills the window", description: "The comet's top fills it" }, { label: "Same" }], multiSelect: false },
      { header: "Question 3", question: "Anything else?", options: [], multiSelect: true },
    ],
  })
})

test("answers go back as AskUserQuestion's input, and a dismissal declines it", () => {
  const input = { questions: [{ question: "Which?" }] }
  expect(questionResult(input, { "Which?": "A, B" })).toEqual({ behavior: "allow", updatedInput: { ...input, answers: { "Which?": "A, B" } } })
  expect(questionResult(input, undefined)).toMatchObject({ behavior: "deny" })
})
