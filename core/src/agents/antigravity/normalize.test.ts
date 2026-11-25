import { expect, test } from "bun:test"
import { UpdateMapper } from "../acp/updates"
import { antigravityTools } from "./normalize"

test("reads a command and its output from Antigravity's own field names", () => {
  const mapper = new UpdateMapper("/repo", antigravityTools)
  mapper.map({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Running run_command", kind: "execute", status: "in_progress", rawInput: { CommandLine: "bun test", Cwd: "/repo" } }, 1)
  const [done] = mapper.map({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: { combined_output: "3 pass\n", exit_code: 0 } }, 2)
  expect(done).toEqual({ kind: "item", item: { type: "tool", id: "t1", name: "Bash", summary: "bun test", result: { output: "3 pass", isError: false }, kind: "command", label: "Ran bun" } })

  expect(antigravityTools.command({ toolCallId: "t2", rawInput: { command_line: "ls" } })).toBe("ls")
  expect(antigravityTools.command({ toolCallId: "t3", rawOutput: { commandLine: "pwd" } })).toBe("pwd")
  expect(antigravityTools.output({ toolCallId: "t4", content: [{ type: "content", content: { type: "text", text: "plain" } }] })).toBe("plain")
})

test("names agy's update_steps call as Claude's plan updates are named, through the update that names it only by id", () => {
  const mapper = new UpdateMapper("/repo", antigravityTools)
  const steps = [{ title: "Create a.txt", status: "in_progress" }]
  const [started] = mapper.map({ sessionUpdate: "tool_call", toolCallId: "u1", title: "Run update_steps", kind: "other", status: "in_progress", rawInput: { steps } }, 1)
  expect(started).toMatchObject({ item: { kind: "other", label: "Updated the plan" } })
  const [done] = mapper.map({ sessionUpdate: "tool_call_update", toolCallId: "u1", status: "completed" }, 2)
  expect(done).toMatchObject({ item: { label: "Updated the plan", result: { isError: false } } })
  // A command whose title looks like it still reads as a command.
  const [command] = mapper.map({ sessionUpdate: "tool_call", toolCallId: "u2", title: "Run update_steps", kind: "execute", rawInput: { CommandLine: "ls" } }, 3)
  expect(command).toMatchObject({ item: { kind: "command", label: "Running ls" } })
})
