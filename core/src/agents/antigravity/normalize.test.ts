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
